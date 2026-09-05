-- Retention scrub (finding 8; decisions.md 2026-09-05 "Source wording never
-- outlives capture retention"). Earlier code copied source phrases into
-- permanent places: FieldEvidence.resolver_meta (temporal `literal`,
-- reference `unresolvedLiteral`) and the warning segments appended to
-- ProposalOperation.reason, which ActionLog snapshots then carried. This
-- one-off, product-owner-approved data migration removes those copies; new
-- code writes text-free metadata and reasons. Domain data (titles, bodies)
-- is untouched: extracted items are records, not raw capture.

UPDATE "field_evidence"
SET "resolver_meta" = ("resolver_meta" - 'literal') - 'unresolvedLiteral'
WHERE "resolver_meta" IS NOT NULL
  AND ("resolver_meta" ? 'literal' OR "resolver_meta" ? 'unresolvedLiteral');

UPDATE "proposal_operation"
SET "reason" = split_part("reason", ' · ', 1)
WHERE "reason" LIKE '% · %';

UPDATE "action_log" a
SET "operations" = (
  SELECT jsonb_agg(
    CASE
      WHEN jsonb_typeof(elem -> 'reason') = 'string' AND (elem ->> 'reason') LIKE '% · %'
        THEN jsonb_set(elem, '{reason}', to_jsonb(split_part(elem ->> 'reason', ' · ', 1)))
      ELSE elem
    END
    ORDER BY ord
  )
  FROM jsonb_array_elements(a."operations") WITH ORDINALITY AS t(elem, ord)
)
WHERE jsonb_typeof(a."operations") = 'array'
  AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(a."operations") e WHERE (e ->> 'reason') LIKE '% · %'
  );
