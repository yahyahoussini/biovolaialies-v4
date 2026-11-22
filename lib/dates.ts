const MOROCCO_TZ = "Africa/Casablanca";

/** The calendar day in Morocco (AAAA-MM-JJ). At 00:30 local time the UTC date is still the day before. */
export function moroccoDate(at: Date | string = new Date()): string {
  return new Date(at).toLocaleDateString("en-CA", { timeZone: MOROCCO_TZ });
}

let offsetFormatter: Intl.DateTimeFormat | null = null;

/**
 * Morocco's offset from UTC at an instant, in milliseconds, read from the platform's time-zone data
 * and never assumed: legal time was UTC+1 (UTC+0 during Ramadan) until 20 September 2026, and has
 * been UTC+0 all year since. A server whose time-zone data predates that change gets it wrong — see
 * moroccoTimeZoneDataIsCurrent(), which the operations page checks.
 */
export function moroccoOffsetMs(at: Date | string | number = new Date()): number {
  const t = typeof at === "number" ? at : new Date(at).getTime();
  offsetFormatter ??= new Intl.DateTimeFormat("en-US", {
    timeZone: MOROCCO_TZ,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = offsetFormatter.formatToParts(new Date(t));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second")) - Math.floor(t / 1000) * 1000;
}

/** The instant (ISO) at which the Moroccan calendar day containing `at` began: local midnight. */
export function moroccoDayStart(at: Date | string = new Date()): string {
  const [y, m, d] = moroccoDate(at).split("-").map(Number);
  const wallMidnight = Date.UTC(y, m - 1, d);
  // Two passes settle the offset in force at local midnight, even on a day the offset changes.
  const first = wallMidnight - moroccoOffsetMs(wallMidnight);
  return new Date(wallMidnight - moroccoOffsetMs(first)).toISOString();
}

/**
 * Whether this server's time-zone data knows that Morocco moved to UTC+0 for good on
 * 20 September 2026. Without it, every Moroccan time after that date is shown an hour late.
 */
export function moroccoTimeZoneDataIsCurrent(): boolean {
  return moroccoOffsetMs(Date.UTC(2027, 5, 15, 12)) === 0;
}
