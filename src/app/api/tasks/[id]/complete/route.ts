import { z } from "zod";
import { idFromContext, parseBody, withAuth } from "@/app/api/helpers";
import { completeTaskDirect, uncompleteTaskDirect } from "@/core/domain/mutations";
import { getPrisma } from "@/db/client";

const schema = z.object({ completed: z.boolean() });

export const POST = withAuth(async (request, context) => {
  const id = await idFromContext(context);
  const { completed } = await parseBody(request, schema);
  const task = completed
    ? await completeTaskDirect(getPrisma(), id)
    : await uncompleteTaskDirect(getPrisma(), id);
  return Response.json(task);
});
