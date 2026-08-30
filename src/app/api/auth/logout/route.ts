import { clearSessionCookieHeader } from "@/core/auth/cookies";
import { assertSameOrigin, CsrfError } from "@/core/auth/csrf";
import { getSessionFromRequest } from "@/core/auth/current";
import { revokeSession } from "@/core/auth/sessions";
import { getPrisma } from "@/db/client";

export async function POST(request: Request): Promise<Response> {
  try {
    assertSameOrigin(request);
  } catch (error) {
    if (error instanceof CsrfError) {
      return Response.json({ error: "Cross-origin request rejected" }, { status: 403 });
    }
    throw error;
  }

  const current = await getSessionFromRequest(request);
  if (current) {
    await revokeSession(getPrisma(), current.session.id);
  }
  return Response.json(
    { ok: true },
    { headers: { "Set-Cookie": clearSessionCookieHeader() } },
  );
}
