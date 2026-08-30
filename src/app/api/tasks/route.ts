import { withAuth, parseBody } from "@/app/api/helpers";
import { createTaskDirect } from "@/core/domain/mutations";
import { taskCreateSchema } from "@/core/domain/schemas";
import { getPrisma } from "@/db/client";

export const POST = withAuth(async (request) => {
  const input = await parseBody(request, taskCreateSchema);
  const task = await createTaskDirect(getPrisma(), input);
  return Response.json(task, { status: 201 });
});
