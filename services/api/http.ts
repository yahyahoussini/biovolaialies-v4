import { z } from "../../lib/zod";
import { repositories } from "../../data/repositories";
import type { ApiPrincipal } from "../../domain/api/types";
import type { ApiScope } from "../../domain/shared/enums";
import { AppError } from "../../domain/shared/errors";
import { can } from "../../domain/shared/permissions";
import { isGlobalScope } from "../../domain/shared/scope";
import { logger } from "../../lib/logger";
import { rateLimit } from "../../lib/rate-limit";
import type { Session } from "../auth/session";
import { authenticateApiKey } from "./clients";

/**
 * The shared shell of every /api/v1 route — the client's API error policy (400/401/403/404/
 * 409/422/429/5xx) applied once, so no route can drift from it. Every response carries an
 * X-Correlation-ID (the caller's if it sent one, otherwise a fresh one) for support tracing.
 */
export const API_VERSION = "1.0.0";
const RATE_LIMIT = 120;
const RATE_WINDOW_MS = 60_000;
const MAX_BODY_BYTES = 1_000_000;

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown
  ) {
    super(message);
  }
}

export interface ApiContext {
  principal: ApiPrincipal;
  /** The issuing administrator's session: services run under it, and audit entries name the client. */
  session: Session;
  correlationId: string;
  request: Request;
}

export function correlationIdOf(request: Request): string {
  const given = request.headers.get("x-correlation-id");
  // Any printable token up to 128 characters is echoed as sent; anything else gets a fresh id.
  return given && /^[\x21-\x7e]{1,128}$/.test(given) ? given : crypto.randomUUID();
}

export function json(body: unknown, status: number, correlationId: string, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "X-Correlation-ID": correlationId, "Cache-Control": "no-store", ...extra },
  });
}

function errorResponse(error: unknown, correlationId: string): Response {
  if (error instanceof ApiError) {
    const extra: Record<string, string> = error.status === 401 ? { "WWW-Authenticate": 'Bearer realm="bvu-api"' } : {};
    return json({ error: { code: error.code, message: error.message, details: error.details }, correlationId }, error.status, correlationId, extra);
  }
  if (error instanceof AppError) {
    const status = { VALIDATION: 422, AUTHORIZATION: 403, NOT_FOUND: 404, CONFLICT: 409, DATABASE: 503, UNEXPECTED: 500 }[error.kind];
    if (status >= 500) logger.error("general", `API ${correlationId}`, error);
    // 404 bodies stay neutral: the same answer whether the object is absent or simply not visible.
    const message = error.kind === "NOT_FOUND" ? "Ressource introuvable." : error.message;
    // A refusal a machine must act on (a marking line told to stop) names itself; others keep their kind.
    const code = "code" in error && typeof error.code === "string" ? error.code : error.kind;
    return json({ error: { code, message }, correlationId }, status, correlationId);
  }
  logger.error("general", `API ${correlationId} unhandled`, error);
  return json({ error: { code: "INTERNAL", message: "Erreur interne. Réessayez avec un délai croissant." }, correlationId }, 500, correlationId);
}

/** Parses and validates a JSON body; a malformed or schema-invalid body is a 400, never retried as-is. */
export async function readBody<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > MAX_BODY_BYTES) throw new ApiError(413, "PAYLOAD_TOO_LARGE", "Corps de requête trop volumineux (1 Mo maximum).");
  let raw: unknown;
  try {
    // Counted in bytes after reading, so a chunked request without Content-Length is capped too.
    const bytes = await request.arrayBuffer();
    if (bytes.byteLength > MAX_BODY_BYTES) throw new ApiError(413, "PAYLOAD_TOO_LARGE", "Corps de requête trop volumineux (1 Mo maximum).");
    raw = JSON.parse(new TextDecoder().decode(bytes));
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(400, "INVALID_JSON", "Le corps de la requête n'est pas un JSON valide.");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new ApiError(400, "INVALID_PAYLOAD", "Payload invalide ou champ obligatoire absent.", parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
  }
  return parsed.data;
}

async function sessionFor(principal: ApiPrincipal): Promise<Session> {
  const client = await repositories.apiClients.findById(principal.clientId);
  const issuer = client ? await repositories.users.findById(client.createdBy) : null;
  if (!issuer || !issuer.active) throw new ApiError(401, "UNAUTHENTICATED", "Identifiants API invalides.");
  const session: Session = { userId: issuer.id, role: issuer.role, scopeType: issuer.scopeType, scopeId: issuer.scopeId, isDemoSwitch: false };
  // A key acts with its issuer's authority, so it stops working the moment that person is no
  // longer allowed to issue keys (role or scope changed), not only when they are deactivated.
  if (!can(session, "CREATE", "API_CLIENTS") || !isGlobalScope(session)) {
    throw new ApiError(401, "UNAUTHENTICATED", "Identifiants API invalides.");
  }
  return session;
}

export function apiRoute<P = Record<string, never>>(
  scope: ApiScope | null,
  handler: (ctx: ApiContext, params: P) => Promise<Response>
) {
  return async (request: Request, routeCtx?: { params: Promise<P> }): Promise<Response> => {
    const correlationId = correlationIdOf(request);
    try {
      const principal = await authenticateApiKey(request.headers.get("authorization"));
      if (!principal) throw new ApiError(401, "UNAUTHENTICATED", "Clé API absente ou invalide.");
      const limit = rateLimit(`api:${principal.clientId}`, RATE_LIMIT, RATE_WINDOW_MS);
      if (!limit.allowed) {
        return json({ error: { code: "RATE_LIMITED", message: "Quota dépassé." }, correlationId }, 429, correlationId, { "Retry-After": String(limit.retryAfterSeconds) });
      }
      if (scope && !principal.scopes.includes(scope)) {
        throw new ApiError(403, "FORBIDDEN_SCOPE", `Le droit « ${scope} » n'est pas accordé à ce client.`);
      }
      const session = await sessionFor(principal);
      const params = routeCtx ? await routeCtx.params : ({} as P);
      return await handler({ principal, session, correlationId, request }, params);
    } catch (error) {
      return errorResponse(error, correlationId);
    }
  };
}
