import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { CONFIG } from "../js/config.js";
import { createStrategy, movingAverage, strategySummary } from "../js/strategy.js";
import { bars, HOUR_MS, testConfig } from "./helpers.js";

describe("moving average", () => {
  test("averages the last N hourly closes", () => {
    const candles = bars([1, 2, 3, 4, 5]);
    assert.equal(movingAverage(candles, 4, 2), 4.5);
    assert.equal(movingAverage(candles, 4, 5), 3);
    assert.equal(movingAverage(candles, 2, 5), null);
  });

  test("returns null when an hour inside the window is missing", () => {
    const candles = bars(Array.from({ length: 30 }, () => 10)).filter((_, i) => i !== 20);
    assert.equal(movingAverage(candles, candles.length - 1, 24), null);
    const whole = bars(Array.from({ length: 30 }, () => 10));
    assert.equal(movingAverage(whole, whole.length - 1, 24), 10);
  });
});

describe("crossover", () => {
  const strategy = createStrategy(testConfig());

  test("buys when the short average crosses above the long one", () => {
    const candles = bars([10, 10, 10, 10, 14]);
    const decision = strategy.decide({ candles, index: 4, position: null });
    assert.equal(decision.action, "buy");
    assert.equal(decision.rawPrice, 14);
    assert.match(decision.reason, /2-hour average crossed above the 3-hour average/);
  });

  test("does not buy just because the short average is already higher", () => {
    const candles = bars([10, 10, 10, 10, 14, 14]);
    const decision = strategy.decide({ candles, index: 5, position: null });
    assert.equal(decision.action, "hold");
  });

  test("sells when the short average crosses back under", () => {
    const candles = bars([10, 10, 10, 10, 14, 14, 8]);
    const decision = strategy.decide({
      candles,
      index: 6,
      position: { qty: 1, entryPrice: 14, stopPrice: 1 },
    });
    assert.equal(decision.action, "sell");
    assert.equal(decision.rawPrice, 8);
    assert.match(decision.reason, /crossed below/);
  });

  test("safety sale wins over a crossover on the same hour", () => {
    const candles = bars([10, 10, 10, 10, 14, 14, 8], {
      6: { open: 14, high: 14, low: 8 },
    });
    const decision = strategy.decide({
      candles,
      index: 6,
      position: { qty: 1, entryPrice: 14, stopPrice: 13 },
    });
    assert.equal(decision.action, "sell");
    assert.equal(decision.rawPrice, 13);
    assert.match(decision.reason, /Safety sale/);
  });

  test("a gap through the safety line fills at the open", () => {
    const candles = bars([10], { 0: { open: 9, high: 10, low: 8 } });
    const decision = strategy.decide({
      candles,
      index: 0,
      position: { qty: 1, entryPrice: 14, stopPrice: 13 },
    });
    assert.equal(decision.rawPrice, 9);
  });

  test("stop price is the fill minus the configured percent", () => {
    assert.equal(strategy.stopPrice(100), 96);
  });

  test("does not read a later hour", () => {
    const candles = bars([10, 10, 10, 10, 14, 1]);
    const atCross = strategy.decide({ candles, index: 4, position: null });
    const withoutFuture = strategy.decide({
      candles: candles.slice(0, 5),
      index: 4,
      position: null,
    });
    assert.deepEqual(atCross, withoutFuture);
  });
});

describe("summary", () => {
  test("states the live defaults in plain language", () => {
    const text = strategySummary(CONFIG);
    assert.match(text, /\$100/);
    assert.match(text, /Bitcoin, Ethereum, and Solana/);
    assert.match(text, /24-hour average/);
    assert.match(text, /72-hour average/);
    assert.match(text, /4%/);
    assert.match(text, /0\.1% fee/);
    assert.match(text, /0\.05%/);
  });
});

test("hour spacing used by the fixtures stays one hour", () => {
  assert.equal(bars([1, 2])[1].openTime - bars([1, 2])[0].openTime, HOUR_MS);
});
