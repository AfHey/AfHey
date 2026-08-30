import { idFromContext, parseBody, withAuth } from "@/app/api/helpers";
import { archiveEntity, updateNoteDirect } from "@/core/domain/mutations";
import { noteUpdateSchema } from "@/core/domain/schemas";
import { getPrisma } from "@/db/client";

export const PATCH = withAuth(async (request, context) => {
  const id = await idFromContext(context);
  const input = await parseBody(request, noteUpdateSchema);
  return Response.json(await updateNoteDirect(getPrisma(), id, input));
});

export const DELETE = withAuth(async (_request, context) => {
  const id = await idFromContext(context);
  await archiveEntity(getPrisma(), "note", id);
  return Response.json({ ok: true });
});
