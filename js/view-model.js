import { formatChicago, formatCoinSize, formatMoney, formatPercent, formatRate, directionOf } from "./format.js";
import { strategySummary } from "./strategy.js";

function tradeWord(count) {
  return count === 1 ? "1 trade" : `${count} trades`;
}

function signed(amount) {
  if (amount > 0.005) return `up ${formatMoney(amount)}`;
  if (amount < -0.005) return `down ${formatMoney(Math.abs(amount))}`;
  return "even";
}

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

function comparisonText(equity, benchmarkEquity, subject) {
  const gap = equity - benchmarkEquity;
  if (Math.abs(gap) < 0.005) return `${subject} is about even with just holding Bitcoin.`;
  if (gap > 0) return `${subject} is ahead of just holding Bitcoin by ${formatMoney(gap)}.`;
  return `${subject} is behind just holding Bitcoin by ${formatMoney(Math.abs(gap))}.`;
}

function coinLine(coin) {
  if (coin.tradeCount === 0) return `${coin.name} · no trades`;
  const fees = coin.fees > 0.0000001 ? ` · ${formatMoney(coin.fees)} fees` : "";
  return `${coin.name} · ${signed(coin.pnl)} · ${tradeWord(coin.tradeCount)}${fees}`;
}

function presentDay(account, since) {
  const pnl = pnlSentence(account.pnl, account.pnl / account.startingCash, since);
  return {
    id: account.id,
    name: account.name,
    blurb: account.blurb,
    balance: formatMoney(account.equity),
    pnlText: account.candleCount === 0
      ? `No finished 15-minute candle since ${since} yet.`
      : pnl.text,
    pnlDirection: account.candleCount === 0 ? "flat" : pnl.direction,
    activity: `${tradeWord(account.tradeCount)} · ${formatMoney(account.feesPaid)} in fees`,
    coins: account.coins.map((coin) => ({
      id: coin.id,
      line: coinLine(coin),
      note: coin.qty > 0 || coin.status.startsWith("Paused") ? `${coin.name}: ${coin.status}` : "",
    })),
  };
}

export function buildViewModel({
  dayAccounts,
  slowAccount,
  benchmark,
  sourceLabel,
  config,
  slowSummary = strategySummary(config),
}) {
  const since = formatChicago(Date.parse(config.startTime));
  const day = dayAccounts.map((account) => presentDay(account, since));
  const slowPnl = pnlSentence(slowAccount.pnl, slowAccount.pnl / slowAccount.startingCash, since);
  const benchmarkPnl = pnlSentence(benchmark.pnl, benchmark.pnl / config.startingCash, since);

  let benchmarkDetail;
  if (benchmark.waiting) {
    benchmarkDetail = "No finished 15-minute Bitcoin price since the start, so this comparison is still the original $100.";
  } else {
    benchmarkDetail = `Bought ${formatCoinSize(benchmark.size, "BTC")} at ${formatMoney(benchmark.entryPrice)} on ${formatChicago(benchmark.entryTime)}. Latest 15-minute price ${formatMoney(benchmark.lastPrice)}.`;
  }

  const trades = [...dayAccounts.flatMap((account) => account.trades), ...slowAccount.trades]
    .map((trade) => ({
      strategyId: trade.strategyId,
      strategyName: trade.strategyName,
      side: trade.side === "buy" ? "Buy" : "Sell",
      coin: trade.coinName,
      time: formatChicago(trade.time),
      price: formatMoney(trade.price),
      size: formatCoinSize(trade.size, trade.coinId),
      reason: trade.reason,
      sortTime: trade.time,
      sortOrder: trade.coinOrder ?? 0,
    }))
    .sort((a, b) => b.sortTime - a.sortTime || a.sortOrder - b.sortOrder);

  const quarterCount = dayAccounts[0] ? dayAccounts[0].candleCount : 0;
  const quarterTime = dayAccounts[0] ? dayAccounts[0].lastCloseTime : null;
  const asOfParts = [sourceLabel];
  if (quarterTime) asOfParts.push(`15-minute through ${formatChicago(quarterTime)}`);
  if (slowAccount.lastCloseTime) asOfParts.push(`hourly through ${formatChicago(slowAccount.lastCloseTime)}`);
  asOfParts.push(`${quarterCount === 1 ? "1 finished 15-minute candle" : `${quarterCount} finished 15-minute candles`} since the start`);

  return {
    since,
    day,
    guardrail: `Each buy is sized so the stop loses at most ${formatRate(config.day.riskFraction)}% of that strategy's balance. After ${config.day.maxLossesPerDay} losses in a Chicago day, that strategy waits until tomorrow. Anything still open is sold at midnight Central time. RSI is a 0–100 strength number. The average swing is ATR, from the last ${config.day.atrPeriod} candles.`,
    benchmarkBalance: formatMoney(benchmark.equity),
    benchmarkPnlText: benchmark.waiting ? "Waiting for the first finished 15-minute candle." : benchmarkPnl.text,
    benchmarkDirection: benchmark.waiting ? "flat" : benchmarkPnl.direction,
    benchmarkDetail,
    benchmarkComparisons: [
      ...dayAccounts.map((account) => comparisonText(account.equity, benchmark.equity, account.name)),
      comparisonText(slowAccount.equity, benchmark.equity, "The slower crossover"),
    ],
    slow: {
      balance: formatMoney(slowAccount.equity),
      pnlText: slowAccount.hoursSinceStart === 0
        ? `No finished hour since ${since} yet.`
        : slowPnl.text,
      pnlDirection: slowAccount.hoursSinceStart === 0 ? "flat" : slowPnl.direction,
      activity: `${tradeWord(slowAccount.trades.length)} · ${formatMoney(slowAccount.feesPaid)} in fees`,
      how: `Its own ${formatMoney(config.startingCash).replace(".00", "")}, using hourly prices. ${slowSummary}`,
      coins: slowAccount.coins.map((coin) => ({
        id: coin.id,
        name: coin.name,
        line: coin.qty > 0
          ? `${coin.name} · holding ${formatCoinSize(coin.qty, coin.id)}`
          : `${coin.name} · ${formatMoney(coin.cash)} in cash`,
      })),
    },
    trades,
    filters: [
      { id: "all", label: "All" },
      { id: "breakout", label: "Breakout" },
      { id: "pullback", label: "Pullback" },
      { id: "bounce", label: "Bounce" },
      { id: "ma-crossover-stop", label: "Slower" },
    ],
    tradeIntro: "Times are Central time (Chicago). The price includes the small cushion.",
    emptyTrades: "No trades yet. When something buys or sells, this log shows the time, strategy, coin, side, price, size, and reason.",
    filteredEmpty: "No trades for this filter yet.",
    asOf: `${asOfParts.join(" · ")}.`,
  };
}
