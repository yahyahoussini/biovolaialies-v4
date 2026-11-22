import type { SessionOptions } from "iron-session";
import { env } from "../../lib/env";
import type { Role, ScopeType } from "../../domain/shared/enums";

// No `import "server-only"` — this config is also imported by tests (see lib/env.ts for why).

/** Shape stored in the encrypted cookie. All fields optional — empty object means "not logged in". */
export interface SessionData {
  userId?: string;
  role?: Role;
  scopeType?: ScopeType;
  scopeId?: string | null;
  /** Set when this session was minted via the demo role switcher (services/auth/demo-switch.ts), not a real login form submission. Drives the "Mode démo" indicator. */
  isDemoSwitch?: boolean;
  /** The account's session version when this session was opened (users.auth_version): a bump ends it. */
  authVersion?: number;
  /** A sign-in that still has a step to complete before the application opens (services/auth/login.ts). */
  restriction?: SignInRestriction;
  /** Password accepted, two-step code awaited: who, since when, and at which session version. */
  pendingUserId?: string;
  pendingAt?: number;
  pendingAuthVersion?: number;
}

/** PASSWORD_CHANGE: the administrator chose the password, the user replaces it. MFA_SETUP: the role requires two-step login and it is not set up yet. */
export type SignInRestriction = "PASSWORD_CHANGE" | "MFA_SETUP";

export const sessionOptions: SessionOptions = {
  cookieName: "biovolailles_session",
  password: env.SESSION_SECRET,
  ttl: 60 * 60 * 8, // 8h — short sessions per ARCHITECTURE.md §8 (security by default)
  cookieOptions: {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "lax",
  },
};
