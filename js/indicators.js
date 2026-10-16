// Causal indicators on one candle series. A gap in the spacing returns null
// so a missing 15-minute candle cannot pretend to be part of the window.

export function contiguousStart(candles, index, stepMs) {
  let start = index;
  while (start > 0 && candles[start].closeTime - candles[start - 1].closeTime === stepMs) {
    start -= 1;
  }
  return start;
}

function windowIsWhole(candles, index, bars, stepMs) {
  if (index < bars) return false;
  for (let i = index - bars + 1; i <= index; i += 1) {
    if (candles[i].closeTime - candles[i - 1].closeTime !== stepMs) return false;
  }
  return true;
}

export function simpleAverage(candles, index, period, stepMs) {
  if (!windowIsWhole(candles, index, period, stepMs)) return null;
  let sum = 0;
  for (let i = index - period + 1; i <= index; i += 1) sum += candles[i].close;
  return sum / period;
}

export function exponentialAverage(candles, index, period, stepMs) {
  if (index < 0 || !candles[index] || period < 1) return null;
  const start = contiguousStart(candles, index, stepMs);
  const length = index - start + 1;
  if (length < period) return null;
  let average = 0;
  for (let i = 0; i < period; i += 1) average += candles[start + i].close;
  average /= period;
  const weight = 2 / (period + 1);
  for (let i = period; i < length; i += 1) {
    average = candles[start + i].close * weight + average * (1 - weight);
  }
  return average;
}

export function priorHigh(candles, index, lookback, stepMs) {
  if (!windowIsWhole(candles, index, lookback + 1, stepMs)) return null;
  let high = -Infinity;
  for (let i = index - lookback; i < index; i += 1) high = Math.max(high, candles[i].high);
  return high;
}

export function priorVolumeAverage(candles, index, lookback, stepMs) {
  if (!windowIsWhole(candles, index, lookback + 1, stepMs)) return null;
  let sum = 0;
  for (let i = index - lookback; i < index; i += 1) {
    const volume = candles[i].volume;
    if (!Number.isFinite(volume) || volume < 0) return null;
    sum += volume;
  }
  return sum / lookback;
}

export function relativeStrengthIndex(candles, index, period, stepMs) {
  if (index < 0 || !candles[index]) return null;
  const start = contiguousStart(candles, index, stepMs);
  const length = index - start + 1;
  if (length < period + 1) return null;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i += 1) {
    const change = candles[start + i].close - candles[start + i - 1].close;
    if (change >= 0) gain += change;
    else loss -= change;
  }
  gain /= period;
  loss /= period;
  for (let i = period + 1; i < length; i += 1) {
    const change = candles[start + i].close - candles[start + i - 1].close;
    const up = change > 0 ? change : 0;
    const down = change < 0 ? -change : 0;
    gain = (gain * (period - 1) + up) / period;
    loss = (loss * (period - 1) + down) / period;
  }
  if (loss === 0) return gain === 0 ? 50 : 100;
  return 100 - 100 / (1 + gain / loss);
}

export function averageTrueRange(candles, index, period, stepMs) {
  if (index < 0 || !candles[index]) return null;
  const start = contiguousStart(candles, index, stepMs);
  const length = index - start + 1;
  if (length < period + 1) return null;
  const trueRange = (offset) => {
    const current = candles[start + offset];
    const previousClose = candles[start + offset - 1].close;
    return Math.max(
      current.high - current.low,
      Math.abs(current.high - previousClose),
      Math.abs(current.low - previousClose),
    );
  };
  let atr = 0;
  for (let i = 1; i <= period; i += 1) atr += trueRange(i);
  atr /= period;
  for (let i = period + 1; i < length; i += 1) {
    atr = (atr * (period - 1) + trueRange(i)) / period;
  }
  return atr;
}
