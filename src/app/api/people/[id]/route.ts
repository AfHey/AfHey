import { idFromContext, parseBody, withAuth } from "@/app/api/helpers";
import { archiveEntity, updatePersonDirect } from "@/core/domain/mutations";
import { personUpdateSchema } from "@/core/domain/schemas";
import { getPrisma } from "@/db/client";

export const PATCH = withAuth(async (request, context) => {
  const id = await idFromContext(context);
  const input = await parseBody(request, personUpdateSchema);
  return Response.json(await updatePersonDirect(getPrisma(), id, input));
});

export const DELETE = withAuth(async (_request, context) => {
  const id = await idFromContext(context);
  await archiveEntity(getPrisma(), "person", id);
  return Response.json({ ok: true });
});
