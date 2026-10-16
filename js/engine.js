// Rebuilds the paper account from finished hourly candles.
// Same candles in, same trades out. Nothing is stored on the phone.

import { chicagoDateKey, isChicagoMidnight } from "./chicago.js";
import { assertConfig } from "./config.js";
import { buySpend, sizeForStop } from "./risk.js";
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
        strategyId: strategy.id,
        strategyName: strategy.name,
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
        strategyId: strategy.id,
        strategyName: strategy.name,
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

function markPrice(positions, lastPrice, id) {
  return lastPrice[id] ?? null;
}

function accountEquity(cash, coins, positions, lastPrice) {
  let total = cash;
  for (const coin of coins) {
    const position = positions[coin.id];
    if (!position) continue;
    const price = markPrice(positions, lastPrice, coin.id);
    if (price == null) return null;
    total += position.qty * price;
  }
  return total;
}

function lossesOnDay(trades, dayKey) {
  return trades.filter((trade) => trade.side === "sell" && trade.loss && trade.dayKey === dayKey).length;
}

export function runRiskAccount({ candlesByCoin, config, strategy }) {
  assertConfig(config);
  const coins = config.coins;
  const startMs = Date.parse(config.startTime);
  const ordered = {};
  const indexByOpen = {};
  for (const coin of coins) {
    ordered[coin.id] = orderedCandles(candlesByCoin[coin.id] || []);
    indexByOpen[coin.id] = new Map(ordered[coin.id].map((bar, index) => [bar.openTime, index]));
  }
  const times = [
    ...new Set(
      coins.flatMap((coin) => ordered[coin.id].map((bar) => bar.openTime).filter((time) => time >= startMs)),
    ),
  ].sort((a, b) => a - b);

  let cash = config.startingCash;
  const positions = {};
  const lastPrice = {};
  const trades = [];
  let sequence = 0;

  const pushTrade = (trade) => {
    trades.push({ ...trade, sequence, strategyId: strategy.id, strategyName: strategy.name });
    sequence += 1;
  };

  for (const openTime of times) {
    const exited = new Set();
    for (const coin of coins) {
      const index = indexByOpen[coin.id].get(openTime);
      if (index == null) continue;
      const candles = ordered[coin.id];
      const bar = candles[index];
      lastPrice[coin.id] = bar.close;
      const position = positions[coin.id];
      if (!position) continue;
      const exit = strategy.exit({ candles, index, position, bar });
      if (!exit || exit.action !== "sell") continue;
      const fill = sellAll({
        qty: position.qty,
        rawPrice: exit.rawPrice,
        feeRate: config.feeRate,
        slippageRate: config.slippageRate,
      });
      if (!fill) continue;
      const proceeds = fill.cash;
      cash += proceeds;
      pushTrade({
        time: bar.closeTime,
        coinId: coin.id,
        coinName: coin.name,
        coinOrder: coins.indexOf(coin),
        side: "sell",
        price: fill.price,
        size: position.qty,
        fee: fill.fee,
        cost: position.cost,
        proceeds,
        loss: proceeds < position.cost - 1e-8,
        dayKey: chicagoDateKey(bar.openTime),
        reason: exit.reason,
      });
      positions[coin.id] = null;
      exited.add(coin.id);
    }

    for (const coin of coins) {
      const index = indexByOpen[coin.id].get(openTime);
      if (index == null || positions[coin.id] || exited.has(coin.id)) continue;
      const candles = ordered[coin.id];
      const bar = candles[index];
      if (isChicagoMidnight(bar.closeTime)) continue;
      const dayKey = chicagoDateKey(bar.openTime);
      if (lossesOnDay(trades, dayKey) >= config.day.maxLossesPerDay) continue;
      const equity = accountEquity(cash, coins, positions, lastPrice);
      if (equity == null) continue;
      const idea = strategy.entry({ candles, index, bar, day: config.day, equity, cash });
      if (!idea || !(idea.rawPrice > 0)) continue;
      const fillPrice = idea.rawPrice * (1 + config.slippageRate);
      const stopPrice = idea.stopFraction != null
        ? fillPrice * (1 - idea.stopFraction)
        : fillPrice - idea.stopOffset;
      if (!(stopPrice > 0) || !(stopPrice < fillPrice)) continue;
      const targetPrice = idea.targetMode === "sma20" ? null : fillPrice + idea.targetOffset;
      if (idea.targetMode !== "sma20" && !(targetPrice > fillPrice)) continue;
      const sized = sizeForStop({
        equity,
        cash,
        fillPrice,
        stopPrice,
        feeRate: config.feeRate,
        slippageRate: config.slippageRate,
        riskFraction: config.day.riskFraction,
      });
      if (!sized) continue;
      const bought = buySpend({
        spend: sized.spend,
        rawPrice: idea.rawPrice,
        feeRate: config.feeRate,
        slippageRate: config.slippageRate,
      });
      if (!bought) continue;
      cash -= sized.spend;
      positions[coin.id] = {
        qty: bought.qty,
        entryPrice: bought.price,
        stopPrice,
        targetPrice,
        targetMode: idea.targetMode || "fixed",
        cost: sized.spend,
        stopReason: idea.stopReason,
        targetReason: idea.targetReason,
      };
      pushTrade({
        time: bar.closeTime,
        coinId: coin.id,
        coinName: coin.name,
        coinOrder: coins.indexOf(coin),
        side: "buy",
        price: bought.price,
        size: bought.qty,
        fee: bought.fee,
        cost: sized.spend,
        proceeds: 0,
        loss: false,
        dayKey,
        reason: idea.reason,
      });
    }
  }

  const coinReports = coins.map((coin) => {
    const candles = ordered[coin.id];
    const last = candles.at(-1) || null;
    const position = positions[coin.id] || null;
    const price = last ? last.close : null;
    const marketValue = position && price != null ? position.qty * price : 0;
    const coinTrades = trades.filter((trade) => trade.coinId === coin.id);
    const realized = coinTrades
      .filter((trade) => trade.side === "sell")
      .reduce((sum, trade) => sum + (trade.proceeds - trade.cost), 0);
    const unrealized = position ? marketValue - position.cost : 0;
    const index = candles.length - 1;
    const dayKey = last && last.openTime >= startMs ? chicagoDateKey(last.openTime) : null;
    const blocked = dayKey != null && lossesOnDay(trades, dayKey) >= config.day.maxLossesPerDay;
    const status = strategy.status({
      candles,
      index,
      position,
      blocked,
    });
    return {
      id: coin.id,
      name: coin.name,
      pnl: realized + unrealized,
      fees: coinTrades.reduce((sum, trade) => sum + trade.fee, 0),
      tradeCount: coinTrades.length,
      qty: position ? position.qty : 0,
      status: status.text,
      lastCloseTime: last ? last.closeTime : null,
      candleCount: candles.filter((bar) => bar.openTime >= startMs).length,
    };
  });

  const equity = coinReports.reduce((sum, coin) => {
    const position = positions[coin.id];
    const price = lastPrice[coin.id];
    return sum + (position && price != null ? position.qty * price : 0);
  }, cash);
  const closeTimes = coinReports.map((coin) => coin.lastCloseTime).filter((time) => time != null);

  return {
    id: strategy.id,
    name: strategy.name,
    blurb: strategy.blurb || "",
    startingCash: config.startingCash,
    equity,
    pnl: equity - config.startingCash,
    cash,
    invested: equity - cash,
    feesPaid: trades.reduce((sum, trade) => sum + trade.fee, 0),
    tradeCount: trades.length,
    candleCount: coinReports.length ? Math.min(...coinReports.map((coin) => coin.candleCount)) : 0,
    lastCloseTime: closeTimes.length ? Math.min(...closeTimes) : null,
    coins: coinReports,
    trades,
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
