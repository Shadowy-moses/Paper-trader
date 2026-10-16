import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { CONFIG, QUARTER_HOUR_MS, START_TIME } from "../js/config.js";
import { createDayStrategies } from "../js/day-strategies.js";
import { formatChicago } from "../js/format.js";
import { runBenchmark, runPaperAccount, runRiskAccount } from "../js/engine.js";
import { createStrategy } from "../js/strategy.js";
import { buildViewModel } from "../js/view-model.js";
import { bars, testConfig } from "./helpers.js";

describe("launch settings", () => {
  test("the clock starts at midnight Central time on launch day", () => {
    assert.equal(CONFIG.startTime, START_TIME);
    assert.equal(START_TIME, "2026-10-16T05:00:00.000Z");
    assert.equal(formatChicago(Date.parse(START_TIME)), "Oct 16, 2026, 12:00 AM CDT");
    assert.equal(CONFIG.startingCash, 100);
    assert.equal(CONFIG.feeRate, 0.001);
    assert.equal(CONFIG.slippageRate, 0.0005);
    assert.equal(CONFIG.day.candleMinutes, 15);
    assert.equal(CONFIG.day.riskFraction, 0.02);
    assert.equal(CONFIG.day.maxLossesPerDay, 3);
    assert.deepEqual(
      CONFIG.coins.map((coin) => coin.id),
      ["BTC", "ETH", "SOL"],
    );
  });

  test("the page says it is fake money and not advice", () => {
    const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
    assert.match(html, /fake money/i);
    assert.match(html, /not financial advice/i);
    assert.match(html, /src="\.\/js\/main\.js"/);
    const workflow = readFileSync(new URL("../.github/workflows/pages.yml", import.meta.url), "utf8");
    assert.match(workflow, /branches: \[main\]/);
    assert.match(workflow, /deploy-pages@v4/);
  });
});

function quarterFlat(count, price = 100) {
  return Array.from({ length: count }, (_, index) => {
    const openTime = index * QUARTER_HOUR_MS;
    return {
      openTime,
      closeTime: openTime + QUARTER_HOUR_MS,
      open: price,
      high: price + 1,
      low: price - 1,
      close: price,
      volume: 10,
    };
  });
}

function viewFrom(config, hourly, quarter) {
  const dayAccounts = createDayStrategies(config).map((strategy) =>
    runRiskAccount({ candlesByCoin: quarter, config, strategy }),
  );
  const slowAccount = runPaperAccount({
    candlesByCoin: hourly,
    config,
    strategy: createStrategy(config),
  });
  const benchmark = runBenchmark({
    candles: quarter.BTC,
    config,
    startMs: Date.parse(config.startTime),
  });
  return buildViewModel({
    dayAccounts,
    slowAccount,
    benchmark,
    sourceLabel: "Binance public prices",
    config,
  });
}

describe("dashboard copy", () => {
  test("shows the three day strategies, Bitcoin, and the slower comparison", () => {
    const config = testConfig({ fastHours: 24, slowHours: 72 });
    const view = viewFrom(
      config,
      { BTC: bars(Array(6).fill(100)) },
      { BTC: quarterFlat(6) },
    );
    assert.deepEqual(view.day.map((strategy) => strategy.name), [
      "Momentum breakout",
      "Trend pullback",
      "Oversold bounce",
    ]);
    assert.equal(view.day[0].balance, "$100.00");
    assert.match(view.day[0].activity, /0 trades/);
    assert.match(view.day[0].activity, /\$0\.00 in fees/);
    assert.match(view.day[0].coins[0].line, /Bitcoin · no trades/);
    assert.match(view.guardrail, /2%/);
    assert.match(view.guardrail, /3 losses/);
    assert.match(view.guardrail, /midnight Central time/);
    assert.match(view.benchmarkBalance, /\$99\./);
    assert.match(view.benchmarkComparisons[0], /Momentum breakout is ahead of just holding Bitcoin/);
    assert.match(view.slow.how, /24-hour average/);
    assert.equal(view.trades.length, 0);
    assert.match(view.emptyTrades, /time, strategy, coin, side, price, size, and reason/);
    assert.deepEqual(view.filters.map((item) => item.label), ["All", "Breakout", "Pullback", "Bounce", "Slower"]);
  });

  test("a trade log row has time, strategy, coin, side, price, size, and reason", () => {
    const config = testConfig();
    const view = viewFrom(
      config,
      { BTC: bars([10, 10, 10, 10, 14]) },
      { BTC: quarterFlat(4, 10) },
    );
    assert.equal(view.trades.length, 1);
    const trade = view.trades[0];
    assert.equal(trade.side, "Buy");
    assert.equal(trade.strategyName, "Slower crossover");
    assert.equal(trade.coin, "Bitcoin");
    assert.match(trade.time, /CDT|CST/);
    assert.match(trade.price, /^\$/);
    assert.match(trade.size, /BTC$/);
    assert.match(trade.reason, /crossed above/);
    assert.equal(view.slow.pnlDirection, "down");
  });
});
