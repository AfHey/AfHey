import { idFromContext, withAuth } from "@/app/api/helpers";
import { processCaptureNoAi } from "@/core/captures/service";
import { getPrisma } from "@/db/client";

export const POST = withAuth(async (_request, context) => {
  const captureId = await idFromContext(context);
  return Response.json(await processCaptureNoAi(getPrisma(), captureId));
});
