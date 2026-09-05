import { z } from "zod";
import { parseBody, withAuth } from "@/app/api/helpers";
import { startWorkSession } from "@/core/domain/blocks";
import { getPrisma } from "@/db/client";

const startSchema = z.object({ taskId: z.uuid(), eventId: z.uuid().nullish() });

/** Focus timer start (spec §4.1 item 3): one active session at a time. */
export const POST = withAuth(async (request) => {
  const input = await parseBody(request, startSchema);
  return Response.json(await startWorkSession(getPrisma(), { taskId: input.taskId, eventId: input.eventId ?? null }), { status: 201 });
});
