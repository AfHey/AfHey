export class CsrfError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CsrfError";
  }
}

/**
 * CSRF defense for mutating endpoints (spec §10.9), layered on the
 * SameSite=Lax session cookie: a browser request must prove same-origin via
 * its Origin header (or Sec-Fetch-Site when Origin is absent). Requests with
 * neither header are non-browser clients, which cannot ride a victim's
 * cookie jar and are therefore not CSRF vectors.
 */
export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (origin !== null) {
    let originHost: string;
    try {
      originHost = new URL(origin).host;
    } catch {
      throw new CsrfError(`Malformed Origin header: ${origin}`);
    }
    if (host === null || originHost !== host) {
      throw new CsrfError(`Cross-origin mutation rejected (origin ${origin})`);
    }
    return;
  }
  const site = request.headers.get("sec-fetch-site");
  if (site !== null && site !== "same-origin" && site !== "none") {
    throw new CsrfError(`Cross-site mutation rejected (sec-fetch-site ${site})`);
  }
}
