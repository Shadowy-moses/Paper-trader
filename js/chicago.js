// Trading days end at midnight in America/Chicago, including the daylight-time switch.

const dateKey = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Chicago",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const clock = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Chicago",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export function chicagoDateKey(ms) {
  return dateKey.format(new Date(ms));
}

export function isChicagoMidnight(ms) {
  const parts = clock.formatToParts(new Date(ms));
  const hour = Number(parts.find((part) => part.type === "hour").value);
  const minute = Number(parts.find((part) => part.type === "minute").value);
  return hour === 0 && minute === 0;
}
