/**
 * The §14.1 extraction contract, schema version 1. Zod proves only shape;
 * trusted application code additionally validates enums/invariants against
 * the data model, resolves references and dates, and checks evidence bounds
 * (Step 11). Everything here is untrusted candidate data.
 */
import { z } from "zod";

export const EXTRACTION_SCHEMA_VERSION = "1";

const evidenceSchema = z
  .object({
    start: z.number().int().min(0),
    end: z.number().int().min(0),
  })
  .refine((e) => e.end >= e.start, "evidence end must not precede start");

const confidenceSchema = z.enum(["high", "medium", "needs_confirmation"]);

const temporalExpressionSchema = z.object({
  field: z.string().min(1),
  literal: z.string().min(1),
  relation: z.enum(["on", "before", "after", "within", "duration_after"]),
  anchor_entity_id: z.uuid().nullable(),
  evidence: evidenceSchema,
  confidence: confidenceSchema,
});

const entityReferenceSchema = z.object({
  field: z.string().min(1),
  candidate_ids: z.array(z.uuid()),
  unresolved_literal: z.string().nullable(),
  evidence: evidenceSchema,
  confidence: confidenceSchema,
});

const fieldEvidenceSchema = z.object({
  field: z.string().min(1),
  evidence: evidenceSchema,
  confidence: confidenceSchema,
});

const extractionItemSchema = z.object({
  item_ref: z.string().min(1),
  depends_on_item_refs: z.array(z.string()),
  entity_type: z.enum(["task", "event", "note", "person", "project"]),
  fields: z.record(z.string(), z.unknown()),
  temporal_expressions: z.array(temporalExpressionSchema),
  entity_references: z.array(entityReferenceSchema),
  field_evidence: z.array(fieldEvidenceSchema),
});

export const extractionResultSchema = z
  .object({
    schema_version: z.literal(EXTRACTION_SCHEMA_VERSION),
    prompt_version: z.string().min(1),
    items: z.array(extractionItemSchema),
  })
  .superRefine((result, ctx) => {
    const refs = new Set<string>();
    for (const item of result.items) {
      if (refs.has(item.item_ref)) {
        ctx.addIssue({ code: "custom", message: `duplicate item_ref ${item.item_ref}` });
      }
      refs.add(item.item_ref);
    }
    for (const item of result.items) {
      for (const dep of item.depends_on_item_refs) {
        if (!refs.has(dep)) {
          ctx.addIssue({
            code: "custom",
            message: `item ${item.item_ref} depends on unknown item_ref ${dep}`,
          });
        }
        if (dep === item.item_ref) {
          ctx.addIssue({ code: "custom", message: `item ${item.item_ref} depends on itself` });
        }
      }
    }
  });

export type ExtractionResult = z.infer<typeof extractionResultSchema>;
export type ExtractionItem = ExtractionResult["items"][number];
