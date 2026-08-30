import { idFromContext, parseBody, withAuth } from "@/app/api/helpers";
import { addPersonAliasDirect } from "@/core/domain/mutations";
import { aliasAddSchema } from "@/core/domain/schemas";
import { getPrisma } from "@/db/client";

export const POST = withAuth(async (request, context) => {
  const personId = await idFromContext(context);
  const { alias } = await parseBody(request, aliasAddSchema);
  return Response.json(await addPersonAliasDirect(getPrisma(), personId, alias), {
    status: 201,
  });
});
