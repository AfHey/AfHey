import { idFromContext, withAuth } from "@/app/api/helpers";
import { applyProposal } from "@/core/proposals/apply";
import { ProposalStateError } from "@/core/proposals/errors";
import { reapproveRecoveredProposal } from "@/core/proposals/lifecycle";
import { getPrisma } from "@/db/client";

/**
 * Re-approval path for proposals that recovery marked failed after an
 * interrupted apply (finding 3): re-validates expected revisions, approves,
 * and applies in one step.
 */
export const POST = withAuth(async (_request, context) => {
  const proposalId = await idFromContext(context);
  try {
    await reapproveRecoveredProposal(getPrisma(), proposalId);
    return Response.json(await applyProposal(getPrisma(), proposalId));
  } catch (error) {
    if (error instanceof ProposalStateError) {
      return Response.json({ error: error.message }, { status: 409 });
    }
    throw error;
  }
});
