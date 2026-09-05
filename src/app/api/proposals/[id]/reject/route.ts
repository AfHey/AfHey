import { z } from "zod";
import { idFromContext, parseBody, withAuth } from "@/app/api/helpers";
import { rejectReview } from "@/core/captures/review";
import { ProposalStateError } from "@/core/proposals/errors";
import { getPrisma } from "@/db/client";

const schema = z.object({ rejectCapture: z.boolean().default(true) });

export const POST = withAuth(async (request, context) => {
  const proposalId = await idFromContext(context);
  const { rejectCapture } = await parseBody(request, schema);
  try {
    return Response.json(await rejectReview(getPrisma(), proposalId, { rejectCapture }));
  } catch (error) {
    if (error instanceof ProposalStateError) {
      return Response.json({ error: error.message }, { status: 409 });
    }
    throw error;
  }
});
