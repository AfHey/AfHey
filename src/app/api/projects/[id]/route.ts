import { idFromContext, parseBody, withAuth } from "@/app/api/helpers";
import { archiveEntity, updateProjectDirect } from "@/core/domain/mutations";
import { projectUpdateSchema } from "@/core/domain/schemas";
import { getPrisma } from "@/db/client";

export const PATCH = withAuth(async (request, context) => {
  const id = await idFromContext(context);
  const input = await parseBody(request, projectUpdateSchema);
  return Response.json(await updateProjectDirect(getPrisma(), id, input));
});

export const DELETE = withAuth(async (_request, context) => {
  const id = await idFromContext(context);
  await archiveEntity(getPrisma(), "project", id);
  return Response.json({ ok: true });
});
