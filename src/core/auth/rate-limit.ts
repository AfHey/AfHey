/**
 * Fixed-window in-memory rate limiter for the authentication and AI
 * endpoints (spec §10.9). Sufficient for the single-user, single-instance
 * deployment; revisit alongside the hosting decision (spec §19).
 *
 * Client-address keys are only as trustworthy as the deployment's proxy
 * boundary (architecture.md "Deployment requirements"), so callers pair them
 * with address-independent budgets (per account, per authenticated user).
 * Expired windows are swept periodically so hostile key rotation cannot grow
 * the map without bound (finding 15).
 */
interface Window {
  count: number;
  windowStart: number;
  windowMs: number;
}

const windows = new Map<string, Window>();
let lastSweep = 0;
const SWEEP_INTERVAL_MS = 30_000;

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

export function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number,
  now: number = Date.now(),
): RateLimitResult {
  if (now - lastSweep >= SWEEP_INTERVAL_MS) {
    sweepExpiredRateLimits(now);
    lastSweep = now;
  }
  const current = windows.get(key);
  if (!current || now - current.windowStart >= current.windowMs) {
    windows.set(key, { count: 1, windowStart: now, windowMs });
    return { allowed: true, retryAfterSeconds: 0 };
  }
  current.count += 1;
  if (current.count > limit) {
    return {
      allowed: false,
      retryAfterSeconds: Math.ceil((current.windowStart + current.windowMs - now) / 1000),
    };
  }
  return { allowed: true, retryAfterSeconds: 0 };
}

/** Combines several budgets: denied if any is exhausted; longest wait wins. */
export function combineRateLimits(...results: RateLimitResult[]): RateLimitResult {
  return {
    allowed: results.every((r) => r.allowed),
    retryAfterSeconds: Math.max(0, ...results.map((r) => r.retryAfterSeconds)),
  };
}

/** Removes windows that have ended; returns how many were removed. */
export function sweepExpiredRateLimits(now: number = Date.now()): number {
  let removed = 0;
  for (const [key, window] of windows) {
    if (now - window.windowStart >= window.windowMs) {
      windows.delete(key);
      removed += 1;
    }
  }
  return removed;
}

export function clientKey(request: Request, scope: string): string {
  const forwarded = request.headers.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim() || "local";
  return `${scope}:${ip}`;
}

/** Test hooks. */
export function resetRateLimits(): void {
  windows.clear();
  lastSweep = 0;
}

export function rateLimitEntryCount(): number {
  return windows.size;
}
