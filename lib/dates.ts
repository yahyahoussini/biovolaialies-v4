/** The calendar day in Morocco (AAAA-MM-JJ). At 00:30 local time the UTC date is still the day before. */
export function moroccoDate(at: Date | string = new Date()): string {
  return new Date(at).toLocaleDateString("en-CA", { timeZone: "Africa/Casablanca" });
}
