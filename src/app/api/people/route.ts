import { parseBody, withAuth } from "@/app/api/helpers";
import { createPersonDirect } from "@/core/domain/mutations";
import { personCreateSchema } from "@/core/domain/schemas";
import { getPrisma } from "@/db/client";

export const POST = withAuth(async (request) => {
  const input = await parseBody(request, personCreateSchema);
  return Response.json(await createPersonDirect(getPrisma(), input), { status: 201 });
});
