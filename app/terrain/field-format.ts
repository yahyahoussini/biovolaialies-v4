/** Time as the field app shows it: how old a value is first, the exact time second, always in Morocco. */

const TZ = "Africa/Casablanca";

export function clock(iso: string): string {
  return new Date(iso).toLocaleString("fr-FR", { timeZone: TZ, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export function ago(iso: string, now = Date.now()): string {
  const minutes = Math.round((now - Date.parse(iso)) / 60_000);
  if (minutes < 1) return "à l'instant";
  if (minutes < 60) return `il y a ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `il y a ${hours} h`;
  return `il y a ${Math.round(hours / 24)} j`;
}

/** Older than a day: the screen says so, a field reading is not news after that. */
export function isStale(iso: string, now = Date.now()): boolean {
  return now - Date.parse(iso) > 24 * 60 * 60 * 1000;
}

/** Accepts "1,42" as typed on a French keyboard. Empty is null, garbage is NaN. */
export function parseNumber(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const n = Number(trimmed.replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : Number.NaN;
}

export function fmt(n: number, digits = 0): string {
  return n.toLocaleString("fr-FR", { maximumFractionDigits: digits });
}
