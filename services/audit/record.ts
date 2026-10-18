import { repositories } from "../../data/repositories";
import type { NewAuditLogEntry } from "../../domain/audit/types";
import { appendLedgerEvent } from "../ledger/ledger";

/**
 * Called from within the same service/action as the mutation itself — see ARCHITECTURE.md §13.
 * Every audited mutation is also appended to the hash-chained ledger, so the audit trail is
 * tamper-evident without touching the dozens of call sites: the audit_log row stays the
 * readable record, the ledger event is its proof.
 */
export async function recordAudit(entry: NewAuditLogEntry): Promise<void> {
  const row = await repositories.auditLog.record(entry);
  await appendLedgerEvent({
    eventType: `AUDIT:${entry.entityType}`,
    objectType: entry.entityType,
    objectId: entry.entityId,
    actorKind: entry.actorId ? "USER" : "SYSTEM",
    actorId: entry.actorId,
    source: "application",
    occurredAt: row.createdAt,
    payload: {
      auditLogId: row.id,
      field: entry.field,
      oldValue: entry.oldValue,
      newValue: entry.newValue,
      reason: entry.reason,
      relatedLotId: entry.relatedLotId,
      relatedEventId: entry.relatedEventId,
    },
  });
}
