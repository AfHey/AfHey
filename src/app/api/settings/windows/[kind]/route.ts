import { z, type ZodType } from "zod";
import { parseBody, withAuth } from "@/app/api/helpers";
import {
  availabilityWindowSchema,
  preferredWindowSchema,
  protectedWindowSchema,
  WINDOW_KINDS,
  type WindowKind,
} from "@/core/domain/scheduler-schemas";
import { createWindow } from "@/core/domain/scheduler-settings";
import { getPrisma } from "@/db/client";

export const windowKindSchema = z.enum(WINDOW_KINDS as [WindowKind, ...WindowKind[]]);

const CREATE_SCHEMAS: Record<WindowKind, ZodType> = {
  availability: availabilityWindowSchema,
  protected: protectedWindowSchema,
  preferred: preferredWindowSchema,
};

/** Creates one scheduler window of the kind named in the path. */
export const POST = withAuth(async (request, context) => {
  const { kind } = await context.params;
  const windowKind = windowKindSchema.parse(kind);
  const input = await parseBody(request, CREATE_SCHEMAS[windowKind]);
  return Response.json(await createWindow(getPrisma(), windowKind, input as never), { status: 201 });
});
