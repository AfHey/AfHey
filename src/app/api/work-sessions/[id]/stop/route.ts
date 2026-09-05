import { z } from "zod";
import { idFromContext, parseBody, withAuth } from "@/app/api/helpers";
import { stopWorkSession } from "@/core/domain/blocks";
import { getPrisma } from "@/db/client";

const stopSchema = z
  .object({ adjustedDurationMinutes: z.number().int().positive(), adjustmentReason: z.string().trim().min(1) })
  .partial()
  .refine((v) => (v.adjustedDurationMinutes === undefined) === (v.adjustmentReason === undefined), "adjusted duration and reason go together");

export const POST = withAuth(async (request, context) => {
  const id = await idFromContext(context);
  const body = request.headers.get("content-length") === "0" || request.headers.get("content-type") === null ? {} : await parseBody(request, stopSchema);
  const adjustment = body.adjustedDurationMinutes !== undefined && body.adjustmentReason !== undefined ? { adjustedDurationMinutes: body.adjustedDurationMinutes, adjustmentReason: body.adjustmentReason } : undefined;
  return Response.json(await stopWorkSession(getPrisma(), id, new Date(), adjustment));
});
