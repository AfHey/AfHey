import { parseBody, withAuth } from "@/app/api/helpers";
import { schedulerPreferencesPatchSchema } from "@/core/domain/scheduler-schemas";
import { updateSchedulerPreferences } from "@/core/domain/scheduler-settings";
import { getPrisma } from "@/db/client";

/** Scheduler knobs (spec §7.1): a direct settings edit, revision-guarded, no Proposal. */
export const PATCH = withAuth(async (request) => {
  const patch = await parseBody(request, schedulerPreferencesPatchSchema);
  return Response.json(await updateSchedulerPreferences(getPrisma(), patch));
});
