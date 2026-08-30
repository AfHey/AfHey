import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/core/auth/cookies";

/**
 * Optimistic auth gate (Next 16 proxy): redirects cookie-less requests to
 * /login. Real session validation happens in pages via requirePageSession()
 * and in route handlers — this only short-circuits the obvious case.
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isPublic = pathname === "/login" || pathname.startsWith("/api/auth/");
  if (!isPublic && !request.cookies.has(SESSION_COOKIE)) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  return NextResponse.next();
}

export const config = {
  // Everything except Next internals and static assets.
  matcher: ["/((?!_next/|favicon\\.ico|.*\\.[a-zA-Z0-9]+$).*)"],
};
