import { FIELD_BATCH_MAX } from "../../domain/field/field";
import type { FieldOpResult } from "../../services/field/sync";
import type { FieldSnapshot } from "../../services/field/snapshot";
import { fieldStore, isPending, type QueuedOp } from "./store";

/**
 * Sends this person's queued entries in their order, then refreshes the snapshot. Stops at the
 * first sign of trouble — no network, session expired, server fault — and leaves the rest queued,
 * still in order, for the next attempt. Never deletes an entry: results are written onto it.
 */

export type SyncOutcome =
  | { ok: true; sent: number; snapshot: FieldSnapshot | null }
  | { ok: false; reason: "HORS_LIGNE" | "CONNEXION" | "SERVEUR"; sent: number; message: string };

const MESSAGES = {
  HORS_LIGNE: "Pas de réseau : les saisies restent sur le téléphone et partiront au retour du réseau.",
  CONNEXION: "Session expirée : reconnectez-vous pour envoyer les saisies en attente (elles sont gardées).",
  SERVEUR: "Le serveur n'a pas pu tout enregistrer : nouvel essai automatique.",
};

function wire(op: QueuedOp) {
  return { opId: op.opId, deviceId: op.deviceId, seq: op.seq, authorId: op.authorId, kind: op.kind, lotId: op.lotId, transferId: op.transferId, capturedAt: op.capturedAt, payload: op.payload };
}

async function post(ops: QueuedOp[]): Promise<Response> {
  return fetch("/api/terrain/sync", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ops: ops.map(wire) }),
  });
}

export async function syncNow(userId: string): Promise<SyncOutcome> {
  const mine = (await fieldStore.allOps()).filter((op) => op.authorId === userId && isPending(op));
  let sent = 0;
  for (let i = 0; i < mine.length; i += FIELD_BATCH_MAX) {
    const batch = mine.slice(i, i + FIELD_BATCH_MAX);
    let response: Response;
    try {
      response = await post(batch);
    } catch {
      return { ok: false, reason: "HORS_LIGNE", sent, message: MESSAGES.HORS_LIGNE };
    }
    if (response.status === 401) return { ok: false, reason: "CONNEXION", sent, message: MESSAGES.CONNEXION };
    if (!response.ok) return { ok: false, reason: "SERVEUR", sent, message: MESSAGES.SERVEUR };
    const { results } = (await response.json()) as { results: FieldOpResult[] };
    const now = new Date().toISOString();
    for (const result of results) {
      await fieldStore.updateOp(result.opId, { status: result.status, message: result.message, sentAt: result.status === "A_REESSAYER" || result.status === "AUTRE_COMPTE" ? null : now });
      if (result.status !== "A_REESSAYER" && result.status !== "AUTRE_COMPTE") sent += 1;
    }
    if (results.some((r) => r.status === "A_REESSAYER")) return { ok: false, reason: "SERVEUR", sent, message: MESSAGES.SERVEUR };
  }

  let snapshot: FieldSnapshot | null = null;
  try {
    const response = await fetch("/api/terrain/snapshot", { credentials: "same-origin", cache: "no-store" });
    if (response.status === 401) return { ok: false, reason: "CONNEXION", sent, message: MESSAGES.CONNEXION };
    if (response.ok) {
      snapshot = (await response.json()) as FieldSnapshot;
      await fieldStore.saveSnapshot(snapshot);
      await fieldStore.setMeta("lastSync", snapshot.generatedAt);
    }
  } catch {
    return { ok: false, reason: "HORS_LIGNE", sent, message: MESSAGES.HORS_LIGNE };
  }
  return { ok: true, sent, snapshot };
}
