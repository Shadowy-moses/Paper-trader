import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { buyAll, runPaperAccount, sellAll, splitCash } from "../js/engine.js";
import { createStrategy } from "../js/strategy.js";
import { bars, HOUR_MS, testConfig } from "./helpers.js";

const btc = { id: "BTC", name: "Bitcoin", binanceSymbol: "BTCUSDT", coinbaseProduct: "BTC-USD" };
const eth = { id: "ETH", name: "Ethereum", binanceSymbol: "ETHUSDT", coinbaseProduct: "ETH-USD" };

function account(closes, overrides = {}, extras = {}) {
  const config = testConfig(overrides);
  return runPaperAccount({
    candlesByCoin: { BTC: bars(closes, extras), ETH: bars(Array(closes.length).fill(10)) },
    config,
    strategy: createStrategy(config),
  });
}

describe("fees and slippage", () => {
  test("a buy pays the fee and fills a little worse", () => {
    const fill = buyAll({ cash: 100, rawPrice: 50, feeRate: 0.001, slippageRate: 0.0005 });
    assert.equal(fill.price, 50 * 1.0005);
    assert.equal(fill.fee, 0.1);
    assert.equal(fill.qty, 99.9 / (50 * 1.0005));
    assert.equal(fill.cash, 0);
  });

  test("a sell fills a little worse and pays the fee", () => {
    const fill = sellAll({ qty: 2, rawPrice: 50, feeRate: 0.001, slippageRate: 0.0005 });
    assert.equal(fill.price, 50 * 0.9995);
    assert.ok(fill.cash < 100);
    assert.equal(fill.fee, 2 * fill.price * 0.001);
  });
});

describe("replay", () => {
  test("splits the starting cash to the cent", () => {
    assert.deepEqual(splitCash(100, 3), [33.34, 33.33, 33.33]);
    assert.equal(splitCash(100, 3).reduce((sum, part) => sum + part, 0), 100);
  });

  test("buys on the cross and marks the coin at the latest close", () => {
    const config = testConfig({ fastHours: 2, slowHours: 3 });
    const result = runPaperAccount({
      candlesByCoin: { BTC: bars([10, 10, 10, 10, 14]) },
      config,
      strategy: createStrategy(config),
    });
    assert.equal(result.trades.length, 1);
    assert.equal(result.trades[0].side, "buy");
    assert.equal(result.trades[0].price, 14 * 1.0005);
    assert.equal(result.trades[0].fee, 0.1);
    assert.equal(result.trades[0].size, 99.9 / (14 * 1.0005));
    assert.ok(result.equity < 100);
    assert.equal(result.coins[0].state, "holding");
    assert.equal(result.coins[0].stopPrice, result.trades[0].price * 0.96);
  });

  test("does not chase a cross that happened before the start", () => {
    const start = 5 * HOUR_MS;
    const result = runPaperAccount({
      candlesByCoin: { BTC: bars([10, 10, 10, 10, 14, 15]) },
      config: testConfig({ startTime: new Date(start).toISOString() }),
      strategy: createStrategy(testConfig()),
    });
    assert.equal(result.trades.length, 0);
    assert.equal(result.equity, 100);
    assert.equal(result.coins[0].state, "above");
    assert.equal(result.coins[0].hasSold, false);
  });

  test("sells on a cross under when the drop is inside the safety line", () => {
    const config = testConfig({ stopLossFraction: 0.5 });
    const result = runPaperAccount({
      candlesByCoin: { BTC: bars([10, 10, 10, 10, 14, 14, 8]) },
      config,
      strategy: createStrategy(config),
    });
    assert.deepEqual(
      result.trades.map((trade) => trade.side),
      ["sell", "buy"],
    );
    assert.match(result.trades[0].reason, /crossed below/);
    assert.equal(result.coins[0].qty, 0);
    assert.ok(result.equity < 100);
  });

  test("stops out on a wick and does not buy again in that same hour", () => {
    const config = testConfig();
    const strategy = createStrategy(config);
    const probe = runPaperAccount({
      candlesByCoin: { BTC: bars([10, 10, 10, 10, 14]) },
      config,
      strategy,
    });
    const stop = probe.coins[0].stopPrice;
    const candles = bars([10, 10, 10, 10, 14, 13.8], {
      5: { open: 14, high: 14.2, low: stop },
    });
    const result = runPaperAccount({
      candlesByCoin: { BTC: candles },
      config,
      strategy,
    });
    assert.equal(result.trades.length, 2);
    assert.equal(result.trades[0].side, "sell");
    assert.match(result.trades[0].reason, /Safety sale/);
    assert.equal(result.trades[0].price, stop * (1 - config.slippageRate));
    assert.equal(result.coins[0].qty, 0);
  });

  test("a gap through the safety line sells at the open, then the cushion", () => {
    const config = testConfig();
    const candles = bars([10, 10, 10, 10, 14, 10], {
      5: { open: 10, high: 10, low: 9 },
    });
    const result = runPaperAccount({
      candlesByCoin: { BTC: candles },
      config,
      strategy: createStrategy(config),
    });
    assert.match(result.trades[0].reason, /Safety sale/);
    assert.equal(result.trades[0].price, 10 * (1 - config.slippageRate));
  });

  test("each coin has its own pile of cash", () => {
    const config = testConfig({
      coins: [btc, eth],
    });
    const flat = bars(Array(8).fill(10));
    const result = runPaperAccount({
      candlesByCoin: {
        BTC: bars([10, 10, 10, 10, 14]),
        ETH: flat,
      },
      config,
      strategy: createStrategy(config),
    });
    const bitcoin = result.coins.find((coin) => coin.id === "BTC");
    const ether = result.coins.find((coin) => coin.id === "ETH");
    assert.equal(bitcoin.qty > 0, true);
    assert.equal(ether.qty, 0);
    assert.equal(ether.cash, 50);
    assert.ok(result.benchmark.size > bitcoin.qty);
  });

  test("buy-and-hold uses the full $100 even when the strategy sits in cash", () => {
    const config = testConfig({ fastHours: 3, slowHours: 5 });
    const result = runPaperAccount({
      candlesByCoin: { BTC: bars(Array(6).fill(100)) },
      config,
      strategy: createStrategy(config),
    });
    assert.equal(result.trades.length, 0);
    assert.equal(result.equity, 100);
    assert.equal(result.benchmark.waiting, false);
    assert.ok(result.benchmark.equity < 100);
    assert.equal(result.benchmark.size, 99.9 / (100 * 1.0005));
  });

  test("the same candles always rebuild the same trades", () => {
    const config = testConfig({ stopLossFraction: 0.5, coins: [btc, eth] });
    const input = {
      candlesByCoin: {
        BTC: bars([10, 10, 10, 10, 14, 14, 8, 8, 16]),
        ETH: bars([10, 9, 8, 8, 12, 12, 7]),
      },
      config,
      strategy: createStrategy(config),
    };
    assert.deepEqual(runPaperAccount(input), runPaperAccount(input));
  });

  test("a later hour does not change trades that already happened", () => {
    const config = testConfig({ stopLossFraction: 0.5 });
    const firstCandles = bars([10, 10, 10, 10, 14, 14, 8]);
    const first = runPaperAccount({
      candlesByCoin: { BTC: firstCandles },
      config,
      strategy: createStrategy(config),
    });
    const extra = bars([10, 10, 10, 10, 14, 14, 8, 4]);
    const second = runPaperAccount({
      candlesByCoin: { BTC: extra },
      config,
      strategy: createStrategy(config),
    });
    const lastTime = firstCandles.at(-1).closeTime;
    assert.deepEqual(
      second.trades.filter((trade) => trade.time <= lastTime),
      first.trades,
    );
  });
});
