import { idFromContext, parseBody, withAuth } from "@/app/api/helpers";
import { archiveEntity, upsertGlossaryEntryDirect } from "@/core/domain/mutations";
import { glossaryEntrySchema } from "@/core/domain/schemas";
import { getPrisma } from "@/db/client";

export const PATCH = withAuth(async (request, context) => {
  const id = await idFromContext(context);
  const input = await parseBody(request, glossaryEntrySchema);
  return Response.json(await upsertGlossaryEntryDirect(getPrisma(), input, id));
});

export const DELETE = withAuth(async (_request, context) => {
  const id = await idFromContext(context);
  await archiveEntity(getPrisma(), "glossaryEntry", id);
  return Response.json({ ok: true });
});
