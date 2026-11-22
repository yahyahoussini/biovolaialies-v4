import { cache } from "react";
import { cookies } from "next/headers";
import { getIronSession, type IronSession } from "iron-session";
import { repositories } from "../../data/repositories";
import { AuthorizationError } from "../../domain/shared/errors";
import type { PermissionSubject } from "../../domain/shared/permissions";
import type { User } from "../../domain/identity/types";
import { sessionOptions, type SessionData, type SignInRestriction } from "./config";

// No `import "server-only"` — see lib/env.ts. `next/headers` is itself unusable outside
// a real Next.js request, which already keeps this out of any client bundle.

/** Fully-populated session for a logged-in user. Satisfies PermissionSubject so it plugs straight into can(). */
export interface Session extends PermissionSubject {
  userId: string;
  isDemoSwitch: boolean;
}

/** How long the step between a correct password and the two-step code may last. */
export const PENDING_SECOND_FACTOR_MS = 10 * 60_000;

async function getIronSessionInstance(): Promise<IronSession<SessionData>> {
  const cookieStore = await cookies();
  return getIronSession<SessionData>(cookieStore, sessionOptions);
}

/** The account behind a cookie is still the one it was opened for: present, active, same session version. */
export function sessionStillValid(user: User | null, authVersion: number | undefined): user is User {
  return Boolean(user && user.active && user.authVersion === (authVersion ?? 0));
}

/**
 * Reads the current session, if any. Cached per request (React cache()) so multiple
 * Server Components/Actions in the same render can call this without re-decrypting
 * the cookie each time. Returns null when no one is logged in — callers decide
 * whether that's an error (see requireSession).
 *
 * The account is read from the database on every request: a session ends as soon as the account is
 * disabled, its password reset or its role changed (users.auth_version), and role and scope are the
 * account's current ones, not those written in the cookie hours ago. A session still at a sign-in
 * step (new password to choose, two-step login to set up) is not a session: every page and action
 * refuses it, and the sign-in pages lead it on.
 */
export const getCurrentSession = cache(async (): Promise<Session | null> => {
  const ironSession = await getIronSessionInstance();
  if (!ironSession.userId || ironSession.restriction) return null;
  const user = await repositories.users.findById(ironSession.userId);
  if (!sessionStillValid(user, ironSession.authVersion)) return null;
  return {
    userId: user.id,
    role: user.role,
    scopeType: user.scopeType,
    scopeId: user.scopeId ?? null,
    isDemoSwitch: ironSession.isDemoSwitch ?? false,
  };
});

/** Same as getCurrentSession but throws for routes/actions that require a logged-in user. */
export async function requireSession(): Promise<Session> {
  const session = await getCurrentSession();
  if (!session) throw new AuthorizationError("Connexion requise.");
  return session;
}

export type SignInStage = { kind: "SECOND_FACTOR"; user: User } | { kind: SignInRestriction; user: User };

/** Where an unfinished sign-in stands: waiting for the two-step code, or for a sign-in restriction to be lifted. Null otherwise. */
export async function getSignInStage(now = Date.now()): Promise<SignInStage | null> {
  const s = await getIronSessionInstance();
  if (s.pendingUserId && s.pendingAt && now - s.pendingAt <= PENDING_SECOND_FACTOR_MS) {
    const user = await repositories.users.findById(s.pendingUserId);
    if (sessionStillValid(user, s.pendingAuthVersion) && user.totpEnabledAt) return { kind: "SECOND_FACTOR", user };
    return null;
  }
  if (s.userId && s.restriction) {
    const user = await repositories.users.findById(s.userId);
    if (sessionStillValid(user, s.authVersion)) return { kind: s.restriction, user };
  }
  return null;
}

/** Internal — only the sign-in services should reach for the raw iron-session instance. */
export async function getMutableIronSession(): Promise<IronSession<SessionData>> {
  return getIronSessionInstance();
}

/** After the user changed their own password or two-step login: keep this session, end the others. */
export async function adoptAuthVersion(authVersion: number): Promise<void> {
  const s = await getIronSessionInstance();
  if (!s.userId) return;
  s.authVersion = authVersion;
  await s.save();
}
