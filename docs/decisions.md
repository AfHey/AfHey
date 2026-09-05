# Decision Log

Format: date, decision, alternatives rejected, reason. Newest at the bottom.

## 2026-08-30 Tooling
- Decision: Build with Claude Code (repository owner). Independent review by a second model at phase milestones.
- Installed: claude-code-setup, frontend-design, context7 (official plugins); Playwright MCP; GitHub via `gh` CLI.
- Rejected: GitHub MCP plugin (authentication failed; `gh` CLI covers the need).

## 2026-08-30 Scope
- Decision: AfHey (conversational control layer) is part of V1 architecture; text chat in Phase 3, voice in Phase 4. `[Superseded by decisions.md entry: 2026-08-30 Release boundaries and phase ownership]` Text is specifically Phase 3b/V1 and voice is Phase 4/V1.1.
- Decision: `waiting_for` is a first-class item type from Phase 1; automatic detection deferred to Phase 5. `[Superseded by decisions.md entry: 2026-08-30 Task kinds]`
- Decision: One unified Proposal model for Inbox, scheduler, and AfHey actions.

## 2026-08-30 Voice
- Decision: Voice layer will target the documented OpenAI Realtime API model current at Phase 4 (gpt-realtime-2.1 as of today). GPT-Live is not assumed to be API-available. `[Superseded by decisions.md entry: 2026-08-30 Voice and provider boundaries]` No exact Phase 4 model ID is frozen before that phase.

## Pending
- Calendar rendering library — decide before Phase 2
- Exact Phase 3b text-reasoning model — decide before Phase 3b
- Hosting and backups — decide before Phase 1 deployment
- Tier 2 scope thresholds — decide before Phase 3a

## 2026-08-30 Release boundaries and phase ownership
- Decision: V1 ends after Phase 3b (AfHey text); Phase 4 voice is V1.1; Phases 5 and 6 are V2. Basic search belongs to Phase 2. Command palette, keyboard shortcuts, export, and erasure belong to Phase 3b. Weekly review belongs to Phase 5. Day view is Phase 2; week and month views are Phase 5 unless a later decision promotes them. *(Same-day cross-review amendment: the calendar-view sentence was already cited by product-spec §5 but had been omitted here.)*
- Rejected: treating Phases 4–6 as undifferentiated V1, or leaving cross-cutting requirements without a build phase.
- Reason: gives every requirement an owner and prevents integrations, ambient voice, and offline work from blocking a useful text-first V1.

## 2026-08-30 Capture, offline, and multimodal scope
- Decision: Phase 1 Inbox is online text only: typed, pasted, or text supplied by non-sensitive device/browser dictation. Images/screenshots, uploaded audio, PWA share target, offline queue/cache, and other multimodal input are Phase 5 (V2).
- Rejected: Phase 1 screenshot/PWA sharing and offline capture.
- Reason: removes contradictory scope and avoids designing additional raw-data stores before the core privacy and Proposal flow is proven.

## 2026-08-30 Voice and provider boundaries
- Decision: Phase 1 uses iPhone keyboard microphone or browser Speech API only for non-sensitive dictation; AfHey stores no audio and uses no external transcription API. Realtime conversational voice is Phase 4 (V1.1) using OpenAI behind `VoiceRealtimeProvider`. Server mediation is required for extraction/reasoning; browser/realtime client transport may use only short-lived, scoped server-issued credentials.
- Rejected: external Phase 1 transcription, treating voice memo dictation and realtime AfHey voice as one feature, and claiming transcript redaction protects audio already sent to a provider.
- Reason: makes the privacy boundary and client/server exception explicit.

## 2026-08-30 Task kinds
- Decision: `waiting_for` and `reminder` are Task kinds in `task_kind: action | waiting_for | reminder`, not separate tables. Waiting-for requires a Person; reminder requires a reminder instant/zone. Automatic waiting-for detection is Phase 5; notification delivery is Phase 6.
- Rejected: separate Reminder/WaitingFor tables and the ambiguous “first-class type or task state.”
- Reason: one lifecycle and query model is sufficient while preserving distinct invariants.

## 2026-08-30 Authoritative Phase 1 data model
- Decision: use the explicit enums, nullability, relationships, and invariants in product-spec Section 9. All mutable domain entities use opaque UUIDs and integer revisions. Task/Event people use join tables; Capture→Proposal is one-to-many; source text is held only in Capture with field evidence spans. WorkSession is the source of truth for actual duration. `Project` is one hierarchy table with `kind: area | project` and one area→project level in V1.
- Rejected: conceptual “might contain” schemas, array-valued people fields, duplicated Task `source_text`, Capture `proposal_id`, cached Task actual duration, and ambiguous Area/Project models.
- Reason: Prisma migrations and Proposal concurrency require one enforceable schema.

## 2026-08-30 Scheduled blocks and task timing
- Decision: scheduled work is Event `kind = block` with required `task_id`; one Task may have many blocks. Planned work dates are derived from blocks and `do_date` is not stored. `schedule_type = fixed` is an intrinsic commitment; `is_locked` is only a user pin on a flexible Event. A passed block without an outcome becomes `missed_unconfirmed`, which does not assert user failure.
- Rejected: canonical Task `do_date`, conflating fixed with locked, and automatically treating elapsed blocks as missed work.
- Reason: supports split work without drift or destructive scheduler assumptions.

## 2026-08-30 Timezone and DST semantics
- Decision: `UserSettings.current_timezone` is an IANA zone defaulting to `America/New_York`. Flexible preferences follow the current zone while travelling; fixed Events retain their stored zone and instant. Date-only values remain calendar dates; timed values store UTC instants plus a separate IANA zone; all-day Events store local dates plus zone. Nonexistent and duplicated DST times require confirmation under product-spec Section 8.1.
- Rejected: midnight-UTC dates, UTC instants without original zones, silent DST shifts, and making all preferences fixed to the home zone.
- Reason: each temporal concept now has one deterministic storage and travel rule.

## 2026-08-30 Scheduling estimates, constraints, and priorities
- Decision: feasibility and scheduling use explicit `remaining_estimate_minutes`; elapsed work is never subtracted to infer remaining work. Tasks without an estimate remain unscheduled and request confirmation. Hard-unavailable windows are distinct from soft preferences; working hours are configurable data. Store manual `user_priority` separately from required 0–100 `computed_priority_score` (default 50); manual wins, otherwise 70+ is Must, 40–69 Should, and below 40 Could.
- Rejected: invented durations, `estimate - actual` remaining work, hard-coded 07:00–15:30 logic, treating all time outside working hours as invalid, and allowing AI recomputation to overwrite a manual priority.
- Reason: scheduling remains deterministic without pretending uncertain inputs are facts.

## 2026-08-30 Proposal concurrency, execution, and undo
- Decision: Proposals and operations use revisions, unique idempotency keys, operation IDs, preallocated create UUIDs, explicit sequence/dependencies, expanded terminal states, and final-set tier recomputation for tiered policy. Apply rechecks revisions and commits internal mutations plus ActionLog atomically. Undo is a new conflict-detecting Proposal referencing the original Action; unsafe batch undo applies nothing. Phase 1 Inbox uses explicit approval with no tier engine. Origins share a model/review primitives but may use different presentations.
- Rejected: unordered operations, nullable create IDs, trusted stored tiers, five-state Proposals, blind inverse replay, automatic Phase 1 Inbox execution, and a mandatory single Proposal UI component.
- Reason: prevents retry duplication, stale overwrites, partial batches, and destruction of later work.

## 2026-08-30 External action execution deferral
- Decision: the external-action execution model is deferred to Phase 5 (review item 7); no external side effect is implemented in V1.
- Rejected: designing that model during Phase 1.
- Reason: explicit product-owner deferral keeps V1 internal.

## 2026-08-30 Extraction provider, contract, and evaluation
- Decision: OpenAI is the Phase 1 extraction provider. Use pinned snapshot `gpt-5.4-mini-2026-03-17` through the Responses API with JSON-schema Structured Outputs behind `ExtractionProvider`; it must pass the versioned extraction evaluation before use. The [official model page](https://developers.openai.com/api/docs/models/gpt-5.4-mini) records that snapshot and Structured Outputs support. Provider output uses response-local item references, stable-ID candidates/unresolved entities, literal temporal expressions, and per-field evidence/confidence; trusted code preallocates final entity/operation UUIDs while building the Proposal. Deterministic code resolves dates and validates business invariants. One call is a target with at most two bounded retries. Phase 3b text reasoning also uses OpenAI, with its exact pinned model chosen before that phase.
- Rejected: free-text project/person references, authoritative LLM datetimes, exact whole-output online regression tests, an absolute one-call invariant, unpinned Phase 1 model choice, and provider SDK calls outside adapters.
- Reason: provides a concrete Phase 1 dependency while preserving replaceable business boundaries and measurable quality.

## 2026-08-30 IDs and conversational references
- Decision: database/tool IDs are full opaque UUIDs. Short labels are presentation-only handles persisted in per-turn reference sets and resolved to UUIDs against the exact referenced Message/turn.
- Rejected: globally short database IDs and one mutable “last returned list.”
- Reason: prevents collisions and cross-tab/long-conversation reference errors.

## 2026-08-30 Privacy and untrusted content
- Decision: all provider-bound context is guarded immediately before transmission; records can be `ai_excluded`; user edits trigger a fresh full-payload guard. People/glossary entries are not redaction whitelists. The guard is a last-resort leakage detector, not de-identification or a HIPAA boundary. Pasted/retrieved/tool content is untrusted data and cannot authorize actions.
- Rejected: guarding only new captures, trusting known names, treating redaction as reliable de-identification, and allowing edited redactions or embedded instructions to bypass policy.
- Reason: the non-PHI policy remains primary and every provider path has the same enforceable boundary.

## 2026-08-30 Storage security and retention
- Decision: V1 uses hosting-provider disk/database encryption only; no application-managed field-level keys. Raw Capture text is deleted 30 days after processing and is not copied into domain rows or logs. Expanded encryption/key design is deferred to the Phase 5 security review (review item 43).
- Rejected: claiming unspecified raw-capture encryption or designing a key hierarchy before the host and V2 sensitive-data scope exist.
- Reason: matches the product-owner risk decision while making retention enforceable.

## 2026-08-30 Authentication, export, erasure, and deletion
- Decision: provision one user with no registration; password or passkey, secure server sessions/cookies, CSRF defense, rotation/revocation, and auth/AI rate limits. V1 export/erasure covers domain data, archives, retained Captures, Proposals/ActionLogs, Conversations/Messages, references, and settings. Project removal is archive/soft-delete; hard delete is rejected while dependents/audit references exist. Backup retention is disclosed after hosting selection.
- Rejected: undefined “simple auth,” hard-cascade project deletion, and exports/erasure that silently omit audit or conversation data.
- Reason: single-user does not remove internet-hosting security or data-portability obligations.

## 2026-08-30 Libraries and tests
- Decision: Luxon for dates; Zod at LLM boundaries; Vitest for unit/integration tests; Playwright for end-to-end tests. Calendar rendering library remains a Phase 2 decision.
- Rejected: leaving the date/test stack for implementation to invent and prematurely selecting a calendar UI library.
- Reason: Phase 1 dependencies are fixed while a Phase 2-only choice remains appropriately gated.

## 2026-08-30 Specification history and fixtures
- Decision: replaced requirements remain in place with `[Superseded by decisions.md entry: ...]`; deferrals include phase/reason. Specification examples are illustrative only and cannot be copied into seed/evaluation/test data, which must be wholly fictional and non-sensitive.
- Rejected: deleting history, leaving contradictory requirements simultaneously active, and reusing recognizable names/institutions/study labels in fixtures.
- Reason: preserves auditability without confusing the implementer or risking sensitive sample data.

## 2026-08-30 Cross-review: Proposal lifecycle and origins
- Decision: `applying` is only the approval-to-commit window; crash recovery resolves it via the idempotency key (ActionLog row present → `applied`, absent → `failed`, re-approvable). Every Phase 1 Proposal — Inbox extraction and batch undo — uses `approval_policy = explicit`. `origin = user` denotes user-initiated Proposal flows (undo now, batch operations later); ordinary manual single-entity edits mutate directly with revision increments and no Proposal/ActionLog row in V1. Phase 1 operation `entity_type` values are `task | event | note | person | project`. Overlap validation rejects scheduler-placed blocks colliding with fixed Events or other blocks, while user-approved fixed-with-fixed double-booking is a warning only. The sole V1 hard-delete path is conflict-aware undo of a create without dependent rows; ActionLog snapshots reference entities by UUID value without foreign keys and therefore never block that deletion.
- Rejected: an undefined resting `applying` state, tiered approval anywhere in Phase 1, routing every manual edit through Proposals, treating all calendar overlaps as validation failures, and audit references that would make undo-of-create permanently impossible.
- Reason: removes the ambiguities that blocked an enforceable Phase 1 Prisma schema and Proposal engine (undo previously contradicted the "audit reference blocks hard delete" rule).

## 2026-08-30 Cross-review: Capture text retention and evidence
- Decision: `Capture.redacted_text` stores the exact final guarded payload transmitted to the provider (entity placeholders included); FieldEvidence offsets index into it. When `raw_delete_after` passes, one expiry job nulls `raw_text`, `redacted_text`, and all related `FieldEvidence.literal_text`; rows persist and the UI shows "source expired." Extends the 2026-08-30 "Storage security and retention" entry.
- Rejected: retaining redacted text or evidence literals indefinitely after the raw source expires, and defining evidence offsets against text other than the transmitted payload.
- Reason: the guard is a last-resort detector, so imperfectly redacted text and literal fragments inherit the same 30-day retention; evidence rows stay auditable in shape without retaining content.

## 2026-08-30 Cross-review: Phase 1 schema boundary, auth tables, and Event kinds
- Decision: Phase 1 migrations create exactly the tables in product-spec Section 9 "Phase 1 migration boundary," including `Credential` (`password | passkey`) and database-backed `Session` rows; scheduler-constraint child tables are Phase 2; Conversation, Message, TurnReferenceSet, and `Proposal.conversation_id` are Phase 3b. Phase 1 ships minimal settings covering `current_timezone` and glossary CRUD. Event `kind` drops the undefined `deadline` value (externally imposed dates are Task `deadline_*`; calendar deadline display is derived at render time). Extraction never proposes `kind = block` Events; blocks first exist in Phase 2, so Phase 1 stores none. Completing a task completes its current block and cancels later planned blocks. Deterministic `computed_priority_score` recomputation ships with Phase 2. `find_free_time` is removed from the composed-operation list as a duplicate of the read-only primitive `get_free_time`, which returns data rather than a Proposal.
- Rejected: creating all future tables in Phase 1, a Phase 1 foreign key to a non-existent Conversation table, stateless-only sessions and an undefined "credential reference," an Event `deadline` kind with no semantics, Phase 1 block Events, and a Proposal-returning free-time operation.
- Reason: a Prisma schema needs an exact per-phase table set, and each removed item was contradictory or undefined rather than genuinely deferred.

## 2026-08-30 Capture rejected status
- Decision: product owner adds `rejected` to `Capture.processing_status`, now `received | redacted | proposed | processed | rejected | failed | no_ai`. `rejected` is a terminal user resolution: the user declines the Capture at the redaction preview or rejects its extraction review without requesting re-extraction. No items are created from a rejected Capture, and it is distinct from technical `failed`. Rejection sets `raw_delete_after` to 30 days after the rejection; the standard expiry job then nulls raw/redacted text and evidence literals while the rows persist for links and audit.
- Rejected: reusing `failed` for user declines (conflates technical failure with user choice); hard-deleting declined Captures immediately (breaks the uniform retention and audit-linkage rules); a separate dismissal flag or table beside `processing_status`.
- Reason: the mandatory-review Inbox needs an explicit, queryable terminal outcome for "user said no," distinct from failure, with the same enforceable 30-day retention as other resolutions.

## 2026-08-30 Password-first Phase 1 authentication
- Decision: Phase 1 implements password login only (argon2id hash in a `kind = password` Credential). The `passkey` Credential kind remains in the schema, unused, so adding passkeys later needs no migration. Provisioning is a script (`npm run provision`) that creates the single User/Credential/UserSettings; re-running it replaces the password (the reset path). Sessions are 30-day database rows with hashed tokens, per-session revocation, and version-based bulk invalidation; CSRF defense is same-origin verification (Origin / Sec-Fetch-Site) on all mutations over SameSite=Lax cookies; login is rate limited. Approved by the product owner with plan approval.
- Rejected: implementing WebAuthn/passkey ceremonies in Phase 1 (scope without Phase 1 benefit for one user) and a registration flow.
- Reason: spec §10.9 requires "password or passkey"; password satisfies it with the least Phase 1 surface while the schema keeps the passkey door open.

## 2026-09-05 Evidence spans are re-anchored from quoted text
- Decision: the extraction contract's `field_evidence` entries carry a nullable `quote` (exact source substring); temporal literals and placeholder references already carry their text. Trusted adapter code deterministically snaps every such span to the nearest occurrence of its text in the transmitted payload before validation. Provider offsets remain untrusted input, never authoritative. Prompt version bumped to `p2-2026-09-05`; `schema_version` stays `1` because the change is additive.
- Rejected: trusting model-computed character offsets (the first evaluation run showed 88.6% in-bounds spans and 27.6% literal alignment with substance otherwise excellent); dropping evidence spans; a schema_version bump for an optional field.
- Reason: models quote text reliably and count characters badly; anchoring offsets from quotes keeps field-level evidence trustworthy without changing what the model is asked to understand.

## 2026-09-05 Extraction evaluation eval-v1 result and live-extraction gate
- Decision: evaluation `eval-v1` against `gpt-5.4-mini-2026-03-17` with prompt `p2-2026-09-05` passed every acceptance check (item precision/recall 100%, task/event kind 100%, temporal literal recall 100%, reference recall 100%, evidence validity 100%, 0 hallucinated ids; report `docs/evals/eval-v1-p2-2026-09-05-openai.md`). The gate is therefore satisfied, but live extraction (`EXTRACTION_PROVIDER=openai`) is switched on only by the product owner's explicit instruction; the default stays the deterministic fake provider. The dataset must grow with realistic (fictional) captures before the numbers are treated as representative — 33 cases authored alongside the prompt is a floor, not proof.
- Rejected: enabling live extraction automatically on a passing run; treating a single 33-case pass as sufficient evidence of real-world quality.
- Reason: keeps the human decision the spec requires for provider use while recording the measured result.

## 2026-09-05 Temporal cues always travel as temporal fields (finding A)
- Decision: prompt `p3-2026-09-05` forbids temporal cues in title/context/description/notes, repeats a shared cue on every item it governs, and defines `context` as situational only. Trusted code additionally recovers a recognizable date phrase left in an item's own text as a `medium`-confidence temporal expression anchored to its payload occurrence, clearing a `context` that consisted only of that phrase. Enum fields the model fills with free text are dropped, never stored. A live-provider test path (`npm run test:live`) exercises the pinned model end to end; it is not part of `npm test` or CI.
- Rejected: relying on the prompt alone (the first live use showed the model can slip); making the deterministic fake mimic every model failure.
- Reason: a missing due date on a captured task is a silent data loss the review flow may not catch; the salvage is deterministic parsing, not interpretation, and only fires on phrases it can locate in the source.

## 2026-09-05 End-to-end tests run only against the test database (finding C)
- Decision: Playwright's global setup rebuilds `afhey_test` (schema, migrations, provisioned user, fictional seed) and the dev server it boots is bound to `TEST_DATABASE_URL`; the config refuses any database not named `*_test` and never reuses an already-running server. CI uses a single test database. The E2E rows that earlier runs had written into `afhey_dev` were removed in one verified transaction (18 captures, 17 proposals, 17 tasks, 9 notes, 27 projects/areas; the one real capture was kept).
- Rejected: continuing to run e2e against the working database with stamped names; a separate third database.
- Reason: a test suite must never write into the owner's real data; `afhey_test` already carries the disposable contract.

## 2026-09-05 Source wording never outlives capture retention (finding 8)
- Decision: everything derived from a capture that must persist past the 30-day window is text-free. FieldEvidence.resolver_meta holds only relation, resolution kind/values, and candidate ids; resolver reasons and pipeline warnings (which ride on operation reasons and into ActionLog snapshots) describe the problem without quoting the phrase; the evidence chip — backed by the expiring `literal_text` — is where the phrase is shown. A one-off, product-owner-approved data migration (`20260905030636_retention_scrub`) removed the copies earlier code had written. Extracted domain records (titles, bodies) are not capture text and are unaffected.
- Rejected: extending the expiry job to scrub free-text reasons and metadata forever (fragile, and audit records must not be edited); leaving existing copies in place.
- Reason: the guard is a last-resort detector, so any fragment that slipped through must fall under the same retention as the raw text.

## 2026-09-05 Provider references and evidence are validated against what was transmitted (findings 16, 17)
- Decision: interpretation receives the exact candidate map that was sent. A reference is kept only if every id was offered for that field's entity type; an ambiguous placeholder the provider narrowed is widened back to its full candidate set with `needs_confirmation`; anchors never offered are dropped. A temporal phrase whose span does not contain the phrase is discarded (no authoritative date from it); zero-length field evidence is discarded; an unlocatable quote collapses its span to zero length rather than keeping stale offsets; a source-derived title without evidence marks the item `needs_confirmation`. Review edits carry evidence only for fields whose value the edit left unchanged.
- Rejected: trusting database existence as authorization for a reference; treating in-bounds offsets as justification; copying evidence onto user-edited values.
- Reason: the model may only choose among what trusted code offered (spec §14.1), and evidence must justify the specific field it is attached to.

## 2026-09-05 Temporal resolver hardening (findings 10-13)
- Decision: (10) DST gaps and folds are detected by enumerating the zone's real offsets around the requested wall time, so any transition size is handled (Lord Howe's 30 minutes included). (11) An IANA zone written in the phrase resolves the wall time in that zone and is preserved on the result; an explicit offset (`UTC−05:00`, `-05:00`) selects the matching fold occurrence and is rejected with a confirmation request when it matches none. (12) Minute/hour durations keep sub-day precision (including `within`), day/week durations use wall-clock calendar arithmetic, and a duration relative to a named anchor resolves only against a validated anchor — otherwise it requests confirmation and is never computed from now. (13) Day and time components are parsed as absent, valid, or invalid; any invalid component blocks authoritative resolution with a confirmation request.
- Rejected: fixed one-hour fold detection; ignoring zone text; treating all durations as elapsed minutes; letting an invalid component fall back to "absent".
- Reason: each rejected shortcut produced a confidently wrong date in the review's reproductions; the spec forbids silent strong assumptions.

## 2026-09-05 Event ends, ranges, and deadline firmness (findings 20, 21)
- Decision: a range inside an event's start phrase ("Sept 12–14", "9am–11am", "September 12 through September 14") is resolved as one range; a separate end phrase resolves relative to the start's day; an explicit end that cannot be used (missing, before the start) is never replaced silently — the end is set provisionally to one hour after the start and the item is flagged `needs_confirmation`. Multi-day all-day events keep their explicit last day (stored as an exclusive end). Deadline firmness comes from the new provider field `deadline_type` (hard | soft | null; prompt `p4-2026-09-05`), else from explicit wording ("hard deadline", "no later than", "at the latest", "final deadline"), else defaults to `soft`.
- Rejected: inventing a one-hour end when the text gave one; collapsing ranges to a single day; treating every extracted deadline as soft.
- Reason: an end or a firmness the user wrote is data the review must preserve; a default is only acceptable where the text is silent, and even then it is labeled.

## 2026-09-05 Capture processing claim (finding 2)
- Decision: Capture gains `processing_claim_key` (unique, nullable) and `processing_claimed_at`. An extraction attempt claims the capture with a compare-and-swap before anything is transmitted and releases it with the final transition (`proposed`, `failed`, or nothing-actionable → `redacted`). No-AI processing and rejection are compare-and-swaps that refuse while a claim is held; two concurrent no-AI requests yield exactly one Note. Applying a proposal whose capture is no longer `proposed`/`redacted` conflicts instead of creating items for a capture the user resolved otherwise. A claim older than ten minutes is treated as abandoned and may be taken over.
- Rejected: read-then-write eligibility checks; an advisory lock held across the provider call; letting a late no-AI silently win after transmission.
- Reason: the review reproduced duplicate extraction and no-AI violations from the unguarded window; a persisted claim makes the outcome deterministic and visible.

## 2026-09-05 Apply recovery runs under an execution lease (finding 3)
- Decision: the CAS into `applying` stamps the row; recovery resolves only `applying` rows older than a two-minute lease (an apply transaction completes within seconds), reconciling against ActionLog → `applied`, else `failed` with a recovery note. Recovery runs on every Inbox load and in the maintenance job. A recovery-failed review shows "Re-check and apply", which re-validates expected revisions, re-approves, and applies through one endpoint.
- Rejected: recovery at every process start without ownership (races an active worker); leaving recovery as library code with no caller.
- Reason: an interrupted apply must be visible and resolvable by the user, and recovery must never clobber a worker that is still inside its transaction.

## 2026-09-05 The approval endpoint is idempotent (finding 4)
- Decision: "Accept all" approves and applies based on the proposal's current status: pending → approve then apply; approved (interrupted earlier) → apply; applied → the original Action is returned; applying → reported as in progress; any terminal status → refused with a clear message. A lost HTTP response can therefore be retried safely.
- Rejected: requiring the client to know whether approval already happened; returning 409 for a retry of successful work.
- Reason: the engine's apply is idempotent by key; the public wrapper must not undo that guarantee.

## 2026-09-05 Proposal, evidence, and capture finalize atomically (finding 7)
- Decision: interpretation persists the Proposal, its FieldEvidence, and the Capture's `proposed` transition in one transaction; if the capture is no longer ours to transition, nothing persists at all. Review revision persists supersession, the new Proposal, and carried evidence in one transaction. The Proposal builder accepts an open transaction so callers can compose these units; the orchestrator releases the processing claim as `failed` if interpretation throws.
- Rejected: leaving approvable proposals without evidence, or captures still eligible for a second extraction, after a mid-sequence failure.
- Reason: a review must either exist completely or not at all.

## 2026-09-05 Password reset invalidates sessions (finding 14)
- Decision: re-provisioning with a password (the documented reset path) replaces the hash and increments the user's session-revocation version in the same transaction; every existing session is invalid immediately and the next login issues a session under the new version.
- Rejected: leaving sessions valid for their remaining lifetime after a reset.
- Reason: a password reset is the user's response to a suspected compromise; the stolen session must die with the old password.

## 2026-09-05 Rate limiting: address-independent budgets and a documented proxy boundary (finding 15)
- Decision (product owner): keep per-address limits but do not implement proxy detection; instead document in architecture.md that per-address keys are meaningful only behind a proxy that overwrites `X-Forwarded-For` (a hosting requirement). Add budgets that hold regardless of address: the single account allows 30 login attempts per 10 minutes, and each authenticated user 20 extractions per minute. Expired limiter windows are swept so rotated keys cannot grow memory.
- Rejected: trusting the header as-is; building proxy-configuration logic before a hosting decision exists.
- Reason: the deployment, not the repository, defines the trusted transport; the account and user budgets bound abuse until it does.

## 2026-09-05 One retry layer with a total time budget (finding 9)
- Decision: the OpenAI client is created with SDK retries disabled and a 60-second per-attempt timeout; the adapter alone retries — at most three attempts, with backoff, inside a 120-second total budget. The orchestration's intent key (the claim/idempotency key) travels with every request as `metadata.intent_key`.
- Rejected: stacking SDK retries under adapter retries (up to nine HTTP attempts); unbounded wall-clock time for a single extraction.
- Reason: the spec promises one call with two bounded retries; the promise must hold at the wire.

## 2026-09-05 Glossary targets are validated and count as dependents (finding 18)
- Decision: a glossary entry's `(entity_type, entity_id)` pair is verified against the table the type names before every create or update; a missing or mismatched target is a domain-invariant violation (HTTP 422). Any glossary entry pointing at an entity, archived or not, is an acquired dependent that blocks undo-deletion of that entity.
- Rejected: per-type foreign keys (five nullable columns for one polymorphic reference); silently clearing glossary links when their target is deleted.
- Reason: a loose reference is acceptable only if the application closes both ends — nothing may create a dangling pointer, and nothing may create one by deleting the target.

## 2026-09-05 Event participants are first-class (finding 19)
- Decision: event create payloads carry `peopleIds`; the executor and the manual event API persist them as EventPerson rows; undo manifests record them so an event with its original participants undoes cleanly while a participant added later blocks the delete; the interpretation pipeline maps resolved person references and proposed person items on an event to `peopleIds` (an ambiguous mention flags `needs_confirmation`, as for tasks). The prompt names event participants explicitly under the `people` reference field (prompt `p5-2026-09-05`).
- Rejected: leaving EventPerson write-only for Phase 2, with extracted attendees dropped or stuffed into `description`.
- Reason: "lunch with [PERSON_1]" is the most common event capture; losing the participant defeats the review card, and a link created by the batch must be reversible by the batch.

## 2026-09-05 Live extraction enabled
- Decision: the product owner enabled live OpenAI extraction (`EXTRACTION_PROVIDER=openai`, pinned `gpt-5.4-mini-2026-03-17`, prompt `p2-2026-09-05`) on the basis of the accepted `eval-v1` run. The setting lives in the server environment only; the deterministic fake remains the default for tests and CI. Surprising real captures are to be fictionalized into the next dataset version and the evaluation re-run before any prompt or model change.
- Rejected: leaving extraction on the fake provider indefinitely; enabling without the evaluation record.
- Reason: the gate the extraction decision required has been passed and the owner has made the call explicitly.
