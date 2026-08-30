import { idFromContext, parseBody, withAuth } from "@/app/api/helpers";
import { archiveEntity, updateTaskDirect } from "@/core/domain/mutations";
import { taskUpdateSchema } from "@/core/domain/schemas";
import { getPrisma } from "@/db/client";

export const PATCH = withAuth(async (request, context) => {
  const id = await idFromContext(context);
  const input = await parseBody(request, taskUpdateSchema);
  return Response.json(await updateTaskDirect(getPrisma(), id, input));
});

export const DELETE = withAuth(async (_request, context) => {
  const id = await idFromContext(context);
  await archiveEntity(getPrisma(), "task", id);
  return Response.json({ ok: true });
});
