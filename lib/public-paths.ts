/**
 * Pure, framework-free so it's trivial to unit test. Used by proxy.ts to decide
 * which requests skip the session check. Keep this list in sync with app/(public)
 * and app/(auth) route groups as they're built out in later phases.
 */
// The field app's worker, manifest and icons must load before login: the browser fetches them on
// its own, and a redirect would break the offline install. They expose no data.
const PUBLIC_PREFIXES = ["/login", "/tracabilite", "/mentions-legales", "/confidentialite", "/sw.js", "/manifest.webmanifest", "/icons"];

export function isPublicPath(pathname: string): boolean {
  if (pathname === "/") return true;
  return PUBLIC_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}
