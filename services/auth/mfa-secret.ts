import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import { env } from "../../lib/env";

/**
 * Two-step login secrets are stored encrypted (AES-256-GCM): a copy of the database alone does not
 * give anyone the codes. The key comes from MFA_ENCRYPTION_KEY, or from SESSION_SECRET when that is
 * not set — in which case rotating SESSION_SECRET makes every enrolled secret unreadable, and the
 * administrator resets each user's two-step login (EXPLOITATION.md, "Secrets"). Set
 * MFA_ENCRYPTION_KEY on a real installation.
 */

function key(): Buffer {
  const material = env.MFA_ENCRYPTION_KEY ?? env.SESSION_SECRET;
  return Buffer.from(hkdfSync("sha256", material, "biovolailles-mfa", "totp-secret-v1", 32));
}

export function sealTotpSecret(secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), body.toString("base64url")].join(".");
}

/** The secret, or null when it cannot be read (wrong key, altered value). */
export function openTotpSecret(sealed: string | null): string | null {
  if (!sealed) return null;
  const [version, iv, tag, body] = sealed.split(".");
  if (version !== "v1" || !iv || !tag || !body) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(body, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}
