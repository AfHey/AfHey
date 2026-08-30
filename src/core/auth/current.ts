import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getPrisma } from "@/db/client";
import { readCookie, SESSION_COOKIE } from "./cookies";
import { validateSessionToken, type ValidSession } from "./sessions";

/** Session lookup for route handlers (plain Request; unit-testable). */
export async function getSessionFromRequest(request: Request): Promise<ValidSession | null> {
  const token = readCookie(request, SESSION_COOKIE);
  if (!token) return null;
  return validateSessionToken(getPrisma(), token);
}

/** Session lookup for server components/pages. */
export async function getPageSession(): Promise<ValidSession | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return validateSessionToken(getPrisma(), token);
}

/** Auth gate for pages: redirects to /login when no valid session exists. */
export async function requirePageSession(): Promise<ValidSession> {
  const session = await getPageSession();
  if (!session) redirect("/login");
  return session;
}
