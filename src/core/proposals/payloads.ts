/**
 * Operation payload contracts for the Phase 1 entity types. `after` carries
 * the same DTO shapes the manual API uses (ISO strings for temporal values),
 * so one validation surface covers manual edits, extraction Proposals, and
 * undo. Delete operations carry no payload except the person-alias deletion
 * manifest an undo needs.
 */
import { z, type ZodType } from "zod";
import type { EntityType, OperationType } from "@/core/domain/enums";
import {
  eventCreateSchema,
  eventUpdateSchema,
  noteCreateSchema,
  noteUpdateSchema,
  personCreateSchema,
  personUpdateSchema,
  projectCreateSchema,
  projectUpdateSchema,
  taskCreateSchema,
  taskUpdateSchema,
} from "@/core/domain/schemas";

const createSchemas: Record<EntityType, ZodType> = {
  task: taskCreateSchema,
  event: eventCreateSchema,
  note: noteCreateSchema,
  person: personCreateSchema,
  project: projectCreateSchema,
};

const nonEmpty = (schema: ZodType) =>
  schema.refine(
    (patch) => typeof patch === "object" && patch !== null && Object.keys(patch).length > 0,
    "update patch must change at least one field",
  );

const updateSchemas: Record<EntityType, ZodType> = {
  task: nonEmpty(taskUpdateSchema),
  event: nonEmpty(eventUpdateSchema),
  note: nonEmpty(noteUpdateSchema),
  person: nonEmpty(personUpdateSchema),
  project: nonEmpty(projectUpdateSchema),
};

/**
 * What an undo-delete expects to find and remove alongside the row: the
 * person aliases or task/event people-links created by the original create. Any
 * extra row is an acquired dependent and blocks the delete.
 */
export const deleteManifestSchema = z
  .object({
    aliases: z.array(z.string()).default([]),
    peopleIds: z.array(z.string()).default([]),
  })
  .optional();

export function parseOperationPayload(
  op: OperationType,
  entityType: EntityType,
  after: unknown,
): unknown {
  switch (op) {
    case "create":
      return createSchemas[entityType].parse(after);
    case "update":
      return updateSchemas[entityType].parse(after);
    case "delete":
      return deleteManifestSchema.parse(after ?? undefined);
    case "archive":
    case "restore":
      if (after !== null && after !== undefined) {
        throw new z.ZodError([
          { code: "custom", message: `${op} operations carry no payload`, path: [], input: after },
        ]);
      }
      return undefined;
  }
}

// --- Row-snapshot → DTO conversion (for undo-of-update patches) ------------

const DATE_KEYS: Partial<Record<EntityType, Set<string>>> = {
  task: new Set(["deadlineDate", "nudgeDate", "earliestStartDate"]),
  event: new Set(["allDayStartDate", "allDayEndDate"]),
};
const TIME_KEYS: Partial<Record<EntityType, Set<string>>> = {
  task: new Set(["preferredWindowStartTime", "preferredWindowEndTime"]),
};

/**
 * Converts one field value from a JSON row snapshot back to the DTO form the
 * update schemas expect: DATE columns to "YYYY-MM-DD", TIME columns to
 * "HH:MM"; instants and scalars pass through.
 */
export function snapshotValueToDto(
  entityType: EntityType,
  key: string,
  value: unknown,
): unknown {
  if (value === null || value === undefined) return null;
  if (DATE_KEYS[entityType]?.has(key)) return String(value).slice(0, 10);
  if (TIME_KEYS[entityType]?.has(key)) return String(value).slice(11, 16);
  return value;
}
