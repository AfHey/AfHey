/**
 * Database-backed sessions (product-spec §9.5, §10.9): hashed random tokens,
 * absolute expiry, per-session revocation, and bulk invalidation through the
 * User's session-revocation version. Login rotation = a fresh Session row.
 */
import type { PrismaClient, Session, User } from "@/db/generated/client";
import { generateSessionToken, hashSessionToken } from "./tokens";

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const LAST_SEEN_THROTTLE_MS = 5 * 60 * 1000;

export interface IssuedSession {
  token: string;
  session: Session;
}

export async function createSession(db: PrismaClient, user: User): Promise<IssuedSession> {
  const token = generateSessionToken();
  const session = await db.session.create({
    data: {
      userId: user.id,
      tokenHash: hashSessionToken(token),
      revocationVersion: user.sessionRevocationVersion,
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    },
  });
  return { token, session };
}

export interface ValidSession {
  session: Session;
  user: User;
}

/** Returns the session+user for a raw token, or null when invalid. */
export async function validateSessionToken(
  db: PrismaClient,
  token: string,
): Promise<ValidSession | null> {
  const session = await db.session.findUnique({
    where: { tokenHash: hashSessionToken(token) },
    include: { user: true },
  });
  if (!session) return null;
  const now = Date.now();
  if (session.revokedAt !== null) return null;
  if (session.expiresAt.getTime() <= now) return null;
  if (session.revocationVersion !== session.user.sessionRevocationVersion) return null;

  if (now - session.lastSeenAt.getTime() > LAST_SEEN_THROTTLE_MS) {
    await db.session.update({
      where: { id: session.id },
      data: { lastSeenAt: new Date(now) },
    });
  }
  const { user, ...bare } = session;
  return { session: bare, user };
}

export async function revokeSession(db: PrismaClient, sessionId: string): Promise<void> {
  await db.session.update({
    where: { id: sessionId },
    data: { revokedAt: new Date() },
  });
}

/** Invalidates every existing session at once by bumping the user version. */
export async function revokeAllSessions(db: PrismaClient, userId: string): Promise<void> {
  await db.user.update({
    where: { id: userId },
    data: { sessionRevocationVersion: { increment: 1 } },
  });
}
