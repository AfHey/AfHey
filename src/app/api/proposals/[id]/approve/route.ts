import { idFromContext, withAuth } from "@/app/api/helpers";
import { approveAndApply } from "@/core/captures/review";
import { ProposalStateError } from "@/core/proposals/errors";
import { getPrisma } from "@/db/client";

export const POST = withAuth(async (_request, context) => {
  const proposalId = await idFromContext(context);
  try {
    return Response.json(await approveAndApply(getPrisma(), proposalId));
  } catch (error) {
    if (error instanceof ProposalStateError) {
      return Response.json({ error: error.message }, { status: 409 });
    }
    throw error;
  }
});
