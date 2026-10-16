import {
  directionOf,
  formatChicago,
  formatCoinSize,
  formatMoney,
  formatPercent,
} from "./format.js";
import { strategySummary } from "./strategy.js";

function pnlSentence(pnl, fraction, sinceLabel) {
  const direction = directionOf(pnl);
  if (direction === "up") {
    return { direction, text: `Up ${formatMoney(pnl)} (${formatPercent(fraction)}) since ${sinceLabel}.` };
  }
  if (direction === "down") {
    return { direction, text: `Down ${formatMoney(Math.abs(pnl))} (${formatPercent(fraction)}) since ${sinceLabel}.` };
  }
  return { direction: "flat", text: `Even since ${sinceLabel}.` };
}

function comparisonText(equity, benchmarkEquity) {
  const gap = equity - benchmarkEquity;
  if (Math.abs(gap) < 0.005) return "About even with just holding Bitcoin.";
  if (gap > 0) return `Ahead of just holding Bitcoin by ${formatMoney(gap)}.`;
  return `Behind just holding Bitcoin by ${formatMoney(Math.abs(gap))}.`;
}

function coinLines(coin, config) {
  const averages =
    coin.fast == null || coin.slow == null
      ? "The averages need more finished hours."
      : `${config.fastHours}-hour average ${formatMoney(coin.fast)} · ${config.slowHours}-hour average ${formatMoney(coin.slow)}`;

  let status;
  if (coin.state === "holding") {
    status = `Holding ${formatCoinSize(coin.qty, coin.id)}, bought at ${formatMoney(coin.entryPrice)}. Safety sale at ${formatMoney(coin.stopPrice)}.`;
  } else if (coin.state === "above" && !coin.hasSold) {
    status = "In cash. The recent average is already higher, but it only buys when that average crosses up after the start.";
  } else if (coin.state === "above") {
    status = "In cash. It will buy again only when the recent average crosses up once more.";
  } else if (coin.state === "below") {
    status = "In cash. The recent average is below the longer one.";
  } else if (coin.state === "even") {
    status = "In cash. The two averages are level.";
  } else {
    status = "Not enough finished hourly prices yet.";
  }

  const sleeve =
    coin.qty > 0 ? `This pile is worth ${formatMoney(coin.marketValue)}.` : `${formatMoney(coin.cash)} in cash.`;

  return {
    id: coin.id,
    name: coin.name,
    price: coin.price == null ? "No finished price yet." : `Latest hourly price ${formatMoney(coin.price)}`,
    averages,
    sleeve,
    status,
  };
}

export function buildViewModel({ account, sourceLabel, config, summary = strategySummary(config) }) {
  const since = formatChicago(Date.parse(config.startTime));
  const pnl = pnlSentence(account.pnl, account.pnl / account.startingCash, since);
  const benchmarkPnl = pnlSentence(
    account.benchmark.pnl,
    account.benchmark.pnl / account.startingCash,
    since,
  );

  let benchmarkDetail;
  if (account.benchmark.waiting) {
    benchmarkDetail = "No finished hourly price since the start, so this comparison is still the original $100.";
  } else {
    benchmarkDetail = `Bought ${formatCoinSize(account.benchmark.size, "BTC")} at ${formatMoney(account.benchmark.entryPrice)} on ${formatChicago(account.benchmark.entryTime)}. Latest hourly price ${formatMoney(account.benchmark.lastPrice)}.`;
  }

  const hourCount = account.hoursSinceStart;
  const hourLabel = hourCount === 1 ? "1 finished hour" : `${hourCount} finished hours`;
  const asOf = account.lastCloseTime
    ? `${sourceLabel} · through ${formatChicago(account.lastCloseTime)} · ${hourLabel} since the start.`
    : `${sourceLabel}. No finished hour since the start yet.`;

  const trades = account.trades.map((trade) => ({
    side: trade.side === "buy" ? "Buy" : "Sell",
    coin: trade.coinName,
    time: formatChicago(trade.time),
    price: formatMoney(trade.price),
    size: formatCoinSize(trade.size, trade.coinId),
    reason: trade.reason,
  }));

  let pnlText = pnl.text;
  if (hourCount === 0) {
    pnlText = `No finished hour since ${since} yet. The balance stays at ${formatMoney(account.startingCash)} until then.`;
  }

  return {
    balance: formatMoney(account.equity),
    pnlText,
    pnlDirection: hourCount === 0 ? "flat" : pnl.direction,
    cashText: `${formatMoney(account.cash)} still in cash · ${formatMoney(account.invested)} in coins.`,
    benchmarkBalance: formatMoney(account.benchmark.equity),
    benchmarkPnlText: account.benchmark.waiting ? "Waiting for the first finished hour." : benchmarkPnl.text,
    benchmarkDirection: account.benchmark.waiting ? "flat" : benchmarkPnl.direction,
    benchmarkDetail,
    comparison: comparisonText(account.equity, account.benchmark.equity),
    coins: account.coins.map((coin) => coinLines(coin, config)),
    how: `${summary} Started ${since}. It does not borrow, and it does not bet on a coin falling. Every phone rebuilds these trades from the public hourly prices, so they match.`,
    trades,
    emptyTrades:
      "No trades yet. Nothing has crossed since the start. When it buys or sells, this log shows the time (Central time, Chicago), coin, side, price, size, and reason.",
    tradeIntro: "Times are Central time (Chicago). The price is what the paper trade paid or received, after the cushion.",
    asOf,
    feesText: account.feesPaid > 0.0000001 ? `Fees paid so far: ${formatMoney(account.feesPaid)}.` : "",
  };
}
