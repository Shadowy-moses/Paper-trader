import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { CONFIG, HOUR_MS } from "../js/config.js";
import {
  isClosedCandle,
  loadMarket,
  parseBinanceKlines,
  parseCoinbaseCandles,
  stitchCandles,
} from "../js/prices.js";
import { jsonResponse } from "./helpers.js";

const coins = CONFIG.coins;

describe("parsers", () => {
  test("reads a Binance hourly candle and ignores the still-open hour", () => {
    const open = 1_700_000_000_000;
    const candles = parseBinanceKlines([
      [open, "100", "110", "90", "105", "1", open + HOUR_MS - 1],
      [open + HOUR_MS, "105", "108", "99", "107", "1", open + 2 * HOUR_MS - 1],
    ]);
    assert.equal(candles[0].open, 100);
    assert.equal(candles[0].high, 110);
    assert.equal(candles[0].low, 90);
    assert.equal(candles[0].close, 105);
    assert.equal(candles[0].closeTime, open + HOUR_MS);
    const now = open + HOUR_MS + 10;
    const closed = stitchCandles([candles], open, now);
    assert.equal(closed.length, 1);
    assert.equal(isClosedCandle(candles[1], now), false);
  });

  test("reads Coinbase candles, which arrive newest first", () => {
    const openSec = 1_700_000_000;
    const candles = parseCoinbaseCandles([
      [openSec + 3600, 90, 110, 100, 105, 2],
      [openSec, 80, 100, 90, 95, 1],
    ]);
    const stitched = stitchCandles([candles], openSec * 1000, (openSec + 7200) * 1000);
    assert.deepEqual(
      stitched.map((candle) => candle.close),
      [95, 105],
    );
  });
});

describe("loadMarket", () => {
  test("uses Binance when it responds and does not call Coinbase", async () => {
    const calls = [];
    const start = 1_700_000_000_000;
    const fetchImpl = async (url) => {
      const href = String(url);
      calls.push(href);
      assert.equal(href.includes("coinbase"), false);
      const open = Number(new URL(href).searchParams.get("startTime"));
      return jsonResponse([[open, "10", "12", "9", "11", "1", open + HOUR_MS - 1]]);
    };
    const market = await loadMarket({
      coins,
      fromMs: start,
      toMs: start + 2 * HOUR_MS,
      now: start + 2 * HOUR_MS,
      fetchImpl,
    });
    assert.equal(market.sourceId, "binance");
    assert.equal(market.sourceLabel, "Binance public prices");
    assert.equal(Object.keys(market.candles).join(","), "BTC,ETH,SOL");
    assert.equal(market.candles.BTC.length, 1);
    assert.equal(calls.length, 3);
  });

  test("pages through Binance and drops the unfinished hour", async () => {
    const start = 1_700_000_000_000;
    const fetchImpl = async (url) => {
      const open = Number(new URL(String(url)).searchParams.get("startTime"));
      const count = open === start ? 1000 : 3;
      const rows = Array.from({ length: count }, (_, i) => {
        const time = open + i * HOUR_MS;
        return [time, "10", "11", "9", "10.5", "1", time + HOUR_MS - 1];
      });
      return jsonResponse(rows);
    };
    const now = start + 1002 * HOUR_MS;
    const market = await loadMarket({
      coins: [coins[0]],
      fromMs: start,
      toMs: start + 2000 * HOUR_MS,
      now,
      fetchImpl,
    });
    assert.equal(market.candles.BTC.length, 1002);
    assert.ok(market.candles.BTC.at(-1).closeTime <= now);
  });

  test("falls back to Coinbase for every coin when Binance fails", async () => {
    const start = 1_700_000_000_000;
    const fetchImpl = async (url) => {
      const href = String(url);
      if (href.includes("binance")) return jsonResponse({ msg: "down" }, 503);
      const params = new URL(href).searchParams;
      const openSec = Number(params.get("start"));
      return jsonResponse([[openSec, 9, 11, 10, 10.5, 1]]);
    };
    const market = await loadMarket({
      coins,
      fromMs: start,
      toMs: start + 2 * HOUR_MS,
      now: start + 2 * HOUR_MS,
      fetchImpl,
    });
    assert.equal(market.sourceId, "coinbase");
    assert.equal(market.candles.SOL[0].close, 10.5);
    assert.equal(market.candles.ETH.length, 1);
  });
});
