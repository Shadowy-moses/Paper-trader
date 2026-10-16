import { CONFIG, HOUR_MS, QUARTER_HOUR_MS, assertConfig } from "./config.js";
import { createDayStrategies } from "./day-strategies.js";
import { runBenchmark, runPaperAccount, runRiskAccount } from "./engine.js";
import { loadBooks } from "./prices.js";
import { createStrategy } from "./strategy.js";
import { buildViewModel } from "./view-model.js";

const content = document.querySelector("#content");
const refresh = document.querySelector("#refresh");
const liveStatus = document.querySelector("#live-status");

assertConfig(CONFIG);
const slowStrategy = createStrategy(CONFIG);
const dayStrategies = createDayStrategies(CONFIG);
let lastView = null;
let filter = "all";

function h(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue;
    if (key === "className") node.className = value;
    else if (key === "text") node.textContent = value;
    else node.setAttribute(key, String(value));
  }
  for (const child of children) {
    if (typeof child === "string") node.append(child);
    else if (child) node.append(child);
  }
  return node;
}

function fact(label, value) {
  return h("div", {}, [h("dt", { text: label }), h("dd", { text: value })]);
}

function renderLoading() {
  content.replaceChildren(
    h("section", { className: "card" }, [
      h("p", { className: "label", text: "Loading" }),
      h("p", { text: "Fetching public 15-minute and hourly prices for Bitcoin, Ethereum, and Solana." }),
    ]),
  );
}

function renderError(message) {
  content.replaceChildren(
    h("section", { className: "card" }, [
      h("h2", { text: "Prices didn't load" }),
      h("p", {
        text: "Check your connection and tap Update. The page needs public prices from Binance, or from Coinbase if Binance is down.",
      }),
      h("p", { className: "quiet", text: message }),
    ]),
  );
}

function dayCard(strategy, index) {
  return h("article", { className: "card day-card" }, [
    h("h3", { text: strategy.name }),
    h("p", {
      className: "strategy-value",
      id: index === 0 ? "balance" : undefined,
      text: strategy.balance,
    }),
    h("p", { className: `pnl ${strategy.pnlDirection}`, text: strategy.pnlText }),
    h("p", { className: "quiet", text: strategy.activity }),
    h("div", { className: "lines" }, strategy.coins.map((coin) => h("p", { className: "coin-line", text: coin.line }))),
    ...strategy.coins.filter((coin) => coin.note).map((coin) => h("p", { className: "status", text: coin.note })),
    h("p", { className: "blurb", text: strategy.blurb }),
  ]);
}

function render(view, errorMessage) {
  const shown = filter === "all" ? view.trades : view.trades.filter((trade) => trade.strategyId === filter);
  const trades = shown.map((trade) =>
    h("article", { className: "trade card" }, [
      h("h3", { text: `${trade.side} ${trade.coin}` }),
      h("dl", { className: "facts" }, [
        fact("Time", trade.time),
        fact("Strategy", trade.strategyName),
        fact("Coin", trade.coin),
        fact("Side", trade.side),
        fact("Price", trade.price),
        fact("Size", trade.size),
        fact("Reason", trade.reason),
      ]),
    ]),
  );

  const filterButtons = view.filters.map((item) => {
    const button = h("button", {
      type: "button",
      className: item.id === filter ? "chip on" : "chip",
      text: item.label,
      "aria-pressed": item.id === filter ? "true" : "false",
    });
    button.addEventListener("click", () => {
      filter = item.id;
      if (lastView) render(lastView);
    });
    return button;
  });

  const nodes = [
    errorMessage ? h("p", { className: "banner", role: "alert", text: errorMessage }) : null,
    h("section", { className: "block day-block", "aria-labelledby": "day-heading" }, [
      h("h2", { id: "day-heading", text: "Day trades" }),
      h("p", {
        className: "quiet lead",
        text: "Three separate $100 piles. 15-minute prices. Buys can use earlier candles so the averages exist at midnight, but nothing is bought before then.",
      }),
      h("div", { className: "stack" }, view.day.map((strategy, index) => dayCard(strategy, index))),
      h("p", { className: "guardrail", text: view.guardrail }),
    ]),
    h("section", { className: "card benchmark" }, [
      h("h2", { text: "Just holding Bitcoin" }),
      h("p", {
        className: "lead",
        text: "The same $100 bought Bitcoin at the first finished 15-minute price and held it, with the same fee and price cushion.",
      }),
      h("p", { className: "benchmark-value", id: "benchmark", text: view.benchmarkBalance }),
      h("p", { className: `pnl ${view.benchmarkDirection}`, text: view.benchmarkPnlText }),
      h("p", { className: "quiet", text: view.benchmarkDetail }),
      h("div", { className: "lines" }, view.benchmarkComparisons.map((line) => h("p", { className: "comparison", text: line }))),
    ]),
    h("section", { className: "card slow-card" }, [
      h("h2", { text: "Slower crossover" }),
      h("p", { className: "label", text: "For comparison. Hourly prices. Its own $100." }),
      h("p", { className: "slow-value", id: "slow-balance", text: view.slow.balance }),
      h("p", { className: `pnl ${view.slow.pnlDirection}`, text: view.slow.pnlText }),
      h("p", { className: "quiet", text: view.slow.activity }),
      h("div", { className: "lines" }, view.slow.coins.map((coin) => h("p", { className: "coin-line", text: coin.line }))),
      h("p", { className: "blurb", id: "how", text: view.slow.how }),
    ]),
    h("section", { className: "block", id: "trade-log", "aria-labelledby": "log-heading" }, [
      h("h2", { id: "log-heading", text: "Trade log" }),
      h("div", { className: "filters", role: "group", "aria-label": "Filter the trade log by strategy" }, filterButtons),
      shown.length ? h("p", { className: "quiet", text: view.tradeIntro }) : null,
      h(
        "div",
        { className: "stack" },
        trades.length
          ? trades
          : [h("div", { className: "card empty" }, [h("p", { text: view.trades.length ? view.filteredEmpty : view.emptyTrades })])],
      ),
    ]),
    h("p", { className: "meta", id: "as-of", text: view.asOf }),
  ];
  content.replaceChildren(...nodes.filter(Boolean));
}

async function load() {
  refresh.disabled = true;
  refresh.textContent = "Loading…";
  if (!lastView) renderLoading();
  try {
    const startMs = Date.parse(CONFIG.startTime);
    const now = Date.now();
    const books = await loadBooks({
      coins: CONFIG.coins,
      hourlyFrom: startMs - (CONFIG.slowHours + 2) * HOUR_MS,
      quarterFrom: startMs - 24 * HOUR_MS,
      toMs: now,
      now,
    });
    const dayAccounts = dayStrategies.map((strategy) =>
      runRiskAccount({ candlesByCoin: books.quarter, config: CONFIG, strategy }),
    );
    const slowAccount = runPaperAccount({
      candlesByCoin: books.hourly,
      config: CONFIG,
      strategy: slowStrategy,
    });
    const benchmark = runBenchmark({
      candles: books.quarter.BTC || [],
      config: CONFIG,
      startMs,
    });
    lastView = buildViewModel({
      dayAccounts,
      slowAccount,
      benchmark,
      sourceLabel: books.sourceLabel,
      config: CONFIG,
      slowSummary: slowStrategy.summary,
    });
    render(lastView);
    liveStatus.textContent = "Prices updated.";
  } catch (error) {
    console.error(error);
    const message = "Prices didn't load. Check your connection and tap Update.";
    if (!lastView) renderError(message);
    else render(lastView, message);
    liveStatus.textContent = message;
  } finally {
    refresh.disabled = false;
    refresh.textContent = "Update";
  }
}

refresh.addEventListener("click", () => {
  if (!refresh.disabled) load();
});

load();
