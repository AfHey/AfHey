import { z } from "zod";
import { idFromContext, parseBody, withAuth } from "@/app/api/helpers";
import { markBlockDone, moveBlock, setBlockFixed, setBlockLocked, unscheduleBlock } from "@/core/domain/blocks";
import { getPrisma } from "@/db/client";

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("move"), startAt: z.iso.datetime({ offset: true }), endAt: z.iso.datetime({ offset: true }) }),
  z.object({ action: z.literal("lock"), locked: z.boolean() }),
  z.object({ action: z.literal("fixed"), fixed: z.boolean() }),
  z.object({ action: z.literal("unschedule") }),
  z.object({ action: z.literal("done") }),
]);

/** Direct block actions (spec §5, §10.5–10.6): manual edits, no Proposal. */
export const PATCH = withAuth(async (request, context) => {
  const id = await idFromContext(context);
  const input = await parseBody(request, actionSchema);
  const db = getPrisma();
  switch (input.action) {
    case "move":
      return Response.json(await moveBlock(db, id, { startAt: input.startAt, endAt: input.endAt }));
    case "lock":
      return Response.json({ event: await setBlockLocked(db, id, input.locked), warnings: [] });
    case "fixed":
      return Response.json({ event: await setBlockFixed(db, id, input.fixed), warnings: [] });
    case "unschedule":
      return Response.json({ event: await unscheduleBlock(db, id), warnings: [] });
    case "done":
      return Response.json({ event: await markBlockDone(db, id), warnings: [] });
  }
});
