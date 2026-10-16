import { CONFIG, HOUR_MS } from "../js/config.js";

export { HOUR_MS };

export function bars(closes, extras = {}) {
  return closes.map((close, i) => {
    const openTime = i * HOUR_MS;
    const extra = extras[i] || {};
    return {
      openTime,
      closeTime: openTime + HOUR_MS,
      open: extra.open ?? close,
      high: extra.high ?? Math.max(extra.open ?? close, close),
      low: extra.low ?? Math.min(extra.open ?? close, close),
      close,
    };
  });
}

export function testConfig(overrides = {}) {
  return {
    ...CONFIG,
    startTime: new Date(0).toISOString(),
    fastHours: 2,
    slowHours: 3,
    stopLossFraction: 0.04,
    coins: [
      { id: "BTC", name: "Bitcoin", binanceSymbol: "BTCUSDT", coinbaseProduct: "BTC-USD" },
    ],
    ...overrides,
  };
}

export function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}
