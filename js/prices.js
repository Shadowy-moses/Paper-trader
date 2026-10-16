// Public prices, fetched in the browser. No key.
//
// Primary: Binance market-data host (data-api.binance.vision). It sends
// Access-Control-Allow-Origin: * and returns open/high/low/close/volume.
// api.binance.com itself is often blocked (HTTP 451) and is not used.
//
// Fallback: Coinbase Exchange public candles, also Allow-Origin: *.
// The slower strategy uses hourly candles. The day signals use 15-minute candles.
// If Binance fails, every series switches to Coinbase together.

import { HOUR_MS, QUARTER_HOUR_MS } from "./config.js";

const BINANCE_URL = "https://data-api.binance.vision/api/v3/klines";
const COINBASE_URL = "https://api.exchange.coinbase.com/products";
const MAX_PAGES = 20;

const INTERVALS = {
  "1h": { binance: "1h", coinbaseSeconds: 3600, ms: HOUR_MS },
  "15m": { binance: "15m", coinbaseSeconds: 900, ms: QUARTER_HOUR_MS },
};

export function isClosedCandle(candle, now) {
  return candle.closeTime <= now;
}

function candleFromOpen(openTime, open, high, low, close, volume, durationMs) {
  const numbers = [openTime, open, high, low, close].map(Number);
  if (numbers.some((value) => !Number.isFinite(value))) return null;
  const [time, openPrice, highPrice, lowPrice, closePrice] = numbers;
  if (time <= 0 || openPrice <= 0 || highPrice <= 0 || lowPrice <= 0 || closePrice <= 0) return null;
  if (highPrice < lowPrice) return null;
  const parsedVolume = Number(volume);
  return {
    openTime: time,
    closeTime: time + durationMs,
    open: openPrice,
    high: highPrice,
    low: lowPrice,
    close: closePrice,
    volume: Number.isFinite(parsedVolume) && parsedVolume >= 0 ? parsedVolume : 0,
  };
}

export function parseBinanceKlines(rows, durationMs = HOUR_MS) {
  if (!Array.isArray(rows)) throw new Error("Unexpected price data.");
  return rows
    .map((row) => candleFromOpen(row[0], row[1], row[2], row[3], row[4], row[5], durationMs))
    .filter(Boolean);
}

export function parseCoinbaseCandles(rows, durationMs = HOUR_MS) {
  if (!Array.isArray(rows)) {
    const message = rows && rows.message ? rows.message : "Unexpected price data.";
    throw new Error(message);
  }
  // Coinbase rows are [time in seconds, low, high, open, close, volume].
  return rows
    .map((row) => candleFromOpen(Number(row[0]) * 1000, row[3], row[2], row[1], row[4], row[5], durationMs))
    .filter(Boolean);
}

export function stitchCandles(batches, fromMs, now) {
  const byOpen = new Map();
  for (const candle of batches.flat()) {
    if (candle.openTime < fromMs) continue;
    if (!isClosedCandle(candle, now)) continue;
    byOpen.set(candle.openTime, candle);
  }
  return [...byOpen.values()].sort((a, b) => a.openTime - b.openTime);
}

async function getJson(url, fetchImpl) {
  const response = await fetchImpl(url, {
    cache: "no-store",
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) {
    throw new Error(`Price request failed (${response.status}).`);
  }
  return response.json();
}

async function fetchBinanceCandles(coin, fromMs, toMs, now, fetchImpl, interval) {
  const batches = [];
  let cursor = fromMs;
  for (let page = 0; page < MAX_PAGES && cursor < toMs; page += 1) {
    const url = new URL(BINANCE_URL);
    url.searchParams.set("symbol", coin.binanceSymbol);
    url.searchParams.set("interval", interval.binance);
    url.searchParams.set("startTime", String(cursor));
    url.searchParams.set("endTime", String(toMs));
    url.searchParams.set("limit", "1000");
    const rows = await getJson(url, fetchImpl);
    if (!Array.isArray(rows) || rows.length === 0) break;
    batches.push(parseBinanceKlines(rows, interval.ms));
    const lastOpen = Number(rows[rows.length - 1][0]);
    const next = lastOpen + interval.ms;
    if (!(next > cursor)) break;
    cursor = next;
    if (rows.length < 1000) break;
  }
  return stitchCandles(batches, fromMs, now);
}

async function fetchCoinbaseCandles(coin, fromMs, toMs, now, fetchImpl, interval) {
  const batches = [];
  const chunk = 299 * interval.ms;
  let cursor = fromMs;
  for (let page = 0; page < MAX_PAGES && cursor < toMs; page += 1) {
    const end = Math.min(cursor + chunk, toMs);
    const url = new URL(`${COINBASE_URL}/${coin.coinbaseProduct}/candles`);
    url.searchParams.set("granularity", String(interval.coinbaseSeconds));
    url.searchParams.set("start", String(Math.floor(cursor / 1000)));
    url.searchParams.set("end", String(Math.ceil(end / 1000)));
    const rows = await getJson(url, fetchImpl);
    batches.push(parseCoinbaseCandles(rows, interval.ms));
    if (!(end > cursor)) break;
    cursor = end;
  }
  return stitchCandles(batches, fromMs, now);
}

const SOURCES = [
  {
    id: "binance",
    label: "Binance public prices",
    fetchCandles: fetchBinanceCandles,
  },
  {
    id: "coinbase",
    label: "Coinbase public prices",
    fetchCandles: fetchCoinbaseCandles,
  },
];

async function loadFromSource(source, coins, fromMs, toMs, now, fetchImpl, intervalId) {
  const interval = INTERVALS[intervalId];
  if (!interval) throw new Error(`Unknown candle size ${intervalId}.`);
  const pairs = await Promise.all(
    coins.map(async (coin) => {
      const candles = await source.fetchCandles(coin, fromMs, toMs, now, fetchImpl, interval);
      if (candles.length === 0) throw new Error(`No finished prices for ${coin.name}.`);
      return [coin.id, candles];
    }),
  );
  return Object.fromEntries(pairs);
}

export async function loadMarket({
  coins,
  fromMs,
  toMs,
  now = Date.now(),
  fetchImpl = globalThis.fetch,
  interval = "1h",
}) {
  let lastError = null;
  for (const source of SOURCES) {
    try {
      const candles = await loadFromSource(source, coins, fromMs, toMs, now, fetchImpl, interval);
      return { sourceId: source.id, sourceLabel: source.label, candles };
    } catch (error) {
      lastError = error;
    }
  }
  const message = lastError && lastError.message ? lastError.message : "Couldn't load prices.";
  throw new Error(message);
}

export async function loadBooks({
  coins,
  hourlyFrom,
  quarterFrom,
  toMs,
  now = Date.now(),
  fetchImpl = globalThis.fetch,
}) {
  let lastError = null;
  for (const source of SOURCES) {
    try {
      const hourly = await loadFromSource(source, coins, hourlyFrom, toMs, now, fetchImpl, "1h");
      const quarter = await loadFromSource(source, coins, quarterFrom, toMs, now, fetchImpl, "15m");
      return { sourceId: source.id, sourceLabel: source.label, hourly, quarter };
    } catch (error) {
      lastError = error;
    }
  }
  const message = lastError && lastError.message ? lastError.message : "Couldn't load prices.";
  throw new Error(message);
}
