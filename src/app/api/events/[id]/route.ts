import { idFromContext, parseBody, withAuth } from "@/app/api/helpers";
import { archiveEntity, updateEventDirect } from "@/core/domain/mutations";
import { eventUpdateSchema } from "@/core/domain/schemas";
import { getPrisma } from "@/db/client";

export const PATCH = withAuth(async (request, context) => {
  const id = await idFromContext(context);
  const input = await parseBody(request, eventUpdateSchema);
  return Response.json(await updateEventDirect(getPrisma(), id, input));
});

export const DELETE = withAuth(async (_request, context) => {
  const id = await idFromContext(context);
  await archiveEntity(getPrisma(), "event", id);
  return Response.json({ ok: true });
});
