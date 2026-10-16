// Moving-average crossover with a stop-loss.
//
// This is the only strategy. To swap it later, replace this file or point
// js/main.js at another module that exports createStrategy(config).
//
// createStrategy(config) returns:
//   summary: string shown on the page
//   decide({ candles, index, position }) ->
//       { action: "hold" }
//       { action: "buy", rawPrice, reason }
//       { action: "sell", rawPrice, reason }
//   status({ candles, index, position }) ->
//       { state: "warming"|"holding"|"above"|"below"|"even", fast, slow }
//   stopPrice(fillPrice) -> number
//
// decide() may only use candles[0] through candles[index]. The engine applies
// the fee and the price cushion, then stores stopPrice(fill) on the position.
// A position is { qty, entryPrice, stopPrice } or null.
// A candle is { openTime, closeTime, open, high, low, close }.

import { HOUR_MS } from "./config.js";
import { formatRate, plainDollars } from "./format.js";

function coinList(coins) {
  const names = coins.map((coin) => coin.name);
  if (names.length <= 1) return names[0] || "the coins";
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names.at(-1)}`;
}

export function strategySummary(config) {
  const fee = formatRate(config.feeRate);
  const slip = formatRate(config.slippageRate);
  const stop = formatRate(config.stopLossFraction);
  return `The ${plainDollars(config.startingCash)} is split across ${coinList(config.coins)}. It buys a coin when the ${config.fastHours}-hour average crosses above the ${config.slowHours}-hour average, and sells when it crosses back under. It also sells if the price drops ${stop}% from the buy. Each trade costs a ${fee}% fee, plus a ${slip}% price cushion so the fill is a little worse than the posted price.`;
}

// Average of the last `hours` hourly closes ending at `index`.
// Returns null if any hour in that window is missing, so a gap cannot pretend
// to be a full day or a full three days.
export function movingAverage(candles, index, hours) {
  if (index < 0 || !candles[index] || !Number.isInteger(hours) || hours < 1) return null;
  const end = candles[index].closeTime;
  const earliest = end - hours * HOUR_MS;
  let sum = 0;
  let count = 0;
  for (let i = index; i >= 0; i -= 1) {
    if (candles[i].closeTime <= earliest) break;
    sum += candles[i].close;
    count += 1;
    if (count > hours) return null;
  }
  if (count !== hours) return null;
  return sum / hours;
}

function crossAt(candles, index, fastHours, slowHours) {
  const fast = movingAverage(candles, index, fastHours);
  const slow = movingAverage(candles, index, slowHours);
  const prevFast = movingAverage(candles, index - 1, fastHours);
  const prevSlow = movingAverage(candles, index - 1, slowHours);
  if (fast == null || slow == null || prevFast == null || prevSlow == null) return null;
  if (prevFast <= prevSlow && fast > slow) return "up";
  if (prevFast >= prevSlow && fast < slow) return "down";
  return "none";
}

export function createStrategy(config) {
  const stopLabel = formatRate(config.stopLossFraction);
  const buyReason = `The ${config.fastHours}-hour average crossed above the ${config.slowHours}-hour average.`;
  const sellReason = `The ${config.fastHours}-hour average crossed below the ${config.slowHours}-hour average.`;
  const stopReason = `Safety sale: the price hit the ${stopLabel}% safety line.`;

  return {
    id: "ma-crossover-stop",
    name: "Moving-average crossover",
    summary: strategySummary(config),
    stopPrice(fillPrice) {
      return fillPrice * (1 - config.stopLossFraction);
    },
    decide({ candles, index, position }) {
      const bar = candles[index];
      if (!bar) return { action: "hold" };

      if (position && bar.low <= position.stopPrice) {
        const rawPrice = Math.min(bar.open, position.stopPrice);
        return { action: "sell", rawPrice, reason: stopReason };
      }

      const cross = crossAt(candles, index, config.fastHours, config.slowHours);
      if (cross == null) return { action: "hold" };
      if (position && cross === "down") {
        return { action: "sell", rawPrice: bar.close, reason: sellReason };
      }
      if (!position && cross === "up") {
        return { action: "buy", rawPrice: bar.close, reason: buyReason };
      }
      return { action: "hold" };
    },
    status({ candles, index, position }) {
      if (position) {
        return { state: "holding", fast: movingAverage(candles, index, config.fastHours), slow: movingAverage(candles, index, config.slowHours) };
      }
      const fast = movingAverage(candles, index, config.fastHours);
      const slow = movingAverage(candles, index, config.slowHours);
      if (fast == null || slow == null) return { state: "warming", fast, slow };
      if (fast > slow) return { state: "above", fast, slow };
      if (fast < slow) return { state: "below", fast, slow };
      return { state: "even", fast, slow };
    },
  };
}
