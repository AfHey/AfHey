import { parseBody, withAuth } from "@/app/api/helpers";
import { createNoteDirect } from "@/core/domain/mutations";
import { noteCreateSchema } from "@/core/domain/schemas";
import { getPrisma } from "@/db/client";

export const POST = withAuth(async (request) => {
  const input = await parseBody(request, noteCreateSchema);
  return Response.json(await createNoteDirect(getPrisma(), input), { status: 201 });
});
