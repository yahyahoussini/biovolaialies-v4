import { z } from "zod";
import { fr } from "zod/locales";
import { ValidationError } from "../domain/shared/errors";

/**
 * zod with French built-in messages. Every server-side schema imports `z` from here.
 *
 * Set as `customError`, not via `z.config(fr())`: the production build bundles zod more than
 * once, and each copy that loads re-applies its English default to the shared `localeError`,
 * overwriting a French locale set earlier ("Invalid input…" leaked into the UI). Nothing resets
 * `customError`, and zod consults it first.
 */
z.config({ customError: fr().localeError });

export { z };

/** Parses or throws the domain's ValidationError (French messages), never a raw ZodError. */
export function parseInput<T>(schema: z.ZodType<T>, input: unknown): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new ValidationError(parsed.error.issues.map((i) => i.message).join(" "));
  return parsed.data;
}
