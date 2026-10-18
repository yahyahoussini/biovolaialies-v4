/**
 * Fixed-window, in-memory rate limiter. Deliberately simple: it is per server instance, so on
 * a serverless host each warm instance counts separately — a brake on bursts from one client,
 * not a global quota. Good enough for a contact form and an API at pilot scale; a shared store
 * (Redis/Upstash) is the upgrade path if real abuse appears.
 */
interface Window {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Window>();
const MAX_KEYS = 10_000;

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export function rateLimit(key: string, limit: number, windowMs: number, now: number = Date.now()): RateLimitResult {
  if (buckets.size >= MAX_KEYS) {
    for (const [k, w] of buckets) if (w.resetAt <= now) buckets.delete(k);
    // Still full of live windows (e.g. rotating fake addresses): drop the oldest — Maps keep
    // insertion order — so memory stays bounded whatever the traffic.
    while (buckets.size >= MAX_KEYS) buckets.delete(buckets.keys().next().value as string);
  }
  let window = buckets.get(key);
  if (!window || window.resetAt <= now) {
    window = { count: 0, resetAt: now + windowMs };
    buckets.set(key, window);
  }
  window.count += 1;
  const allowed = window.count <= limit;
  return {
    allowed,
    remaining: Math.max(0, limit - window.count),
    retryAfterSeconds: allowed ? 0 : Math.ceil((window.resetAt - now) / 1000),
  };
}

/** Test helper — clears every window. */
export function resetRateLimits(): void {
  buckets.clear();
}
