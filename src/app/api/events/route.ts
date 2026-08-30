import { parseBody, withAuth } from "@/app/api/helpers";
import { createEventDirect } from "@/core/domain/mutations";
import { eventCreateSchema } from "@/core/domain/schemas";
import { getPrisma } from "@/db/client";

export const POST = withAuth(async (request) => {
  const input = await parseBody(request, eventCreateSchema);
  return Response.json(await createEventDirect(getPrisma(), input), { status: 201 });
});
