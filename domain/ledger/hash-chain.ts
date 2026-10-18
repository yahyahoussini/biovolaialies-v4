import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { LedgerEvent } from "./types";

/** The hash the first event links back to. */
export const GENESIS_HASH = "0".repeat(64);

/**
 * Deterministic JSON: object keys sorted at every depth, so the same logical payload always
 * hashes the same regardless of the order a client or database returned its keys in.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

export function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function hashPayload(payload: Record<string, unknown>): string {
  return sha256(canonicalJson(payload));
}

/** Every protected field of an event, minus the hash itself. Changing any of them breaks the chain. */
export type HashableEvent = Omit<LedgerEvent, "hash" | "payload">;

export function computeEventHash(event: HashableEvent): string {
  const { prevHash, ...fields } = event;
  return sha256(`${prevHash}|${canonicalJson(fields)}`);
}

export interface ChainVerification {
  ok: boolean;
  count: number;
  headSeq: number;
  headHash: string;
  /** First sequence number at which the chain stops being trustworthy. */
  brokenAtSeq: number | null;
  reason: string | null;
}

/**
 * Recomputes the whole chain from genesis. Detects an edited field (hash mismatch), an edited
 * payload (payload hash mismatch), a deleted or inserted row (sequence gap or broken link) and
 * a reordering (broken link). Expects events sorted by seq ascending.
 */
export function verifyChain(events: LedgerEvent[]): ChainVerification {
  let prevHash = GENESIS_HASH;
  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    const expectedSeq = i + 1;
    const fail = (reason: string): ChainVerification => ({
      ok: false,
      count: events.length,
      headSeq: events.at(-1)?.seq ?? 0,
      headHash: events.at(-1)?.hash ?? GENESIS_HASH,
      brokenAtSeq: event.seq,
      reason,
    });
    if (event.seq !== expectedSeq) return fail(`Séquence rompue : n° ${expectedSeq} attendu, n° ${event.seq} trouvé (événement supprimé ou inséré).`);
    if (event.prevHash !== prevHash) return fail("Le lien vers l'événement précédent ne correspond pas.");
    if (hashPayload(event.payload) !== event.payloadHash) return fail("Le contenu de l'événement a été modifié.");
    const { hash, payload, ...hashable } = event;
    void payload; // covered by payloadHash above; excluded from the field hash by design
    if (computeEventHash(hashable) !== hash) return fail("Un champ protégé de l'événement a été modifié.");
    prevHash = hash;
  }
  return {
    ok: true,
    count: events.length,
    headSeq: events.at(-1)?.seq ?? 0,
    headHash: prevHash,
    brokenAtSeq: null,
    reason: null,
  };
}

/**
 * A signed snapshot of the chain head, meant to be stored OUTSIDE the database (printed, e-mailed,
 * kept by an auditor). Recomputing the chain alone cannot catch someone who rewrites every row and
 * every hash after a point; comparing against an anchor taken earlier can.
 */
export interface LedgerAnchor {
  version: 1;
  headSeq: number;
  headHash: string;
  issuedAt: string;
  signature: string;
}

function anchorMessage(a: Pick<LedgerAnchor, "version" | "headSeq" | "headHash" | "issuedAt">): string {
  return `bvu-ledger-anchor|v${a.version}|${a.headSeq}|${a.headHash}|${a.issuedAt}`;
}

export function signAnchor(headSeq: number, headHash: string, issuedAt: string, key: string): LedgerAnchor {
  const base = { version: 1 as const, headSeq, headHash, issuedAt };
  return { ...base, signature: createHmac("sha256", key).update(anchorMessage(base)).digest("hex") };
}

export function isAnchorSignatureValid(anchor: LedgerAnchor, key: string): boolean {
  const expected = createHmac("sha256", key).update(anchorMessage(anchor)).digest();
  const given = Buffer.from(anchor.signature, "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}
