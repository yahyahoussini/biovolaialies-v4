import { hashPassword, verifyPassword } from "../../lib/password";
import { generateRecoveryCodes, normalizeRecoveryCode } from "../../lib/totp";

/** Stored as users.recovery_codes: each code hashed like a password, marked when used. */
interface StoredCode {
  hash: string;
  usedAt: string | null;
}

/** Ten new codes: the plain ones to show once, and what to store. */
export function issueRecoveryCodes(): { codes: string[]; json: string } {
  const codes = generateRecoveryCodes();
  return { codes, json: JSON.stringify(codes.map((c): StoredCode => ({ hash: hashPassword(normalizeRecoveryCode(c)), usedAt: null }))) };
}

/** Uses a code once: the stored list with that code marked, and how many remain; null when it matches none still unused. */
export function consumeRecoveryCode(json: string | null, code: string, now = new Date()): { json: string; left: number } | null {
  if (!json) return null;
  const stored = JSON.parse(json) as StoredCode[];
  const normalized = normalizeRecoveryCode(code);
  const index = stored.findIndex((s) => !s.usedAt && verifyPassword(normalized, s.hash));
  if (index < 0) return null;
  stored[index] = { ...stored[index], usedAt: now.toISOString() };
  return { json: JSON.stringify(stored), left: stored.filter((s) => !s.usedAt).length };
}

export function recoveryCodesLeft(json: string | null): number {
  if (!json) return 0;
  return (JSON.parse(json) as StoredCode[]).filter((s) => !s.usedAt).length;
}
