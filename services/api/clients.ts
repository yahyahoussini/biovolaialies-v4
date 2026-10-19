import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "../../lib/zod";
import { repositories } from "../../data/repositories";
import type { ApiClient, ApiPrincipal } from "../../domain/api/types";
import { API_SCOPE, type ApiScope } from "../../domain/shared/enums";
import { AuthorizationError, NotFoundError, ValidationError } from "../../domain/shared/errors";
import { can } from "../../domain/shared/permissions";
import { recordAudit } from "../audit/record";
import type { Session } from "../auth/session";

const KEY_PREFIX = "bvu_";

/** Only a SHA-256 of the key is stored; the key itself is shown once, at creation. */
export function hashApiKey(key: string): string {
  return createHash("sha256").update(key, "utf8").digest("hex");
}

export const createApiClientSchema = z.object({
  name: z.string().trim().min(3).max(100),
  scopes: z.array(z.enum(API_SCOPE)).min(1, "Choisissez au moins un droit."),
  /** Code of the gateway the key is bound to (telemetry keys). Optional. */
  gatewayCode: z.string().trim().max(80).optional().nullable(),
});

export async function createApiClient(input: unknown, session: Session): Promise<{ client: ApiClient; key: string }> {
  if (!can(session, "CREATE", "API_CLIENTS")) throw new AuthorizationError();
  const parsed = createApiClientSchema.safeParse(input);
  if (!parsed.success) throw new ValidationError(parsed.error.issues.map((i) => i.message).join(" "));

  let deviceId: string | null = null;
  if (parsed.data.gatewayCode) {
    const gateway = await repositories.devices.findByCode(parsed.data.gatewayCode);
    if (!gateway || gateway.type !== "PASSERELLE") throw new ValidationError("Ce code ne désigne aucune passerelle.");
    deviceId = gateway.id;
  }
  const key = `${KEY_PREFIX}${randomBytes(32).toString("base64url")}`;
  const client = await repositories.apiClients.create({
    name: parsed.data.name,
    keyPrefix: key.slice(0, 12),
    keyHash: hashApiKey(key),
    scopes: [...new Set(parsed.data.scopes)],
    createdBy: session.userId,
    deviceId,
  });
  await recordAudit({
    actorId: session.userId,
    entityType: "api_client",
    entityId: client.id,
    field: "scopes",
    oldValue: null,
    newValue: client.scopes.join(" "),
    reason: `Création d'un accès API « ${client.name} »`,
    relatedLotId: null,
    relatedEventId: null,
  });
  return { client, key };
}

export async function revokeApiClient(clientId: string, session: Session): Promise<ApiClient> {
  if (!can(session, "EDIT", "API_CLIENTS")) throw new AuthorizationError();
  const existing = await repositories.apiClients.findById(clientId);
  if (!existing) throw new NotFoundError("Client API", clientId);
  const revoked = await repositories.apiClients.revoke(clientId, new Date().toISOString());
  await recordAudit({ actorId: session.userId, entityType: "api_client", entityId: clientId, field: "active", oldValue: "true", newValue: "false", reason: "Révocation d'un accès API", relatedLotId: null, relatedEventId: null });
  return revoked;
}

export async function listApiClients(session: Session): Promise<ApiClient[]> {
  if (!can(session, "VIEW", "API_CLIENTS")) throw new AuthorizationError();
  return repositories.apiClients.list();
}

/**
 * Resolves a bearer key to its client. Returns null for anything that should read as 401 —
 * missing, malformed, unknown or revoked — without saying which.
 */
export async function authenticateApiKey(authorization: string | null): Promise<ApiPrincipal | null> {
  const match = authorization?.match(/^Bearer\s+(\S+)$/i);
  if (!match || !match[1].startsWith(KEY_PREFIX)) return null;
  const hash = hashApiKey(match[1]);
  const client = await repositories.apiClients.findByKeyHash(hash);
  if (!client || !client.active) return null;
  // Constant-time confirmation of the stored hash (the lookup itself is by exact match).
  if (!timingSafeEqual(Buffer.from(client.keyHash, "hex"), Buffer.from(hash, "hex"))) return null;
  await repositories.apiClients.touch(client.id, new Date().toISOString());
  return {
    clientId: client.id,
    name: client.name,
    scopes: client.scopes.filter((s): s is ApiScope => (API_SCOPE as readonly string[]).includes(s)),
    deviceId: client.deviceId ?? null,
  };
}
