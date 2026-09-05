import { idFromContext, withAuth } from "@/app/api/helpers";
import { discardCapture } from "@/core/captures/review";
import { getPrisma } from "@/db/client";

export const POST = withAuth(async (_request, context) => {
  const captureId = await idFromContext(context);
  return Response.json(await discardCapture(getPrisma(), captureId));
});
