/**
 * A cross-site page cannot make a signed-in browser send a write to these routes: the request must
 * come from this origin. Server Actions check this themselves; route handlers that accept a POST
 * with the session cookie call this first.
 */
export function sameOrigin(request: Request): boolean {
  const site = request.headers.get("sec-fetch-site");
  if (site) return site === "same-origin";
  const origin = request.headers.get("origin");
  return !!origin && origin === new URL(request.url).origin;
}
