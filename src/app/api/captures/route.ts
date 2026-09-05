import { z } from "zod";
import { parseBody, withAuth } from "@/app/api/helpers";
import { submitCapture } from "@/core/captures/review";
import { getPrisma } from "@/db/client";

const schema = z.object({
  text: z.string().trim().min(1).max(20_000),
  sourceType: z.enum(["typed", "pasted", "dictated"]).default("typed"),
  noAi: z.boolean().default(false),
});

export const POST = withAuth(async (request) => {
  const input = await parseBody(request, schema);
  const outcome = await submitCapture(getPrisma(), input);
  return Response.json(outcome, { status: 201 });
});
