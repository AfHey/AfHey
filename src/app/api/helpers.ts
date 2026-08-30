import { ZodError, type ZodType } from "zod";
import { assertSameOrigin, CsrfError } from "@/core/auth/csrf";
import { getSessionFromRequest } from "@/core/auth/current";
import type { ValidSession } from "@/core/auth/sessions";
import { DomainInvariantError } from "@/core/domain/invariants";
import { RevisionConflictError } from "@/core/domain/mutations";

type RouteContext = { params: Promise<Record<string, string>> };
type Handler = (
  request: Request,
  context: RouteContext,
  session: ValidSession,
) => Promise<Response>;

function isPrismaNotFound(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as { code?: string }).code === "P2025"
  );
}

/**
 * Wraps a mutating route handler with the cross-cutting rules: same-origin
 * CSRF check, session requirement, and uniform error mapping.
 */
export function withAuth(handler: Handler) {
  return async (request: Request, context: RouteContext): Promise<Response> => {
    try {
      if (request.method !== "GET") assertSameOrigin(request);
      const session = await getSessionFromRequest(request);
      if (!session) {
        return Response.json({ error: "Not signed in" }, { status: 401 });
      }
      return await handler(request, context, session);
    } catch (error) {
      if (error instanceof CsrfError) {
        return Response.json({ error: "Cross-origin request rejected" }, { status: 403 });
      }
      if (error instanceof ZodError) {
        return Response.json(
          { error: "Invalid input", issues: error.issues.map((i) => i.message) },
          { status: 400 },
        );
      }
      if (error instanceof DomainInvariantError) {
        return Response.json(
          { error: error.message, violations: error.violations },
          { status: 422 },
        );
      }
      if (error instanceof RevisionConflictError) {
        return Response.json({ error: error.message }, { status: 409 });
      }
      if (isPrismaNotFound(error)) {
        return Response.json({ error: "Not found" }, { status: 404 });
      }
      if (
        error instanceof Error &&
        "code" in error &&
        (error as { code?: string }).code === "P2002"
      ) {
        return Response.json({ error: "That value already exists" }, { status: 409 });
      }
      throw error;
    }
  };
}

export async function parseBody<T>(request: Request, schema: ZodType<T>): Promise<T> {
  const raw = await request.json().catch(() => {
    throw new ZodError([
      { code: "custom", message: "Request body must be JSON", path: [], input: undefined },
    ]);
  });
  return schema.parse(raw);
}

export async function idFromContext(context: RouteContext): Promise<string> {
  const { id } = await context.params;
  return id;
}
