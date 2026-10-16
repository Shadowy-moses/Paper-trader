// Rebuilds the paper account from finished hourly candles.
// Same candles in, same trades out. Nothing is stored on the phone.

import { assertConfig } from "./config.js";
import { createStrategy } from "./strategy.js";

export function splitCash(total, count) {
  const cents = Math.round(total * 100);
  const base = Math.floor(cents / count);
  let remainder = cents - base * count;
  const parts = [];
  for (let i = 0; i < count; i += 1) {
    const extra = remainder > 0 ? 1 : 0;
    if (remainder > 0) remainder -= 1;
    parts.push((base + extra) / 100);
  }
  return parts;
}

export function buyAll({ cash, rawPrice, feeRate, slippageRate }) {
  if (!(cash > 0) || !(rawPrice > 0)) return null;
  const price = rawPrice * (1 + slippageRate);
  const fee = cash * feeRate;
  const qty = (cash - fee) / price;
  if (!(qty > 0) || !Number.isFinite(qty)) return null;
  return { price, qty, fee, cash: 0 };
}

export function sellAll({ qty, rawPrice, feeRate, slippageRate }) {
  if (!(qty > 0) || !(rawPrice > 0)) return null;
  const price = rawPrice * (1 - slippageRate);
  const gross = qty * price;
  const fee = gross * feeRate;
  const proceeds = gross - fee;
  if (!Number.isFinite(proceeds)) return null;
  return { price, qty, fee, cash: proceeds };
}

function orderedCandles(candles) {
  return [...(candles || [])].sort((a, b) => a.openTime - b.openTime);
}

function runSleeve({ coin, order, candles, cash, config, strategy, startMs }) {
  candles = orderedCandles(candles);
  let position = null;
  const trades = [];
  let sequence = 0;

  for (let index = 0; index < candles.length; index += 1) {
    const bar = candles[index];
    if (bar.openTime < startMs) continue;

    const decision = strategy.decide({ coin, candles, index, position });
    if (!decision || decision.action === "hold") continue;

    if (decision.action === "buy" && !position) {
      const fill = buyAll({
        cash,
        rawPrice: decision.rawPrice,
        feeRate: config.feeRate,
        slippageRate: config.slippageRate,
      });
      if (!fill) continue;
      position = {
        qty: fill.qty,
        entryPrice: fill.price,
        stopPrice: strategy.stopPrice(fill.price),
      };
      cash = fill.cash;
      trades.push({
        sequence,
        time: bar.closeTime,
        coinId: coin.id,
        coinName: coin.name,
        coinOrder: order,
        side: "buy",
        price: fill.price,
        size: fill.qty,
        fee: fill.fee,
        reason: decision.reason,
      });
      sequence += 1;
      continue;
    }

    if (decision.action === "sell" && position) {
      const fill = sellAll({
        qty: position.qty,
        rawPrice: decision.rawPrice,
        feeRate: config.feeRate,
        slippageRate: config.slippageRate,
      });
      if (!fill) continue;
      const soldQty = position.qty;
      position = null;
      cash += fill.cash;
      trades.push({
        sequence,
        time: bar.closeTime,
        coinId: coin.id,
        coinName: coin.name,
        coinOrder: order,
        side: "sell",
        price: fill.price,
        size: soldQty,
        fee: fill.fee,
        reason: decision.reason,
      });
      sequence += 1;
    }
  }

  const last = candles.at(-1) || null;
  const price = last ? last.close : null;
  const marketValue = position && price != null ? position.qty * price : 0;
  const status = strategy.status({
    candles,
    index: candles.length - 1,
    position,
    hasSold: trades.some((trade) => trade.side === "sell"),
  });

  return {
    id: coin.id,
    name: coin.name,
    cash,
    price,
    marketValue,
    equity: cash + marketValue,
    qty: position ? position.qty : 0,
    entryPrice: position ? position.entryPrice : null,
    stopPrice: position ? position.stopPrice : null,
    fast: status.fast,
    slow: status.slow,
    state: status.state,
    hasSold: trades.some((trade) => trade.side === "sell"),
    lastCloseTime: last ? last.closeTime : null,
    hoursSinceStart: candles.filter((bar) => bar.openTime >= startMs).length,
    trades,
  };
}

export function runBenchmark({ candles, config, startMs }) {
  const tradable = orderedCandles(candles).filter((bar) => bar.openTime >= startMs);
  if (tradable.length === 0) {
    return {
      equity: config.startingCash,
      pnl: 0,
      entryTime: null,
      entryPrice: null,
      size: 0,
      lastPrice: null,
      waiting: true,
    };
  }
  const entry = tradable[0];
  const last = tradable.at(-1);
  const fill = buyAll({
    cash: config.startingCash,
    rawPrice: entry.close,
    feeRate: config.feeRate,
    slippageRate: config.slippageRate,
  });
  const equity = fill.qty * last.close;
  return {
    equity,
    pnl: equity - config.startingCash,
    entryTime: entry.closeTime,
    entryPrice: fill.price,
    size: fill.qty,
    lastPrice: last.close,
    waiting: false,
  };
}

export function runPaperAccount({ candlesByCoin, config, strategy = createStrategy(config) }) {
  assertConfig(config);
  const startMs = Date.parse(config.startTime);
  const sleeves = splitCash(config.startingCash, config.coins.length);
  const coins = config.coins.map((coin, order) => {
    const candles = candlesByCoin[coin.id] || [];
    return runSleeve({
      coin,
      order,
      candles,
      cash: sleeves[order],
      config,
      strategy,
      startMs,
    });
  });

  const btc = config.coins.find((coin) => coin.id === "BTC");
  const benchmark = runBenchmark({
    candles: candlesByCoin[btc.id] || [],
    config,
    startMs,
  });

  const trades = coins
    .flatMap((coin) => coin.trades)
    .sort((a, b) => b.time - a.time || a.coinOrder - b.coinOrder || b.sequence - a.sequence);

  const equity = coins.reduce((sum, coin) => sum + coin.equity, 0);
  const cash = coins.reduce((sum, coin) => sum + coin.cash, 0);
  const invested = coins.reduce((sum, coin) => sum + coin.marketValue, 0);
  const feesPaid = trades.reduce((sum, trade) => sum + trade.fee, 0);
  const closeTimes = coins.map((coin) => coin.lastCloseTime).filter((time) => time != null);

  return {
    startingCash: config.startingCash,
    equity,
    pnl: equity - config.startingCash,
    cash,
    invested,
    feesPaid,
    hoursSinceStart: Math.min(...coins.map((coin) => coin.hoursSinceStart)),
    lastCloseTime: closeTimes.length ? Math.min(...closeTimes) : null,
    benchmark,
    coins,
    trades,
  };
}
