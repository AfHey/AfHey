import { createHash, randomBytes } from "node:crypto";

/** 256-bit random session token; only its hash is ever stored (spec §9.5). */
export function generateSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
