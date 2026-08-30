/**
 * Step 5 auth suite (plan test list E): provisioning, password verification,
 * session lifecycle incl. rotation/revocation/bulk invalidation, cookie
 * flags, CSRF same-origin enforcement, and login rate limiting.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { assertSameOrigin, CsrfError } from "@/core/auth/csrf";
import { hashSessionToken } from "@/core/auth/tokens";
import { verifyPassword } from "@/core/auth/passwords";
import { provisionUser } from "@/core/auth/provision";
import { checkRateLimit, resetRateLimits } from "@/core/auth/rate-limit";
import {
  createSession,
  revokeAllSessions,
  revokeSession,
  validateSessionToken,
} from "@/core/auth/sessions";
import type { PrismaClient, User } from "@/db/generated/client";
import { resetTestDatabase, testDatabaseUrl } from "../helpers/test-db";

let db: PrismaClient;
let user: User;
let loginRoute: (req: Request) => Promise<Response>;
let logoutRoute: (req: Request) => Promise<Response>;

const PASSWORD = "fixture-password-1";

beforeAll(async () => {
  db = await resetTestDatabase();
  // Route handlers resolve their client from DATABASE_URL at first use;
  // point them at the test database before importing them.
  process.env.DATABASE_URL = testDatabaseUrl();
  delete (globalThis as { __afheyPrisma?: unknown }).__afheyPrisma;
  loginRoute = (await import("@/app/api/auth/login/route")).POST;
  logoutRoute = (await import("@/app/api/auth/logout/route")).POST;
  user = await provisionUser(db, PASSWORD);
}, 120_000);

afterAll(async () => {
  await db?.$disconnect();
});

beforeEach(() => resetRateLimits());

function loginRequest(password: string, headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify({ password }),
  });
}

describe("provisioning", () => {
  it("creates one user with a password credential and settings", async () => {
    expect(await db.user.count()).toBe(1);
    const credentials = await db.credential.findMany();
    expect(credentials).toHaveLength(1);
    expect(credentials[0].kind).toBe("password");
    expect(credentials[0].secretHash).not.toContain(PASSWORD);
    expect(await db.userSettings.count()).toBe(1);
  });

  it("re-provisioning replaces the password instead of adding rows", async () => {
    await provisionUser(db, "replacement-password-2");
    expect(await db.user.count()).toBe(1);
    expect(await db.credential.count()).toBe(1);
    const cred = await db.credential.findFirstOrThrow();
    expect(await verifyPassword(cred.secretHash!, "replacement-password-2")).toBe(true);
    expect(await verifyPassword(cred.secretHash!, PASSWORD)).toBe(false);
    await provisionUser(db, PASSWORD); // restore for later tests
  });

  it("rejects short passwords", async () => {
    await expect(provisionUser(db, "short")).rejects.toThrow(/at least 8/);
  });
});

describe("sessions", () => {
  it("stores only the token hash and validates round-trip", async () => {
    const issued = await createSession(db, user);
    expect(issued.session.tokenHash).toBe(hashSessionToken(issued.token));
    expect(issued.session.tokenHash).not.toBe(issued.token);
    const valid = await validateSessionToken(db, issued.token);
    expect(valid?.user.id).toBe(user.id);
    expect(await validateSessionToken(db, issued.token + "x")).toBeNull();
  });

  it("rejects expired sessions", async () => {
    const issued = await createSession(db, user);
    // Backdate creation too — session_expiry_chk requires expiry > creation.
    await db.session.update({
      where: { id: issued.session.id },
      data: {
        createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
        expiresAt: new Date(Date.now() - 60 * 60 * 1000),
      },
    });
    expect(await validateSessionToken(db, issued.token)).toBeNull();
  });

  it("supports per-session revocation", async () => {
    const issued = await createSession(db, user);
    await revokeSession(db, issued.session.id);
    expect(await validateSessionToken(db, issued.token)).toBeNull();
  });

  it("bulk-invalidates via the user revocation version", async () => {
    const a = await createSession(db, user);
    const b = await createSession(db, user);
    await revokeAllSessions(db, user.id);
    expect(await validateSessionToken(db, a.token)).toBeNull();
    expect(await validateSessionToken(db, b.token)).toBeNull();
    user = await db.user.findUniqueOrThrow({ where: { id: user.id } });
  });
});

describe("CSRF same-origin enforcement", () => {
  const req = (headers: Record<string, string>) =>
    new Request("http://localhost/x", { method: "POST", headers });

  it("accepts same-origin and non-browser requests", () => {
    expect(() =>
      assertSameOrigin(req({ origin: "http://localhost:3799", host: "localhost:3799" })),
    ).not.toThrow();
    expect(() => assertSameOrigin(req({}))).not.toThrow();
    expect(() => assertSameOrigin(req({ "sec-fetch-site": "same-origin" }))).not.toThrow();
  });

  it("rejects cross-origin and cross-site requests", () => {
    expect(() =>
      assertSameOrigin(req({ origin: "https://evil.example", host: "localhost:3799" })),
    ).toThrow(CsrfError);
    expect(() => assertSameOrigin(req({ "sec-fetch-site": "cross-site" }))).toThrow(CsrfError);
  });

  it("login route returns 403 for cross-origin requests", async () => {
    const res = await loginRoute(
      loginRequest(PASSWORD, { origin: "https://evil.example", host: "localhost" }),
    );
    expect(res.status).toBe(403);
  });
});

describe("login and logout routes", () => {
  it("rejects a wrong password with 401 and a missing body with 400", async () => {
    expect((await loginRoute(loginRequest("wrong-password"))).status).toBe(401);
    const malformed = new Request("http://localhost/api/auth/login", { method: "POST" });
    expect((await loginRoute(malformed)).status).toBe(400);
  });

  it("issues an HttpOnly SameSite=Lax session cookie on success", async () => {
    const res = await loginRoute(loginRequest(PASSWORD));
    expect(res.status).toBe(200);
    const cookie = res.headers.get("set-cookie")!;
    expect(cookie).toMatch(/^afhey_session=/);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    const token = cookie.split(";")[0].split("=")[1];
    expect(await validateSessionToken(db, token)).not.toBeNull();
  });

  it("rate limits after 10 attempts in the window", async () => {
    for (let i = 0; i < 10; i++) {
      expect((await loginRoute(loginRequest("wrong-password"))).status).toBe(401);
    }
    const res = await loginRoute(loginRequest("wrong-password"));
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBeTruthy();
  });

  it("logout revokes the session and clears the cookie", async () => {
    const login = await loginRoute(loginRequest(PASSWORD));
    const token = login.headers.get("set-cookie")!.split(";")[0].split("=")[1];
    const res = await logoutRoute(
      new Request("http://localhost/api/auth/logout", {
        method: "POST",
        headers: { cookie: `afhey_session=${token}` },
      }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(await validateSessionToken(db, token)).toBeNull();
  });
});

describe("rate limiter", () => {
  it("opens a new window after the old one ends", () => {
    expect(checkRateLimit("k", 2, 50).allowed).toBe(true);
    expect(checkRateLimit("k", 2, 50).allowed).toBe(true);
    expect(checkRateLimit("k", 2, 50).allowed).toBe(false);
  });
});
