const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

const chicagoTime = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Chicago",
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZoneName: "short",
});

const chicagoDate = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Chicago",
  month: "short",
  day: "numeric",
  year: "numeric",
});

export function formatMoney(amount) {
  if (!Number.isFinite(amount)) return "—";
  return money.format(amount);
}

export function formatSignedMoney(amount) {
  if (!Number.isFinite(amount)) return "—";
  if (amount > 0) return `+${money.format(amount)}`;
  return money.format(amount);
}

export function formatPercent(fraction) {
  if (!Number.isFinite(fraction)) return "—";
  const rounded = Math.round(fraction * 1000) / 10;
  const abs = Math.abs(rounded).toFixed(1);
  if (rounded > 0) return `+${abs}%`;
  if (rounded < 0) return `-${abs}%`;
  return "0.0%";
}

// 0.001 -> "0.1", 0.0005 -> "0.05", 0.04 -> "4"
export function formatRate(fraction) {
  const rounded = Math.round(fraction * 100 * 10000) / 10000;
  return String(rounded);
}

export function formatChicago(ms) {
  return chicagoTime.format(new Date(ms));
}

export function formatChicagoDate(ms) {
  return chicagoDate.format(new Date(ms));
}

export function formatCoinSize(qty, symbol) {
  const text = qty.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 8,
  });
  return `${text} ${symbol}`;
}

export function directionOf(amount) {
  if (amount > 0.005) return "up";
  if (amount < -0.005) return "down";
  return "flat";
}

export function plainDollars(amount) {
  if (Math.abs(amount - Math.round(amount)) < 1e-6) return `$${Math.round(amount)}`;
  return formatMoney(amount);
}
