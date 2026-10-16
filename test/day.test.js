import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { CONFIG, QUARTER_HOUR_MS } from "../js/config.js";
import { chicagoDateKey, isChicagoMidnight } from "../js/chicago.js";
import { bounceEntry, breakoutEntry, exitOpenPosition, pullbackEntry } from "../js/day-strategies.js";
import { runRiskAccount } from "../js/engine.js";
import { relativeStrengthIndex } from "../js/indicators.js";
import { sizeForStop } from "../js/risk.js";
import { testConfig } from "./helpers.js";

const STEP = QUARTER_HOUR_MS;

function quarterBars(rows, start = 0) {
  return rows.map((row, index) => {
    const close = row.close;
    const openTime = start + index * STEP;
    return {
      openTime,
      closeTime: openTime + STEP,
      open: row.open ?? close,
      high: row.high ?? close,
      low: row.low ?? close,
      close,
      volume: row.volume ?? 10,
    };
  });
}

describe("Chicago day boundary", () => {
  test("midnight Central time is the close of the last 15-minute bar", () => {
    const midnight = Date.parse("2026-10-17T05:00:00.000Z");
    assert.equal(isChicagoMidnight(midnight), true);
    assert.equal(isChicagoMidnight(Date.parse("2026-01-15T06:00:00.000Z")), true);
    assert.equal(isChicagoMidnight(midnight - STEP), false);
    assert.equal(chicagoDateKey(midnight - STEP), "2026-10-16");
    assert.equal(chicagoDateKey(midnight), "2026-10-17");
  });
});

describe("momentum breakout", () => {
  const warmup = Array.from({ length: 21 }, () => ({ close: 100, high: 101, low: 99, volume: 10 }));

  test("buys a close above the previous 20 highs when volume is 1.5× average", () => {
    const candles = quarterBars([...warmup, { close: 102, high: 103, low: 100, volume: 15 }]);
    const signal = breakoutEntry(candles, candles.length - 1, CONFIG.day);
    assert.ok(signal);
    assert.match(signal.reason, /Breakout/);
    assert.equal(signal.rawPrice, 102);
    assert.ok(signal.stopOffset > 0);
    assert.equal(signal.targetOffset / signal.stopOffset, CONFIG.day.targetAtr / CONFIG.day.stopAtr);
  });

  test("stays out when volume is only average, or the close does not clear the old high", () => {
    const quiet = quarterBars([...warmup, { close: 102, high: 103, low: 100, volume: 14 }]);
    const inside = quarterBars([...warmup, { close: 101, high: 101, low: 99, volume: 30 }]);
    assert.equal(breakoutEntry(quiet, quiet.length - 1, CONFIG.day), null);
    assert.equal(breakoutEntry(inside, inside.length - 1, CONFIG.day), null);
  });
});

describe("oversold bounce", () => {
  test("buys the candle after RSI falls under 25 when that candle closes higher", () => {
    const flat = Array.from({ length: 30 }, () => ({ close: 100, high: 101, low: 99, volume: 10 }));
    const candles = quarterBars([
      ...flat,
      { close: 70, high: 100, low: 70, open: 100, volume: 10 },
      { close: 72, high: 73, low: 69, open: 70, volume: 10 },
    ]);
    const crash = candles.length - 2;
    assert.ok(relativeStrengthIndex(candles, crash, 14, STEP) < 25);
    const signal = bounceEntry(candles, crash + 1, CONFIG.day);
    assert.ok(signal);
    assert.match(signal.reason, /Bounce/);
    assert.equal(signal.stopFraction, 0.01);
    assert.equal(signal.targetMode, "sma20");
    const lower = quarterBars([
      ...flat,
      { close: 70, high: 100, low: 70, open: 100, volume: 10 },
      { close: 68, high: 71, low: 67, open: 70, volume: 10 },
    ]);
    assert.equal(bounceEntry(lower, lower.length - 1, CONFIG.day), null);
    const stillOversold = quarterBars([
      ...flat,
      { close: 70, high: 100, low: 70, open: 100, volume: 10 },
      { close: 68, high: 71, low: 67, open: 70, volume: 10 },
      { close: 69, high: 70, low: 67, open: 68, volume: 10 },
    ]);
    assert.equal(bounceEntry(stillOversold, stillOversold.length - 1, CONFIG.day), null);
  });
});

describe("trend pullback", () => {
  test("does not buy a falling market", () => {
    const candles = quarterBars(
      Array.from({ length: 80 }, (_, index) => {
        const close = 200 - index;
        return { close, high: close + 0.4, low: close - 0.4, volume: 10 };
      }),
    );
    for (let index = 0; index < candles.length; index += 1) {
      assert.equal(pullbackEntry(candles, index, CONFIG.day), null);
    }
  });

  test("buys a dip back to the short average while the longer trend is up and RSI crosses above 40", () => {
    const rise = Array.from({ length: 90 }, (_, index) => {
      const close = 100 + index * 0.5;
      return { close, high: close + 0.3, low: close - 0.2, volume: 10 };
    });
    const rows = [...rise];
    for (let step = 0; step < 5; step += 1) {
      const last = rows.at(-1).close;
      rows.push({ close: last - 2, high: last, low: last - 2.2, open: last, volume: 10 });
    }
    const last = rows.at(-1).close;
    rows.push({ close: last + 1, high: last + 1.2, low: last - 6, open: last, volume: 10 });
    const candles = quarterBars(rows);
    const signal = pullbackEntry(candles, candles.length - 1, CONFIG.day);
    assert.ok(signal);
    assert.match(signal.reason, /Pullback/);
    assert.match(signal.reason, /RSI crossed above 40/);
  });
});

describe("guardrails", () => {
  test("the stop loses at most 2% of the balance after fees and the cushion", () => {
    const sized = sizeForStop({
      equity: 100,
      cash: 100,
      fillPrice: 100,
      stopPrice: 90,
      feeRate: 0.001,
      slippageRate: 0.0005,
      riskFraction: 0.02,
    });
    assert.ok(sized.spend < 100);
    assert.ok(sized.lossAtStop <= 2 + 1e-6);
    assert.ok(sized.lossAtStop > 1.9);
  });

  test("a tight stop does not get to risk more than 2% by using the whole pile", () => {
    const sized = sizeForStop({
      equity: 100,
      cash: 100,
      fillPrice: 100,
      stopPrice: 99.9,
      feeRate: 0.001,
      slippageRate: 0.0005,
      riskFraction: 0.02,
    });
    assert.equal(sized.spend, 100);
    assert.ok(sized.lossAtStop < 2);
  });

  test("three losses stop new buys for the rest of the Chicago day", () => {
    const start = Date.parse("2026-10-16T16:00:00.000Z");
    const candles = quarterBars(
      Array.from({ length: 10 }, () => ({ close: 100, high: 101, low: 90, open: 100, volume: 10 })),
      start,
    );
    const strategy = {
      id: "stub",
      name: "Stub",
      blurb: "stub",
      exit({ candles: series, index, position }) {
        const bar = series[index];
        if (bar.low <= position.stopPrice) {
          return { action: "sell", rawPrice: Math.min(bar.open, position.stopPrice), reason: "stop" };
        }
        return null;
      },
      entry() {
        return {
          rawPrice: 100,
          stopFraction: 0.01,
          targetOffset: 50,
          targetMode: "fixed",
          reason: "test buy",
          stopReason: "stop",
          targetReason: "target",
        };
      },
      status() {
        return { text: "In cash." };
      },
    };
    const result = runRiskAccount({
      candlesByCoin: { BTC: candles },
      config: testConfig({ startTime: new Date(start).toISOString() }),
      strategy,
    });
    const buys = result.trades.filter((trade) => trade.side === "buy");
    const sells = result.trades.filter((trade) => trade.side === "sell");
    assert.equal(buys.length, 3);
    assert.equal(sells.length, 3);
    assert.equal(sells.every((trade) => trade.loss), true);
  });

  test("an open coin is sold at midnight Central time", () => {
    const firstOpen = Date.parse("2026-10-16T16:00:00.000Z");
    const eodOpen = Date.parse("2026-10-17T04:45:00.000Z");
    const candles = [
      {
        openTime: firstOpen,
        closeTime: firstOpen + STEP,
        open: 100,
        high: 101,
        low: 100,
        close: 100,
        volume: 10,
      },
      {
        openTime: eodOpen,
        closeTime: eodOpen + STEP,
        open: 100,
        high: 101,
        low: 100,
        close: 100,
        volume: 10,
      },
    ];
    assert.equal(isChicagoMidnight(candles[1].closeTime), true);
    const strategy = {
      id: "stub",
      name: "Stub",
      blurb: "stub",
      exit(context) {
        return exitOpenPosition(context);
      },
      entry({ index }) {
        if (index !== 0) return null;
        return {
          rawPrice: 100,
          stopFraction: 0.05,
          targetOffset: 50,
          targetMode: "fixed",
          reason: "test buy",
          stopReason: "stop",
          targetReason: "target",
        };
      },
      status() {
        return { text: "In cash." };
      },
    };
    const result = runRiskAccount({
      candlesByCoin: { BTC: candles },
      config: testConfig({ startTime: new Date(firstOpen).toISOString() }),
      strategy,
    });
    assert.equal(result.trades.length, 2);
    assert.equal(result.trades[1].reason, "end of day.");
    assert.equal(result.coins[0].qty, 0);
  });

  test("a stop on the midnight bar is logged as the stop, not the end of the day", () => {
    const position = {
      qty: 1,
      entryPrice: 100,
      stopPrice: 99,
      targetPrice: 110,
      targetMode: "fixed",
      stopReason: "stop",
      targetReason: "target",
    };
    const barOpen = Date.parse("2026-10-17T04:45:00.000Z");
    const candles = quarterBars([{ close: 98, high: 100, low: 97, open: 100 }], barOpen);
    const exit = exitOpenPosition({ candles, index: 0, position });
    assert.equal(exit.reason, "stop");
    assert.equal(exit.rawPrice, 99);
  });
});
