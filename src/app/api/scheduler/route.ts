import { DateTime } from "luxon";
import { z } from "zod";
import { parseBody, withAuth } from "@/app/api/helpers";
import { ProposalValidationError } from "@/core/proposals/errors";
import { planDay, planWeek, rescheduleDay, rollOver } from "@/core/scheduler/operations";
import { getPrisma } from "@/db/client";

const requestSchema = z.object({
  operation: z.enum(["plan_day", "plan_week", "reschedule_day", "roll_over"]),
  date: z.iso.date(),
  /** roll_over: the day whose unfinished blocks move into `date`. */
  from: z.iso.date().optional(),
  idempotencyKey: z.string().min(1).max(200).optional(),
  allowProtectedOverride: z.boolean().optional(),
});

/** Scheduler operations return Proposals (spec §7.1 item 4); nothing is applied here. */
export const POST = withAuth(async (request) => {
  const input = await parseBody(request, requestSchema);
  const db = getPrisma();
  const options = { now: DateTime.now(), idempotencyKey: input.idempotencyKey, allowProtectedOverride: input.allowProtectedOverride };
  try {
    const run =
      input.operation === "plan_day"
        ? await planDay(db, input.date, options)
        : input.operation === "plan_week"
          ? await planWeek(db, input.date, options)
          : input.operation === "reschedule_day"
            ? await rescheduleDay(db, input.date, options)
            : await rollOver(db, { from: input.from ?? input.date, into: input.date }, options);
    return Response.json(run);
  } catch (error) {
    if (error instanceof ProposalValidationError) return Response.json({ error: error.message, problems: error.problems }, { status: 422 });
    throw error;
  }
});
