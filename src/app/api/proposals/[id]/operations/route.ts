import { z } from "zod";
import { idFromContext, parseBody, withAuth } from "@/app/api/helpers";
import { reviseProposal } from "@/core/captures/review";
import { ProposalStateError, ProposalValidationError } from "@/core/proposals/errors";
import { getPrisma } from "@/db/client";

const schema = z.object({
  operations: z
    .array(
      z.object({
        sourceOperationId: z.uuid().optional(),
        entityType: z.enum(["task", "event", "note", "person", "project"]),
        after: z.unknown(),
        dependsOn: z.array(z.number().int().min(0)).default([]),
      }),
    )
    .min(1)
    .max(50),
});

export const PUT = withAuth(async (request, context) => {
  const proposalId = await idFromContext(context);
  const { operations } = await parseBody(request, schema);
  try {
    return Response.json(await reviseProposal(getPrisma(), proposalId, operations));
  } catch (error) {
    if (error instanceof ProposalValidationError) {
      return Response.json({ error: "Invalid edit", issues: error.problems }, { status: 422 });
    }
    if (error instanceof ProposalStateError) {
      return Response.json({ error: error.message }, { status: 409 });
    }
    throw error;
  }
});
