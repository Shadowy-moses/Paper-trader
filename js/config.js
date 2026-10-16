// All tuneable settings live here. Change a number, reload the page.
// The page has no server, so every phone reads this same file and the same
// public prices, then rebuilds the same paper trades.

export const HOUR_MS = 60 * 60 * 1000;

// Midnight at the start of launch day in America/Chicago.
// October 16, 2026 is still on daylight time (UTC−5), so midnight is 05:00 UTC.
// Kept as one value so the clock is not scattered through the code.
export const START_TIME = "2026-10-16T05:00:00.000Z";

export const CONFIG = {
  startTime: START_TIME,
  startingCash: 100,
  // 0.1% of the trade's dollars, taken on every buy and every sell.
  feeRate: 0.001,
  // 0.05% worse than the candle price: buys fill a little higher, sells a little lower.
  // Half of one percent of the fee, about 5 cents per $100. Enough that a tiny wiggle
  // does not look like a win, small enough for liquid coins on an hourly price.
  slippageRate: 0.0005,
  // Last 24 finished hours versus the last 72. A one-day trend against a three-day trend.
  fastHours: 24,
  slowHours: 72,
  // Sell if the price falls this far from the fill. 4% is wide enough for a normal
  // hourly swing, tight enough to cap a bad entry.
  stopLossFraction: 0.04,
  // Add a coin by appending one object. Keep Bitcoin (id "BTC"): the buy-and-hold
  // comparison uses it. binanceSymbol and coinbaseProduct must be that coin's
  // dollar market on each public price source.
  coins: [
    { id: "BTC", name: "Bitcoin", binanceSymbol: "BTCUSDT", coinbaseProduct: "BTC-USD" },
    { id: "ETH", name: "Ethereum", binanceSymbol: "ETHUSDT", coinbaseProduct: "ETH-USD" },
    { id: "SOL", name: "Solana", binanceSymbol: "SOLUSDT", coinbaseProduct: "SOL-USD" },
  ],
};

export function assertConfig(config) {
  if (!Number.isFinite(Date.parse(config.startTime))) {
    throw new Error("startTime must be a single ISO timestamp.");
  }
  if (!(config.startingCash > 0)) {
    throw new Error("startingCash must be greater than zero.");
  }
  if (!(config.feeRate >= 0) || !(config.slippageRate >= 0)) {
    throw new Error("feeRate and slippageRate cannot be negative.");
  }
  if (!Number.isInteger(config.fastHours) || !Number.isInteger(config.slowHours)) {
    throw new Error("fastHours and slowHours must be whole numbers of hours.");
  }
  if (!(config.slowHours > config.fastHours && config.fastHours >= 1)) {
    throw new Error("slowHours must be longer than fastHours.");
  }
  if (!(config.stopLossFraction > 0) || !(config.stopLossFraction < 1)) {
    throw new Error("stopLossFraction must be between 0 and 1.");
  }
  if (!Array.isArray(config.coins) || config.coins.length === 0) {
    throw new Error("Add at least one coin.");
  }
  const ids = new Set();
  for (const coin of config.coins) {
    if (!coin.id || !coin.name || !coin.binanceSymbol || !coin.coinbaseProduct) {
      throw new Error("Each coin needs an id, name, binanceSymbol, and coinbaseProduct.");
    }
    if (ids.has(coin.id)) throw new Error(`Duplicate coin id ${coin.id}.`);
    ids.add(coin.id);
  }
  if (!ids.has("BTC")) {
    throw new Error("Keep a coin with id BTC so the buy-and-hold comparison has Bitcoin.");
  }
}
