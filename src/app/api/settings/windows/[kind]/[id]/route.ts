import { z } from "zod";
import { withAuth } from "@/app/api/helpers";
import { WINDOW_KINDS, type WindowKind } from "@/core/domain/scheduler-schemas";
import { deleteWindow, updateWindow } from "@/core/domain/scheduler-settings";
import { getPrisma } from "@/db/client";

const windowKindSchema = z.enum(WINDOW_KINDS as [WindowKind, ...WindowKind[]]);

export const PATCH = withAuth(async (request, context) => {
  const { kind, id } = await context.params;
  const windowKind = windowKindSchema.parse(kind);
  const patch = await request.json().catch(() => ({}));
  return Response.json(await updateWindow(getPrisma(), windowKind, z.uuid().parse(id), patch));
});

export const DELETE = withAuth(async (_request, context) => {
  const { kind, id } = await context.params;
  const windowKind = windowKindSchema.parse(kind);
  await deleteWindow(getPrisma(), windowKind, z.uuid().parse(id));
  return Response.json({ ok: true });
});
