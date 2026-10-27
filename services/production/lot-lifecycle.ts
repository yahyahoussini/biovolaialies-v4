import { repositories } from "../../data/repositories";
import { validateTransition } from "../../domain/production/lot-lifecycle";
import type { Lot } from "../../domain/production/types";
import type { LotStatus } from "../../domain/shared/enums";
import { AuthorizationError, ConflictError, ValidationError } from "../../domain/shared/errors";
import { can } from "../../domain/shared/permissions";
import { recordAudit } from "../audit/record";
import type { Session } from "../auth/session";
import { assertInScope, resolveLotHierarchy } from "../identity/scope-check";
import { getLotOrThrow } from "./lot";

/**
 * The only path a Lot's status may change through — the UI never writes `status` directly.
 * Enforces the transition table (domain/production/lot-lifecycle.ts), scope, and permission,
 * and writes an audit entry. See ARCHITECTURE.md §7.
 */
export async function transitionLotStatus(
  lotId: string,
  toStatus: LotStatus,
  session: Session,
  reason?: string,
  /** When the change actually happened, for an entry made after the fact. Defaults to now. */
  at?: string
): Promise<Lot> {
  if (!can(session, "EDIT", "LOTS")) {
    throw new AuthorizationError("Vous n'avez pas les droits pour changer le statut de ce lot.");
  }

  const lot = await getLotOrThrow(lotId);
  const path = await resolveLotHierarchy(lotId);
  assertInScope(session, path);

  const result = validateTransition(lot.status, toStatus);
  if (!result.ok) {
    throw new ConflictError(result.error);
  }

  const extra: Partial<Pick<Lot, "startedAt" | "endedAt">> = {};
  if (at !== undefined && (Number.isNaN(Date.parse(at)) || Date.parse(at) > Date.now() + 86_400_000)) {
    throw new ValidationError("Date du changement de statut invalide ou dans le futur.");
  }
  const now = at ? new Date(at).toISOString() : new Date().toISOString();
  if (toStatus === "ACTIF" && !lot.startedAt) extra.startedAt = now;
  if ((toStatus === "CLOTURE" || toStatus === "ARCHIVE") && !lot.endedAt) extra.endedAt = now;

  const updated = await repositories.lots.updateStatus(lotId, toStatus, extra);
  // A slaughtered, closed or archived lot is in no phase any more.
  if (toStatus === "ABATTU" || toStatus === "CLOTURE" || toStatus === "ARCHIVE") {
    const open = await repositories.lotPhases.current(lotId);
    if (open && open.startedAt <= now) await repositories.lotPhases.close(open.id, now);
  }

  await recordAudit({
    actorId: session.userId,
    entityType: "lot",
    entityId: lotId,
    field: "status",
    oldValue: lot.status,
    newValue: toStatus,
    reason: reason ?? null,
    relatedLotId: lotId,
    relatedEventId: null,
  });

  return updated;
}
