import { createHash } from "node:crypto";
import { repositories } from "../../data/repositories";
import { FAILURE_WINDOW_MS, MAX_FAILURES_PER_ACCOUNT, MAX_FAILURES_PER_CLIENT, type AuthEvent, type AuthOutcome } from "../../domain/governance/governance";
import { AuthorizationError } from "../../domain/shared/errors";
import { can } from "../../domain/shared/permissions";
import { env } from "../../lib/env";
import type { Session } from "./session";

/**
 * The authentication journal (document 3, ch. 08: "journal d'audit, journal d'authentification").
 * Sign-in failures are counted from the database, not in memory, so the limit holds across server
 * instances; the device is kept as a keyed hash of its address, never the address itself.
 */

export interface ClientInfo {
  ip: string | null;
  userAgent: string | null;
}

export function clientHash(ip: string | null): string | null {
  if (!ip) return null;
  return createHash("sha256").update(`${env.SESSION_SECRET}:${ip}`).digest("hex").slice(0, 16);
}

export async function recordAuthEvent(input: { email: string; userId: string | null; outcome: AuthOutcome; client?: ClientInfo; detail?: string | null }, now = new Date()): Promise<AuthEvent> {
  return repositories.authEvents.record({
    at: now.toISOString(),
    email: input.email.trim().toLowerCase().slice(0, 254),
    userId: input.userId,
    outcome: input.outcome,
    clientHash: clientHash(input.client?.ip ?? null),
    userAgent: input.client?.userAgent?.slice(0, 200) ?? null,
    detail: input.detail ?? null,
  });
}

/**
 * Whether a sign-in may even be tried: too many recent failures for this account, or from this
 * device, refuse it before the password is checked. The message is the same whether the account
 * exists or not.
 */
export async function signInRefusal(email: string, client: ClientInfo | undefined, now = new Date()): Promise<string | null> {
  const since = new Date(now.getTime() - FAILURE_WINDOW_MS).toISOString();
  const normalized = email.trim().toLowerCase();
  if ((await repositories.authEvents.countSince("email", normalized, "ECHEC", since)) >= MAX_FAILURES_PER_ACCOUNT) {
    return "Trop d'essais pour ce compte : réessayez dans 15 minutes.";
  }
  const hash = clientHash(client?.ip ?? null);
  if (hash && (await repositories.authEvents.countSince("clientHash", hash, "ECHEC", since)) >= MAX_FAILURES_PER_CLIENT) {
    return "Trop d'essais depuis cet appareil : réessayez dans 15 minutes.";
  }
  return null;
}

export interface AuthEventRow extends AuthEvent {
  userName: string | null;
}

export async function listAuthEvents(session: Session, filters: { email?: string; outcome?: AuthOutcome } = {}): Promise<AuthEventRow[]> {
  if (!can(session, "VIEW", "USERS") && !can(session, "VIEW", "AUDIT")) throw new AuthorizationError("Le journal des connexions est réservé à l'administration et à l'audit.");
  const [events, users] = await Promise.all([repositories.authEvents.list({ email: filters.email?.trim().toLowerCase() || undefined, outcome: filters.outcome }, 300), repositories.users.list()]);
  const nameOf = new Map(users.map((u) => [u.id, u.fullName]));
  return events.map((e) => ({ ...e, userName: e.userId ? (nameOf.get(e.userId) ?? null) : null }));
}
