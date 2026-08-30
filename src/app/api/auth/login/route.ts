import { z } from "zod";
import { readCookie, SESSION_COOKIE, sessionCookieHeader } from "@/core/auth/cookies";
import { assertSameOrigin, CsrfError } from "@/core/auth/csrf";
import { checkRateLimit, clientKey } from "@/core/auth/rate-limit";
import { verifyPassword } from "@/core/auth/passwords";
import { createSession, validateSessionToken } from "@/core/auth/sessions";
import { getPrisma } from "@/db/client";

const bodySchema = z.object({ password: z.string().min(1).max(1024) });

const LOGIN_ATTEMPT_LIMIT = 5;
const LOGIN_WINDOW_MS = 60_000;

export async function POST(request: Request): Promise<Response> {
  try {
    assertSameOrigin(request);
  } catch (error) {
    if (error instanceof CsrfError) {
      return Response.json({ error: "Cross-origin request rejected" }, { status: 403 });
    }
    throw error;
  }

  const rate = checkRateLimit(clientKey(request, "login"), LOGIN_ATTEMPT_LIMIT, LOGIN_WINDOW_MS);
  if (!rate.allowed) {
    return Response.json(
      { error: "Too many attempts; try again shortly" },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } },
    );
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "Password is required" }, { status: 400 });
  }

  const db = getPrisma();
  const credential = await db.credential.findFirst({
    where: { kind: "password" },
    include: { user: true },
  });
  const valid =
    credential?.secretHash != null &&
    (await verifyPassword(credential.secretHash, parsed.data.password));
  if (!credential || !valid) {
    return Response.json({ error: "Incorrect password" }, { status: 401 });
  }

  await db.credential.update({
    where: { id: credential.id },
    data: { lastUsedAt: new Date() },
  });

  // Rotation: an already-authenticated browser logging in again gets a fresh
  // session row; the old cookie value is revoked.
  const priorToken = readCookie(request, SESSION_COOKIE);
  if (priorToken) {
    const prior = await validateSessionToken(db, priorToken);
    if (prior) {
      await db.session.update({
        where: { id: prior.session.id },
        data: { revokedAt: new Date() },
      });
    }
  }

  const issued = await createSession(db, credential.user);
  return Response.json(
    { ok: true },
    { headers: { "Set-Cookie": sessionCookieHeader(issued.token, issued.session.expiresAt) } },
  );
}
