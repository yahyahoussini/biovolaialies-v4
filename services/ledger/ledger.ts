import { z } from "../../lib/zod";
import { repositories } from "../../data/repositories";
import {
  isAnchorSignatureValid,
  signAnchor,
  verifyChain,
  type ChainVerification,
  type LedgerAnchor,
} from "../../domain/ledger/hash-chain";
import type { LedgerAppendInput, LedgerAppendResult, LedgerEvent } from "../../domain/ledger/types";
import { AuthorizationError, ValidationError } from "../../domain/shared/errors";
import { can } from "../../domain/shared/permissions";
import { env } from "../../lib/env";
import type { Session } from "../auth/session";

/** The single write path into the ledger — services call this, never the repository directly. */
export async function appendLedgerEvent(input: LedgerAppendInput): Promise<LedgerAppendResult> {
  return repositories.ledger.append(input);
}

/**
 * Anchors outlive sessions, so in production they need their own long-lived key: falling back to
 * SESSION_SECRET there would silently invalidate every anchor on the next secret rotation.
 * The fallback is kept only for local development and the demo snapshot.
 */
function anchorKey(): string {
  if (env.LEDGER_ANCHOR_KEY) return env.LEDGER_ANCHOR_KEY;
  if (env.NODE_ENV === "production" && !env.DATABASE_SNAPSHOT && !env.DEMO_MODE) {
    throw new ValidationError("LEDGER_ANCHOR_KEY n'est pas configurée : les ancres ne peuvent pas être signées en production.");
  }
  return env.SESSION_SECRET;
}

export async function verifyLedger(session: Session): Promise<ChainVerification> {
  if (!can(session, "VIEW", "INTEGRITY")) throw new AuthorizationError();
  return verifyChain(await repositories.ledger.listAll());
}

export async function listRecentLedgerEvents(session: Session, limit = 100): Promise<LedgerEvent[]> {
  if (!can(session, "VIEW", "INTEGRITY")) throw new AuthorizationError();
  return repositories.ledger.listRecent(limit);
}

export async function listLedgerEventsForObject(session: Session, objectType: string, objectId: string): Promise<LedgerEvent[]> {
  if (!can(session, "VIEW", "INTEGRITY") && !can(session, "VIEW", "QUALITY")) throw new AuthorizationError();
  return repositories.ledger.listByObject(objectType, objectId);
}

/** Signs the current head. Refused when the chain is already broken — an anchor must never vouch for a tampered state. */
export async function issueLedgerAnchor(session: Session): Promise<LedgerAnchor> {
  if (!can(session, "EXPORT", "INTEGRITY")) throw new AuthorizationError();
  const verification = verifyChain(await repositories.ledger.listAll());
  if (!verification.ok) throw new ValidationError(`Journal non intègre : ${verification.reason}`);
  return signAnchor(verification.headSeq, verification.headHash, new Date().toISOString(), anchorKey());
}

const anchorSchema = z.object({
  version: z.literal(1),
  headSeq: z.number().int().nonnegative(),
  headHash: z.string().regex(/^[0-9a-f]{64}$/),
  issuedAt: z.string().min(1),
  signature: z.string().regex(/^[0-9a-f]{64}$/),
});

export interface AnchorVerification {
  ok: boolean;
  message: string;
  chain: ChainVerification;
}

/**
 * Three questions, in order: is the anchor really ours (signature), is the chain internally
 * consistent today, and does today's chain still contain the exact head the anchor recorded?
 * The last catches a full rewrite that the internal check alone cannot.
 */
export async function verifyAgainstAnchor(session: Session, rawAnchor: unknown): Promise<AnchorVerification> {
  if (!can(session, "VIEW", "INTEGRITY")) throw new AuthorizationError();
  const parsed = anchorSchema.safeParse(rawAnchor);
  if (!parsed.success) throw new ValidationError("Ancre illisible : format inattendu.");
  const anchor = parsed.data;

  const chain = verifyChain(await repositories.ledger.listAll());
  if (!isAnchorSignatureValid(anchor, anchorKey())) {
    return { ok: false, message: "Signature de l'ancre invalide : elle n'a pas été émise par cette plateforme ou a été modifiée.", chain };
  }
  if (!chain.ok) return { ok: false, message: `Journal non intègre : ${chain.reason}`, chain };
  if (anchor.headSeq > chain.headSeq) {
    return { ok: false, message: `Le journal contient moins d'événements (${chain.headSeq}) que l'ancre n'en atteste (${anchor.headSeq}).`, chain };
  }
  const anchored = anchor.headSeq === 0 ? null : await repositories.ledger.findBySeq(anchor.headSeq);
  if (anchor.headSeq > 0 && anchored?.hash !== anchor.headHash) {
    return { ok: false, message: `L'événement n° ${anchor.headSeq} ne correspond plus à l'ancre : l'historique a été réécrit.`, chain };
  }
  return {
    ok: true,
    message: `Conforme : les ${anchor.headSeq} événements ancrés le ${new Date(anchor.issuedAt).toLocaleString("fr-FR")} sont intacts (${chain.headSeq - anchor.headSeq} ajoutés depuis).`,
    chain,
  };
}

export interface AuditMirrorCheck {
  ok: boolean;
  auditRows: number;
  /** Audit rows with no ledger entry (the append failed, or the row was inserted by hand). */
  missing: string[];
  /** Audit rows whose content no longer matches what the ledger recorded (edited afterwards). */
  altered: string[];
  /** Rows written before the ledger existed (a database upgraded to this version): not provable, not an error. */
  preLedger: number;
}

/**
 * The chain proves the ledger itself is intact; this proves the readable audit trail still says
 * what the ledger recorded. Together they catch an audit row edited, deleted from the ledger's
 * view, or inserted without proof. Business tables (quantities, statuses) are not hashed — see
 * /programme T08.
 */
export async function verifyAuditMirror(session: Session): Promise<AuditMirrorCheck> {
  if (!can(session, "VIEW", "INTEGRITY")) throw new AuthorizationError();
  const [rows, events] = await Promise.all([repositories.auditLog.list(1_000_000), repositories.ledger.listAll()]);
  const byAuditId = new Map<string, Record<string, unknown>>();
  for (const e of events) {
    if (e.eventType.startsWith("AUDIT:") && typeof e.payload.auditLogId === "string") byAuditId.set(e.payload.auditLogId, e.payload);
  }
  const missing: string[] = [];
  const altered: string[] = [];
  const ledgerStart = events[0]?.recordedAt ?? null;
  let preLedger = 0;
  for (const row of rows) {
    const recorded = byAuditId.get(row.id);
    if (!recorded && (ledgerStart === null || row.createdAt < ledgerStart)) {
      preLedger += 1;
      continue;
    }
    if (!recorded) {
      missing.push(row.id);
      continue;
    }
    const same =
      recorded.field === row.field &&
      recorded.oldValue === row.oldValue &&
      recorded.newValue === row.newValue &&
      recorded.reason === row.reason &&
      recorded.relatedLotId === row.relatedLotId;
    if (!same) altered.push(row.id);
  }
  return { ok: missing.length === 0 && altered.length === 0, auditRows: rows.length, missing, altered, preLedger };
}
