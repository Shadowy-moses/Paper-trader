// Three short-term signals, each run as its own $100 strategy.
// Candles are 15 minutes. Nothing here borrows, shorts, or sends a real order.
//
// Shared exit rules, applied in this order on a bar:
//   1. Stop, if the low touches it (a gap through it fills at the open).
//   2. Take-profit, if the high touches it.
//   3. Midnight Central time: sell at the close. The log reason is "end of day."
// If the stop and the target are both touched, the stop wins. We cannot know
// which happened first inside the candle, so we take the worse one.
//
// The engine sizes the buy and blocks new buys after 3 losses in a Chicago day.

import { QUARTER_HOUR_MS } from "./config.js";
import { chicagoDateKey, isChicagoMidnight } from "./chicago.js";
import { formatMoney, formatRate } from "./format.js";
import {
  averageTrueRange,
  exponentialAverage,
  priorHigh,
  priorVolumeAverage,
  relativeStrengthIndex,
  simpleAverage,
} from "./indicators.js";

const STEP = QUARTER_HOUR_MS;

export function exitOpenPosition({ candles, index, position }) {
  const bar = candles[index];
  if (!bar || !position) return null;

  if (bar.low <= position.stopPrice) {
    return {
      action: "sell",
      rawPrice: Math.min(bar.open, position.stopPrice),
      reason: position.stopReason,
    };
  }

  if (position.targetMode === "fixed" && position.targetPrice != null && bar.high >= position.targetPrice) {
    return {
      action: "sell",
      rawPrice: bar.open >= position.targetPrice ? bar.open : position.targetPrice,
      reason: position.targetReason,
    };
  }

  if (position.targetMode === "sma20") {
    const average = simpleAverage(candles, index, 20, STEP);
    if (average != null && average > position.entryPrice && bar.high >= average) {
      return {
        action: "sell",
        rawPrice: bar.open >= average ? bar.open : average,
        reason: position.targetReason,
      };
    }
  }

  if (isChicagoMidnight(bar.closeTime)) {
    return { action: "sell", rawPrice: bar.close, reason: "end of day." };
  }

  if (index > 0 && chicagoDateKey(bar.openTime) !== chicagoDateKey(candles[index - 1].openTime)) {
    return { action: "sell", rawPrice: bar.open, reason: "end of day." };
  }

  return null;
}

function swingPlan(day, atr) {
  return {
    stopOffset: day.stopAtr * atr,
    targetOffset: day.targetAtr * atr,
    targetMode: "fixed",
    stopReason: `Stop: price fell ${day.stopAtr} times the average swing from the buy.`,
    targetReason: `Take-profit: price rose ${day.targetAtr} times the average swing from the buy.`,
  };
}

export function breakoutEntry(candles, index, day) {
  const high = priorHigh(candles, index, day.breakoutLookback, STEP);
  const averageVolume = priorVolumeAverage(candles, index, day.breakoutLookback, STEP);
  const bar = candles[index];
  if (high == null || !(averageVolume > 0) || !(bar.volume >= day.volumeMultiple * averageVolume)) return null;
  if (!(bar.close > high)) return null;
  const atr = averageTrueRange(candles, index, day.atrPeriod, STEP);
  if (!(atr > 0)) return null;
  return {
    rawPrice: bar.close,
    ...swingPlan(day, atr),
    reason: `Breakout: closed above the last ${day.breakoutLookback} highs, and volume was at least ${day.volumeMultiple}× average.`,
  };
}

export function pullbackEntry(candles, index, day) {
  const fast = exponentialAverage(candles, index, day.fastEma, STEP);
  const slow = exponentialAverage(candles, index, day.slowEma, STEP);
  const rsi = relativeStrengthIndex(candles, index, day.rsiPeriod, STEP);
  const previousRsi = relativeStrengthIndex(candles, index - 1, day.rsiPeriod, STEP);
  const bar = candles[index];
  if (fast == null || slow == null || rsi == null || previousRsi == null) return null;
  if (!(fast > slow)) return null;
  if (!(bar.low <= fast)) return null;
  if (!(previousRsi <= day.rsiPullback && rsi > day.rsiPullback)) return null;
  const atr = averageTrueRange(candles, index, day.atrPeriod, STEP);
  if (!(atr > 0)) return null;
  return {
    rawPrice: bar.close,
    ...swingPlan(day, atr),
    reason: `Pullback: price reached the ${day.fastEma}-bar average while it was above the ${day.slowEma}-bar average, and RSI crossed above ${day.rsiPullback}.`,
  };
}

export function bounceEntry(candles, index, day) {
  if (index < 2) return null;
  const bar = candles[index];
  const previous = candles[index - 1];
  if (bar.closeTime - previous.closeTime !== STEP) return null;
  const earlierRsi = relativeStrengthIndex(candles, index - 2, day.rsiPeriod, STEP);
  const previousRsi = relativeStrengthIndex(candles, index - 1, day.rsiPeriod, STEP);
  if (earlierRsi == null || previousRsi == null) return null;
  if (!(earlierRsi >= day.rsiOversold && previousRsi < day.rsiOversold)) return null;
  if (!(bar.close > previous.close)) return null;
  return {
    rawPrice: bar.close,
    stopFraction: day.bounceStopFraction,
    targetMode: "sma20",
    reason: `Bounce: RSI fell under ${day.rsiOversold} and the next candle closed higher.`,
    stopReason: `Stop: price fell ${formatRate(day.bounceStopFraction)}% from the buy.`,
    targetReason: "Take-profit: price reached the 20-bar average.",
  };
}

function statusText({ position, blocked }) {
  if (position) {
    const target = position.targetMode === "sma20"
      ? "Target is the 20-bar average."
      : `Target ${formatMoney(position.targetPrice)}.`;
    return `Holding. Stop ${formatMoney(position.stopPrice)}. ${target}`;
  }
  if (blocked) return "Paused for the rest of the day after 3 losses.";
  return "In cash.";
}

function createSignal({ id, name, blurb, entry }) {
  return {
    id,
    name,
    blurb,
    exit(context) {
      return exitOpenPosition(context);
    },
    entry(context) {
      return entry(context.candles, context.index, context.day);
    },
    status(context) {
      return { text: statusText(context) };
    },
  };
}

export function createDayStrategies(config) {
  const day = config.day;
  return [
    createSignal({
      id: "breakout",
      name: "Momentum breakout",
      blurb: `Buys a 15-minute close above the last ${day.breakoutLookback} highs when volume is at least ${day.volumeMultiple}× average. Stop is ${day.stopAtr}× the average swing under the buy. Target is ${day.targetAtr}× that swing.`,
      entry: breakoutEntry,
    }),
    createSignal({
      id: "pullback",
      name: "Trend pullback",
      blurb: `Buys only while the ${day.fastEma}-bar average is above the ${day.slowEma}-bar average, and the candle reaches the shorter average as RSI crosses back above ${day.rsiPullback}. Same stop and target as the breakout.`,
      entry: pullbackEntry,
    }),
    createSignal({
      id: "bounce",
      name: "Oversold bounce",
      blurb: `Buys the candle after RSI falls under ${day.rsiOversold}, if that candle closes up. Target is the ${day.bounceSma}-bar average. Stop is ${formatRate(day.bounceStopFraction)}% under the buy.`,
      entry: bounceEntry,
    }),
  ];
}
