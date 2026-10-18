/**
 * Pure, framework-free so it's trivial to unit test. Used by proxy.ts to decide
 * which requests skip the session check. Keep this list in sync with app/(public)
 * and app/(auth) route groups as they're built out in later phases.
 */
const PUBLIC_PREFIXES = ["/login", "/tracabilite", "/mentions-legales", "/confidentialite"];

export function isPublicPath(pathname: string): boolean {
  if (pathname === "/") return true;
  return PUBLIC_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}
