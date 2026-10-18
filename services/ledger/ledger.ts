import { z } from "zod";
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

function anchorKey(): string {
  return env.LEDGER_ANCHOR_KEY ?? env.SESSION_SECRET;
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
