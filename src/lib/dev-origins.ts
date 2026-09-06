/**
 * Hostnames allowed to load Next.js dev-only resources (`/_next/static`,
 * HMR) besides localhost — the phone on the LAN or a Tailscale address.
 * Read by next.config.ts from AFHEY_DEV_ORIGINS; Next applies the list in
 * development only, so it never loosens the production server or the
 * session cookie's Secure flag (decisions.md 2026-09-05 "LAN access to the
 * development server").
 */
export function parseDevOrigins(value: string | undefined): string[] {
  if (!value) return [];
  const seen = new Set<string>();
  for (const raw of value.split(",")) {
    const host = raw.trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/:\d+$/, "");
    if (host) seen.add(host);
  }
  return [...seen];
}
