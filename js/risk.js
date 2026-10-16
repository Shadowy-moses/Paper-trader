// Size a buy so that selling at the stop, after both fees and the price cushion,
// loses at most `riskFraction` of the strategy's current balance.
// A gap through the stop can still lose more. That is a real fill, not the plan.

export function sizeForStop({ equity, cash, fillPrice, stopPrice, feeRate, slippageRate, riskFraction }) {
  if (!(equity > 0) || !(cash > 0) || !(fillPrice > stopPrice) || !(stopPrice > 0)) return null;
  const sellAtStop = stopPrice * (1 - slippageRate);
  if (!(sellAtStop > 0)) return null;
  const kept = (1 - feeRate) ** 2 * (sellAtStop / fillPrice);
  const lossPerDollar = 1 - kept;
  if (!(lossPerDollar > 0)) return null;
  const budget = riskFraction * equity;
  const spend = Math.min(cash, budget / lossPerDollar);
  if (!(spend >= 1)) return null;
  const qty = (spend * (1 - feeRate)) / fillPrice;
  const proceeds = qty * sellAtStop * (1 - feeRate);
  const lossAtStop = spend - proceeds;
  if (!(qty > 0) || lossAtStop > budget + 1e-6) return null;
  return { spend, qty, lossAtStop };
}

export function buySpend({ spend, rawPrice, feeRate, slippageRate }) {
  if (!(spend > 0) || !(rawPrice > 0)) return null;
  const price = rawPrice * (1 + slippageRate);
  const fee = spend * feeRate;
  const qty = (spend - fee) / price;
  if (!(qty > 0) || !Number.isFinite(qty)) return null;
  return { price, qty, fee };
}
