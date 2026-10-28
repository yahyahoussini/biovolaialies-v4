import { parseBvuId } from "../../domain/identity/bvu-id-format";
import type { FieldCode, FieldSnapshot } from "../../services/field/snapshot";

/**
 * Reading a code on the phone without network (document 3, ch. 05: "le lecteur ne doit dépendre
 * d'aucune connexion"). The code is looked up in the snapshot the phone holds; a BIOVOLAILLES
 * identifier with a wrong check character is refused before any lookup — a misread label must
 * not open another lot.
 */
export type CodeLookup = { status: "FOUND"; match: FieldCode } | { status: "BAD_CHECK"; code: string } | { status: "UNKNOWN"; code: string } | { status: "EMPTY" };

export function normalizeCode(raw: string): string {
  const trimmed = raw.trim();
  // A label's QR may carry a link to the platform; its last path segment is the code.
  const fromUrl = /^https?:\/\//i.test(trimmed) ? (trimmed.split(/[?#]/)[0].split("/").filter(Boolean).pop() ?? "") : trimmed;
  return fromUrl.replace(/\s+/g, "").toUpperCase();
}

export function lookupCode(snapshot: Pick<FieldSnapshot, "codes"> | undefined, raw: string): CodeLookup {
  const code = normalizeCode(raw);
  if (!code) return { status: "EMPTY" };
  const bvu = parseBvuId(code);
  if (bvu && !bvu.valid) return { status: "BAD_CHECK", code };
  const match = snapshot?.codes.find((c) => c.code === code);
  return match ? { status: "FOUND", match } : { status: "UNKNOWN", code };
}
