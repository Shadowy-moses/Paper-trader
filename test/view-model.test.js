import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { CONFIG, START_TIME } from "../js/config.js";
import { formatChicago } from "../js/format.js";
import { runPaperAccount } from "../js/engine.js";
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

describe("dashboard copy", () => {
  test("shows balance, profit, the Bitcoin comparison, and an empty log", () => {
    const config = testConfig({ fastHours: 3, slowHours: 5 });
    const account = runPaperAccount({
      candlesByCoin: { BTC: bars(Array(6).fill(100)) },
      config,
      strategy: createStrategy(config),
    });
    const view = buildViewModel({
      account,
      sourceLabel: "Binance public prices",
      config,
    });
    assert.equal(view.balance, "$100.00");
    assert.match(view.pnlText, /Even since/);
    assert.match(view.benchmarkBalance, /\$99\./);
    assert.match(view.benchmarkPnlText, /Down/);
    assert.match(view.comparison, /Ahead of just holding Bitcoin/);
    assert.equal(view.trades.length, 0);
    assert.match(view.emptyTrades, /time \(Central time, Chicago\), coin, side, price, size, and reason/);
    assert.match(view.how, /does not borrow/);
    assert.match(view.asOf, /Binance public prices/);
  });

  test("a trade log row has time, coin, side, price, size, and reason", () => {
    const config = testConfig();
    const account = runPaperAccount({
      candlesByCoin: { BTC: bars([10, 10, 10, 10, 14]) },
      config,
      strategy: createStrategy(config),
    });
    const view = buildViewModel({ account, sourceLabel: "Binance public prices", config });
    assert.equal(view.trades.length, 1);
    const trade = view.trades[0];
    assert.equal(trade.side, "Buy");
    assert.equal(trade.coin, "Bitcoin");
    assert.match(trade.time, /CDT|CST/);
    assert.match(trade.price, /^\$/);
    assert.match(trade.size, /BTC$/);
    assert.match(trade.reason, /crossed above/);
    assert.equal(view.pnlDirection, "down");
  });
});
