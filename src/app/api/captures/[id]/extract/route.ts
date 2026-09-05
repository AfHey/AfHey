import { z } from "zod";
import { getExtractionProvider } from "@/ai/adapters/registry";
import { idFromContext, parseBody, withAuth } from "@/app/api/helpers";
import { checkRateLimit, clientKey, combineRateLimits } from "@/core/auth/rate-limit";
import { extractCapture } from "@/core/captures/review";
import { getPrisma } from "@/db/client";

const schema = z.object({ editedPayloadText: z.string().max(20_000).optional() });

// AI endpoint rate limit (spec §10.9, §14): generous for one person, hard
// stop for a runaway client. The per-user budget is address-independent
// (finding 15).
const EXTRACTIONS_PER_MINUTE = 20;

export const POST = withAuth(async (request, context, session) => {
  const rate = combineRateLimits(
    checkRateLimit(clientKey(request, "extract"), EXTRACTIONS_PER_MINUTE, 60_000),
    checkRateLimit(`extract:user:${session.user.id}`, EXTRACTIONS_PER_MINUTE, 60_000),
  );
  if (!rate.allowed) {
    return Response.json(
      { error: "Too many extractions; try again shortly" },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } },
    );
  }
  const captureId = await idFromContext(context);
  const { editedPayloadText } = await parseBody(request, schema);
  const outcome = await extractCapture(getPrisma(), captureId, getExtractionProvider(), editedPayloadText);
  return Response.json(outcome);
});
