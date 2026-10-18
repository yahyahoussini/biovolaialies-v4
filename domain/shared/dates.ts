import { z } from "../../lib/zod";

/** A business date: a real date, not before 2000, and not in the future beyond clock tolerance. */
export const CLOCK_TOLERANCE_MS = 24 * 60 * 60 * 1000;

export function businessDate(label: string) {
  return z
    .string()
    .trim()
    .min(1, `${label} : date requise.`)
    .refine((v) => !Number.isNaN(Date.parse(v)), `${label} : date invalide.`)
    .refine((v) => Date.parse(v) >= Date.parse("2000-01-01T00:00:00Z"), `${label} : date antérieure à 2000.`)
    .refine((v) => Date.parse(v) <= Date.now() + CLOCK_TOLERANCE_MS, `${label} : date dans le futur.`)
    .transform((v) => new Date(v).toISOString());
}

/** Returns an error message when `later` is before `earlier`. */
export function orderError(earlierLabel: string, earlier: string, laterLabel: string, later: string): string | null {
  return Date.parse(later) < Date.parse(earlier) ? `${laterLabel} ne peut pas précéder ${earlierLabel.toLowerCase()} (${new Date(earlier).toLocaleDateString("fr-FR")}).` : null;
}
