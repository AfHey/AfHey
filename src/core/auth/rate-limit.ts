/**
 * Fixed-window in-memory rate limiter for the authentication and AI
 * endpoints (spec §10.9). Sufficient for the single-user, single-instance
 * deployment; revisit alongside the hosting decision (spec §19).
 */
interface Window {
  count: number;
  windowStart: number;
}

const windows = new Map<string, Window>();

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

export function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number,
): RateLimitResult {
  const now = Date.now();
  const current = windows.get(key);
  if (!current || now - current.windowStart >= windowMs) {
    windows.set(key, { count: 1, windowStart: now });
    return { allowed: true, retryAfterSeconds: 0 };
  }
  current.count += 1;
  if (current.count > limit) {
    return {
      allowed: false,
      retryAfterSeconds: Math.ceil((current.windowStart + windowMs - now) / 1000),
    };
  }
  return { allowed: true, retryAfterSeconds: 0 };
}

export function clientKey(request: Request, scope: string): string {
  const forwarded = request.headers.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim() || "local";
  return `${scope}:${ip}`;
}

/** Test hook. */
export function resetRateLimits(): void {
  windows.clear();
}
