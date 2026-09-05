import { idFromContext, withAuth } from "@/app/api/helpers";
import { startUndo } from "@/core/captures/review";
import { ProposalStateError, ProposalValidationError } from "@/core/proposals/errors";
import { getPrisma } from "@/db/client";

export const POST = withAuth(async (_request, context) => {
  const actionId = await idFromContext(context);
  try {
    return Response.json(await startUndo(getPrisma(), actionId), { status: 201 });
  } catch (error) {
    if (error instanceof ProposalStateError || error instanceof ProposalValidationError) {
      return Response.json({ error: error.message }, { status: 409 });
    }
    throw error;
  }
});
