import { parseBody, withAuth } from "@/app/api/helpers";
import { updateSettingsDirect } from "@/core/domain/mutations";
import { settingsUpdateSchema } from "@/core/domain/schemas";
import { getPrisma } from "@/db/client";

export const PATCH = withAuth(async (request) => {
  const { currentTimezone } = await parseBody(request, settingsUpdateSchema);
  return Response.json(await updateSettingsDirect(getPrisma(), currentTimezone));
});
