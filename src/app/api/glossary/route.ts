import { parseBody, withAuth } from "@/app/api/helpers";
import { upsertGlossaryEntryDirect } from "@/core/domain/mutations";
import { glossaryEntrySchema } from "@/core/domain/schemas";
import { getPrisma } from "@/db/client";

export const POST = withAuth(async (request) => {
  const input = await parseBody(request, glossaryEntrySchema);
  return Response.json(await upsertGlossaryEntryDirect(getPrisma(), input), {
    status: 201,
  });
});
