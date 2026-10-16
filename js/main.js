import { CONFIG, HOUR_MS, assertConfig } from "./config.js";
import { runPaperAccount } from "./engine.js";
import { loadMarket } from "./prices.js";
import { createStrategy } from "./strategy.js";
import { buildViewModel } from "./view-model.js";

const content = document.querySelector("#content");
const refresh = document.querySelector("#refresh");
const liveStatus = document.querySelector("#live-status");

assertConfig(CONFIG);
const strategy = createStrategy(CONFIG);
let lastView = null;

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
      h("p", { text: "Fetching public hourly prices for Bitcoin, Ethereum, and Solana." }),
    ]),
  );
}

function renderError(message) {
  content.replaceChildren(
    h("section", { className: "card" }, [
      h("h2", { text: "Prices didn't load" }),
      h("p", {
        text: "Check your connection and tap Update. The page needs public hourly prices from Binance, or from Coinbase if Binance is down.",
      }),
      h("p", { className: "quiet", text: message }),
    ]),
  );
}

function render(view, errorMessage) {
  const trades = view.trades.map((trade) =>
    h("article", { className: "trade card" }, [
      h("h3", { text: `${trade.side} ${trade.coin}` }),
      h("dl", { className: "facts" }, [
        fact("Time", trade.time),
        fact("Coin", trade.coin),
        fact("Side", trade.side),
        fact("Price", trade.price),
        fact("Size", trade.size),
        fact("Reason", trade.reason),
      ]),
    ]),
  );

  content.replaceChildren(
    errorMessage ? h("p", { className: "banner", role: "alert", text: errorMessage }) : null,
    h("section", { className: "card balance", "aria-labelledby": "balance-label" }, [
      h("p", { className: "label", id: "balance-label", text: "Fake balance" }),
      h("p", { className: "balance-value", id: "balance", text: view.balance }),
      h("p", { className: `pnl ${view.pnlDirection}`, id: "pnl", text: view.pnlText }),
      h("p", { className: "quiet", text: view.cashText }),
      view.feesText ? h("p", { className: "quiet", text: view.feesText }) : null,
    ]),
    h("section", { className: "card benchmark" }, [
      h("h2", { text: "Just holding Bitcoin" }),
      h("p", {
        className: "lead",
        text: "The same $100 bought Bitcoin at the start and held it, with the same fee and price cushion.",
      }),
      h("p", { className: "benchmark-value", id: "benchmark", text: view.benchmarkBalance }),
      h("p", { className: `pnl ${view.benchmarkDirection}`, text: view.benchmarkPnlText }),
      h("p", { className: "quiet", text: view.benchmarkDetail }),
      h("p", { className: "comparison", id: "comparison", text: view.comparison }),
    ]),
    h("section", { className: "block", "aria-labelledby": "coins-heading" }, [
      h("h2", { id: "coins-heading", text: "Coins" }),
      h(
        "div",
        { className: "stack" },
        view.coins.map((coin) =>
          h("article", { className: "card coin" }, [
            h("div", { className: "coin-top" }, [
              h("h3", { text: coin.name }),
              h("p", { className: "symbol", text: coin.id }),
            ]),
            h("p", { className: "price-line", text: coin.price }),
            h("p", { className: "quiet", text: coin.averages }),
            h("p", { className: "sleeve", text: coin.sleeve }),
            h("p", { className: "status", text: coin.status }),
          ]),
        ),
      ),
    ]),
    h("section", { className: "block", "aria-labelledby": "how-heading" }, [
      h("h2", { id: "how-heading", text: "How it decides" }),
      h("p", { id: "how", text: view.how }),
    ]),
    h("section", { className: "block", id: "trade-log", "aria-labelledby": "log-heading" }, [
      h("h2", { id: "log-heading", text: "Trade log" }),
      view.trades.length ? h("p", { className: "quiet", text: view.tradeIntro }) : null,
      h(
        "div",
        { className: "stack" },
        trades.length ? trades : [h("div", { className: "card empty" }, [h("p", { text: view.emptyTrades })])],
      ),
    ]),
    h("p", { className: "meta", id: "as-of", text: view.asOf }),
  );
}

async function load() {
  refresh.disabled = true;
  refresh.textContent = "Loading…";
  if (!lastView) renderLoading();
  try {
    const startMs = Date.parse(CONFIG.startTime);
    const now = Date.now();
    const market = await loadMarket({
      coins: CONFIG.coins,
      fromMs: startMs - (CONFIG.slowHours + 2) * HOUR_MS,
      toMs: now,
      now,
    });
    const account = runPaperAccount({
      candlesByCoin: market.candles,
      config: CONFIG,
      strategy,
    });
    lastView = buildViewModel({
      account,
      sourceLabel: market.sourceLabel,
      config: CONFIG,
      summary: strategy.summary,
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
