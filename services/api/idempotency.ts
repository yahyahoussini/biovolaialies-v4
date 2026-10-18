import { repositories } from "../../data/repositories";
import type { ApiPrincipal } from "../../domain/api/types";
import { hashPayload } from "../../domain/ledger/hash-chain";
import { appendLedgerEvent } from "../ledger/ledger";
import { ApiError } from "./http";

/** Reads and validates the Idempotency-Key header; `required` makes its absence a 400. */
export function idempotencyKeyOf(request: Request, required: boolean): string | null {
  const key = request.headers.get("idempotency-key")?.trim() ?? null;
  if (!key) {
    if (required) throw new ApiError(400, "IDEMPOTENCY_KEY_REQUIRED", "En-tête Idempotency-Key obligatoire pour cette opération.");
    return null;
  }
  if (key.length < 8 || key.length > 200) throw new ApiError(400, "INVALID_IDEMPOTENCY_KEY", "Idempotency-Key : 8 à 200 caractères.");
  return key;
}

/**
 * Makes a creating call safe to retry (API-01, API-05): the first success is recorded in the
 * chained ledger with a fingerprint of the request; the same key with the same body returns
 * that stored result (replayed: true), the same key with another body is a 409.
 */
export async function withIdempotency<T extends object>(
  principal: ApiPrincipal,
  route: string,
  key: string,
  body: unknown,
  run: () => Promise<T>
): Promise<{ result: T; replayed: boolean }> {
  const ledgerKey = `${principal.clientId}:${route}:${key}`;
  const requestHash = hashPayload({ body: body as Record<string, unknown> });
  const existing = await repositories.ledger.findByIdempotencyKey(ledgerKey);
  if (existing) {
    if (existing.payload.requestHash !== requestHash) {
      throw new ApiError(409, "IDEMPOTENCY_CONFLICT", "Cette clé d'idempotence a déjà été utilisée pour une requête différente.");
    }
    return { result: existing.payload.response as T, replayed: true };
  }
  const result = await run();
  await appendLedgerEvent({
    eventType: "API_REQUEST",
    objectType: "api_client",
    objectId: principal.clientId,
    actorKind: "API_CLIENT",
    actorId: principal.clientId,
    source: `api:${principal.name}`,
    occurredAt: new Date().toISOString(),
    payload: { route, requestHash, response: result as Record<string, unknown> },
    idempotencyKey: ledgerKey,
  });
  return { result, replayed: false };
}
