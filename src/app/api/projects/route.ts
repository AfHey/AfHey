import { parseBody, withAuth } from "@/app/api/helpers";
import { createProjectDirect } from "@/core/domain/mutations";
import { projectCreateSchema } from "@/core/domain/schemas";
import { getPrisma } from "@/db/client";

export const POST = withAuth(async (request) => {
  const input = await parseBody(request, projectCreateSchema);
  return Response.json(await createProjectDirect(getPrisma(), input), { status: 201 });
});
