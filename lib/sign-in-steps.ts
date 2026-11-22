/**
 * The steps of a sign-in, shared by the server (services/auth/login.ts) and the sign-in forms.
 * Pure, no server imports.
 */
export type SignInNext = "DONE" | "SECOND_FACTOR" | "PASSWORD_CHANGE" | "MFA_SETUP";

const DEFAULT_NEXT = "/dashboard";

/** Any absolute base works — it exists only so the parser can tell same-origin from off-origin. */
const ORIGIN_PROBE = "http://login-next.invalid";

/**
 * `?next=` is attacker-controllable, and this app is publicly reachable once deployed, so the
 * post-login redirect is an open-redirect target: a link to our own domain that bounces the
 * freshly-authenticated visitor to someone else's.
 *
 * A `startsWith("/")` test is not enough — `//evil.com` is protocol-relative and browsers treat
 * it as absolute — and neither is a hand-rolled `//` rejection, because the URL parser strips
 * tabs and newlines, so `/\t/evil.com` becomes `//evil.com` after we have already checked it.
 * So we let the parser resolve the value and keep it only if it stayed on our own origin,
 * re-serializing just the path/query/hash.
 */
export function safeNextPath(value: string | string[] | undefined): string {
  if (typeof value !== "string" || !value.startsWith("/")) return DEFAULT_NEXT;
  try {
    const resolved = new URL(value, ORIGIN_PROBE);
    if (resolved.origin !== ORIGIN_PROBE) return DEFAULT_NEXT;
    if (resolved.pathname.startsWith("/login")) return DEFAULT_NEXT;
    return `${resolved.pathname}${resolved.search}${resolved.hash}`;
  } catch {
    return DEFAULT_NEXT;
  }
}

/** Where a sign-in goes after a step: the next step's page, or the page asked for. */
export function signInStepPath(next: SignInNext, after: string): string {
  const query = `?next=${encodeURIComponent(after)}`;
  switch (next) {
    case "SECOND_FACTOR":
      return `/login/verification${query}`;
    case "PASSWORD_CHANGE":
      return `/login/nouveau-mot-de-passe${query}`;
    case "MFA_SETUP":
      return `/login/double-authentification${query}`;
    default:
      return after;
  }
}
