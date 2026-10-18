/** Helpers for Server Actions fed by FormDialog: turn its plain strings into service input. */
export function num(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const n = Number(value.replace(",", "."));
  return Number.isFinite(n) ? n : NaN;
}

export function opt(value: string | undefined): string | null {
  return value === undefined || value.trim() === "" ? null : value.trim();
}

/** Accepts a date or datetime-local value and returns an ISO timestamp (dates at 00:00 UTC). */
export function iso(value: string | undefined): string {
  if (!value) return "";
  const d = new Date(value.length === 10 ? `${value}T00:00:00.000Z` : value);
  return Number.isNaN(d.getTime()) ? value : d.toISOString();
}
