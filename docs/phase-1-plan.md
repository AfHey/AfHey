# Phase 1 Implementation Plan

**Status:** Approved 2026-08-30; **all 15 steps implemented 2026-08-30 → 2026-09-05.** Exit criteria verified (see "Completion record" at the end). Awaiting the independent Phase 1 review required by spec §15 before Phase 2 begins. Live extraction remains disabled pending product-owner approval after the accepted evaluation.
**Date:** 2026-08-30.
**Basis:** `product-spec.md` v1.2 (Sections 3, 6, 8–11, 13–15), `architecture.md`, and every 2026-08-30 `decisions.md` entry, including "Capture rejected status."

## 1. Scope summary

Phase 1 (Foundation) delivers: the authoritative data model behind the Section 9 Phase 1 migration boundary; base Projects/Areas and People; Task/Event/Note CRUD with revisions and archive; the online text Inbox (typed, pasted, or device/browser-dictated text) with privacy guard, entity resolution, pinned OpenAI extraction, deterministic date resolution, duplicate warning, field evidence, mandatory-review Proposals, idempotent transactional apply, ActionLog, conflict-aware batch undo, and the Capture lifecycle including the new `rejected` terminal status; PostgreSQL persistence; single-user authentication (Credential + database Sessions, CSRF defense, rate limits); minimal settings (`current_timezone`, glossary CRUD); the raw-Capture/evidence-literal expiry job; and the Phase 1 test suites plus the versioned extraction evaluation.

Explicit non-goals, deferred per spec: scheduler, `kind = block` Events, calendar library decision and calendar UI, Today screen, basic search, priority recomputation job, scheduler-constraint tables (Phase 2); tool layer and permission tiers (Phase 3a); AfHey chat, Conversation/Message/TurnReferenceSet, `Proposal.conversation_id`, export/erasure, command palette (Phase 3b); voice/audio (Phase 4); images, PWA share target, offline, external actions, automatic waiting-for detection, weekly review (Phase 5); notifications and reminder delivery (Phase 6 — reminder Tasks are viewable/completable in Phase 1). Phase 1 stores no block Events and writes no WorkSession rows (the table ships; the focus timer is Phase 2).

## 2. Working agreements (bind every step)

1. Run the test suite (`lint`, `typecheck`, Vitest; Playwright once it exists) before every commit; at least one commit per step, small commits within a step where natural.
2. AI never mutates state directly. Extraction output becomes a mandatory-review Proposal with `approval_policy = explicit`.
3. Deterministic code owns dates/timezones; the guard runs on the complete provider-bound payload immediately before every external call; `ai_excluded` records never reach a provider; entities are identified by opaque UUIDs, never titles.
4. Provider SDK calls live only in `ai/adapters`; all structured output is Zod-validated.
5. If a step forces a change to architecture, data model, or scope, `product-spec.md` and `decisions.md` are updated in the same commit.
6. Seeds, fixtures, and evaluation data are wholly fictional; no names, organizations, or study labels from the specification.
7. Secrets live only in `.env` (gitignored, server-side); `.env.example` documents every required variable with placeholder values.

## 3. Ordered implementation steps

**Step 1 — Next.js scaffold and tooling.**
`create-next-app` (TypeScript, App Router, Tailwind, ESLint) in the repo root; add Prisma, Luxon, Zod, Vitest, Playwright at current stable versions (recorded in `package.json`); scripts for `dev`, `build`, `lint`, `typecheck`, `test`, `test:e2e`; source skeleton per `architecture.md` for the Phase 1 boundaries (`ai/adapters`, `ai/redaction`, `core/proposals`, `core/auth`, `jobs`, `db`); `.env.example` with `DATABASE_URL` and empty `OPENAI_API_KEY`; verify `.env*` is gitignored; README quickstart; one smoke test so the pre-commit test gate is live from the first commit.

**Step 2 — Local PostgreSQL via Homebrew.**
Install or verify the current Homebrew PostgreSQL formula (17 or newer; actual version recorded in README); start the service; create `afhey_dev` and `afhey_test` databases and an app role (with `CREATEDB` for Prisma's shadow database, or an explicit `SHADOW_DATABASE_URL`); write local `.env` (not committed); README section covering setup, reset, and test-database use; connectivity check script.

**Step 3 — Prisma schema and initial migration (the exact 19-table boundary).**
Model every table in Section 4 below with all Section 9/11 enums (including Capture `rejected`), UUID primary keys, integer revisions, FKs, uniques (e.g. normalized PersonAlias, Proposal `idempotency_key`, ProposalOperation `(proposal_id, sequence)`), and the reserved Event sync-provenance columns. `Proposal` has no `conversation_id` in Phase 1. ActionLog snapshots reference entities by UUID value without FKs. Generate the migration with `--create-only` and hand-add the CHECK/partial-unique constraints Prisma cannot express (deadline mutual exclusion, timed vs all-day exclusivity, `task_kind` exactly-when rules, `completed_at` exactly-when, block `task_id` rule, `is_locked = false` for fixed Events, single active WorkSession, area/project parent rules). Wholly fictional seed script. Tests: migration applies from scratch on the test DB; DB-level constraint tests for representative invariants.

**Step 4 — Domain types and validation layer.**
Shared TypeScript enums/types mirroring the schema; Zod schemas per entity; invariant validators for the full Section 9 rule set (application-level mirror of the DB constraints, plus rules the DB cannot check, e.g. cycle rejection, `effective_priority` banding as a derived function, preferred-window pairing); repository helpers for direct manual mutations that increment `revision` (Rule 11.2.13: ordinary single-entity edits bypass Proposals). Tests: validator and revision unit tests.

**Step 5 — Single-user authentication (Section 10.9).**
Provisioning script creating the one User, a `password` Credential (argon2 hash), and UserSettings (`current_timezone` default `America/New_York`); login/logout; database Session rows (hashed random token, `expires_at`, `last_seen_at`, rotation on login, revocation, and revocation-version bulk invalidation); `HttpOnly`/`Secure`/`SameSite` cookies; CSRF defense on all mutations (origin check + per-session token); rate limiting on authentication and AI endpoints; middleware gating every app route. Phase 1 implements password login; the `passkey` Credential kind stays reserved in the schema (recorded in `decisions.md` at this step). Tests: suite E.

**Step 6 — Core entity CRUD and minimal screens.**
Server actions/route handlers with validation + revisions for Project (area/project hierarchy, one level, cycle rejection), Task (all kinds; reminders viewable/completable), Event (kinds except `block`, timed and all-day, fixed/flexible + lock invariants), Note, Person + aliases, GlossaryEntry, and Settings (timezone); archive/soft-delete as the only user-facing removal; manual editing per Section 10.4; complete/uncomplete with `completed_at` rule. Minimal responsive navigation for Phase 1: Inbox, Projects, Tasks, Notes, People, Settings (final navigation is Phase 3b). Project pages show description, active/completed tasks, notes, people. Tests: suite D plus CRUD integration tests.

**Step 7 — Privacy guard (Section 13).**
`ai/redaction`: deterministic detectors for MRNs, dates of birth, phone numbers, email addresses, street addresses, and person-name patterns in one tested module; provider-payload assembly that enforces `ai_excluded` exclusion; guard invoked on the complete final payload immediately before transmission, and re-run in full after any user edit of redactions; `no_ai` path storing the Capture as a plain Note with no external call. Tests: suite A.

**Step 8 — Proposal engine, ActionLog, conflict-aware undo (Section 11).**
Proposal/ProposalOperation construction with preallocated entity/operation UUIDs, `sequence` + dependency graph, `expected_revision` capture, unique idempotency keys; validation (unknown IDs, dependency violations, illegal field combinations, stale revisions); `approval_policy = explicit` only; transactional apply — revision recheck under row locks, ordered mutations, ActionLog row in the same PostgreSQL transaction, `failed` recorded reliably outside a rolled-back transaction; `applying` crash recovery via idempotency key; full status machine; conflict-aware undo as a new Proposal referencing the original Action (Rules 9–10) including batch undo; Capture `processing_status` transitions (`received → redacted → proposed → processed | rejected | failed`, plus `no_ai`), with `rejected` setting `raw_delete_after` to 30 days after rejection. Tests: suite C.

**Step 9 — Entity resolution (Section 3.1 item 3).**
Deterministic local matching of guarded Capture text against Projects, People aliases, and glossary; substitution of opaque stable-ID candidate placeholders into the guarded text; provider receives only placeholders and safe minimal context; mapping of returned candidate IDs and `unresolved_literal` values back through trusted code. Product-owner rule (2026-08-30): an ambiguous match — e.g. a first name matching multiple `Person.name` values, "two people named Sarah" — resolves to *unresolved/multiple candidates with `needs_confirmation`*, never an error; normalized alias uniqueness stays global. Tests: suite B (resolution cases, including the ambiguous-first-name case).

**Step 10 — ExtractionProvider adapter (Sections 12.7, 14.1).**
`openai` SDK confined to `ai/adapters`; Responses API with pinned snapshot `gpt-5.4-mini-2026-03-17` and JSON-schema Structured Outputs matching the Section 14.1 contract; Zod shape validation; at most two bounded retries with backoff reusing the intent idempotency key; server-side key only. A deterministic `FakeExtractionProvider` (fixture-driven) backs tests, CI, and local development. Live extraction stays disabled until the Step 14 evaluation passes (per the extraction decision entry). **This is the step where `OPENAI_API_KEY` must exist in `.env` — I will tell Afshin before starting it.** Tests: adapter contract tests against the fake; live smoke gated on the key.

**Step 11 — Deterministic interpretation pipeline (Sections 8, 14.1).**
Luxon-based temporal resolution from literal + relation + anchor (date-only vs timed with zone; nonexistent/duplicated DST local times return `needs_confirmation`, never a silent shift); translation of validated provider items into an ordered Inbox Proposal (dependency graph from `item_ref`s, preallocated UUIDs, FieldEvidence rows with offsets into the transmitted `redacted_text`); unresolved names become proposed Person/Project creates; duplicate-detection warning (title similarity + same project or due window); business validation of every proposed field. Tests: suite B (temporal table incl. DST, evidence bounds, translation, duplicates).

**Step 12 — Inbox UI and Capture lifecycle (Sections 3, 10.3).**
Universal input (typed/pasted text; device/browser dictation arrives as ordinary text — no audio APIs) and Quick Add from every Phase 1 screen; Capture created on receipt before interpretation; redaction preview with edit → full re-guard; no-AI toggle; mandatory-review confirmation UI: accept all, edit item, delete item, change dates/project/duration, convert task ↔ event ↔ note, reject all (→ Proposal `rejected`, Capture `rejected`); apply-once through the Proposal engine with the AI rate limit; batch-undo affordance with conflict review; mobile-friendly rapid accept/delete. Tests: integration over the whole flow with the fake provider; component tests.

**Step 13 — Expiry job (Sections 9.5, 13).**
`jobs/` runner that, when `raw_delete_after` passes, nulls `raw_text`, `redacted_text`, and related `FieldEvidence.literal_text` while rows persist; discards/resolves failed/unprocessed Captures no later than 30 days after creation; "source expired" state surfaced in the UI; runnable manually and documented for local scheduling. Tests: suite F.

**Step 14 — Extraction evaluation suite (Section 14.3).**
30–50 wholly fictional, non-sensitive messy inputs; field-level precision/recall with explicit tolerances (no exact whole-response equality); versioned dataset and prompt; run against the pinned model (requires the key) and commit a report recording model, prompt version, dataset version, metrics, and acceptance; only on acceptance is live extraction enabled. Deterministic scoring logic itself is unit-tested in CI.

**Step 15 — End-to-end tests and exit verification.**
Playwright (fake provider; optional live smoke locally after Step 14): login; paste a messy non-sensitive paragraph → schema-valid items with evidence and deterministic dates → edit/confirm → apply exactly once → restart/reload with everything persisted; reject flow; no-AI flow; stale-apply conflict; unsafe-undo conflict; mobile viewport pass. Add a CI workflow (lint, typecheck, Vitest, Playwright with fake provider) if/when a GitHub remote exists. Final docs sweep, then request the independent phase review required by Section 15 before Phase 2 begins.

## 4. Exact Phase 1 table list (spec Section 9, "Phase 1 migration boundary")

Phase 1 migrations create exactly these 19 tables:

1. User
2. Credential
3. Session
4. UserSettings (timezone only)
5. Project
6. Task
7. TaskPerson
8. Person
9. PersonAlias
10. Event — including the reserved sync-provenance columns `source_provider`, `external_id`, `external_version`, `last_synced_at`, `sync_status`
11. EventPerson
12. Note
13. Capture
14. GlossaryEntry
15. WorkSession
16. Proposal
17. ProposalOperation
18. ActionLog
19. FieldEvidence

Explicitly **not** created in Phase 1: scheduler-constraint child tables (Phase 2); Conversation, Message, TurnReferenceSet, and the `Proposal.conversation_id` column with its foreign key (Phase 3b).

## 5. Test list

CI-deterministic suites (Vitest unless noted; run before every commit):

- **A. Privacy guard:** pattern coverage for MRN, DOB, phone, email, street address, person-name patterns; false-positive checks; full-payload re-guard after user edits; `ai_excluded` enforcement in payload assembly; prompt-injection boundary cases (instructions inside pasted/retrieved content never authorize operations).
- **B. Deterministic interpretation:** temporal resolution table (relations `on | before | after | within | duration_after`; date-only vs timed vs all-day; `current_timezone` handling; nonexistent and duplicated DST local times → `needs_confirmation`); entity resolution and placeholder substitution/mapping; Section 14.1 contract Zod validation plus invariant checks (evidence bounds, `item_ref` dependency graph, no LLM-invented UUIDs, non-authoritative LLM datetimes); duplicate-detection warning; translation into ordered Proposals with preallocated UUIDs.
- **C. Proposal transactions:** idempotent apply (reused key returns the original result); operation ordering and dependency verification; stale-revision conflict → `conflicted` with zero partial writes; successful apply commits mutations + ActionLog atomically; partial-failure rollback; `applying` crash recovery via idempotency key; conflict-aware undo of an eligible Action; unsafe undo (later edit, dependents) → `conflicted`; batch undo including the conflict path; Capture status transitions including `rejected` and its `raw_delete_after` clock. (Tier recomputation tests are Phase 3a.)
- **D. Data-model invariants:** deadline mode mutual exclusion and `deadline_type` exactly-when; `task_kind` reminder/waiting_for exactly-when rules; `completed_at` exactly-when; timed vs all-day Event exclusivity; block `task_id` rule and rejection of block creation in Phase 1; `is_locked` false for fixed Events; project hierarchy (area parent rules, cycle rejection, task→project-kind rule); PersonAlias normalized uniqueness; revision increment on every mutation; single active WorkSession constraint.
- **E. Authentication:** password login; session rotation and expiry; single-session revocation; revocation-version bulk invalidation; cookie flags; CSRF rejection on mutations; rate limits on auth and AI endpoints.
- **F. Expiry job:** nulls raw/redacted text and evidence literals after `raw_delete_after` (processed, no-AI, and rejected clocks); rows and links persist; failed/unprocessed 30-days-after-creation rule; UI "source expired" state.
- **H. End-to-end (Playwright, fake provider in CI):** exit-criteria flow (paste → guarded extraction → review/edit → apply once → restart → persisted); reject flow; no-AI flow; login/logout; mobile viewport smoke.

Key-required, recorded rather than CI-run:

- **G. Extraction evaluation (versioned):** 30–50 fictional messy inputs scored field-level with tolerances; committed report of model, prompt version, dataset version, metrics, acceptance; gates enabling live extraction.

## 6. Dependencies needing approval (not named in architecture.md)

- `openai` — official SDK, used only inside `ai/adapters`.
- `argon2` — password hashing for the Credential row. (Zero-dependency alternative: Node's built-in `crypto.scrypt`; say the word and I'll use that instead.)
- `tsx` (dev-only) — run TypeScript scripts (provisioning, seed, expiry job) without a build step.

Everything else (Next.js, React, TypeScript, Tailwind, Prisma, Luxon, Zod, Vitest, Playwright) is already fixed by `architecture.md`. No UI component library in Phase 1 — plain Tailwind.

## 7. Environment and secrets

- `.env.example` (committed): `DATABASE_URL` with a local placeholder, `OPENAI_API_KEY=` empty. `.env` stays gitignored and server-side only.
- The OpenAI key is not needed for Steps 1–9. I will explicitly ask Afshin to add `OPENAI_API_KEY` to `.env` before starting Step 10, and it is required again for the Step 14 evaluation. All CI/dev flows before then use the fake provider.

## 8. Phase 1 exit criteria (from spec Section 15)

Type, paste, or device-dictate a messy non-sensitive paragraph; get schema-valid items with evidence and deterministic dates; confirm/edit them; safely apply once; close and reopen with everything saved; stale-apply and unsafe-undo tests pass. Then the independent review runs before Phase 2.

## 9. Open items for the product owner (answer with plan approval)

1. **Password-first auth:** Phase 1 ships password login only; `passkey` stays a reserved Credential kind for later. OK?
2. **`rejected` semantics as specified above:** terminal, user-only, distinct from `failed`, 30-day retention clock from rejection. OK as written into spec v1.2?
3. **`argon2` vs built-in `scrypt`** for password hashing (item 6).

## 10. Completion record (2026-09-05)

| Exit criterion (spec §15) | Evidence |
|---|---|
| Type, paste, or device-dictate a messy non-sensitive paragraph | Inbox composer (`e2e/inbox.spec.ts`, `e2e/exit-criteria.spec.ts`); dictated text arrives as plain text |
| Schema-valid items with evidence and deterministic dates | `extraction-contract.ts` + `src/core/interpretation/*` (`temporal.test.ts`, `tests/db/interpretation.test.ts`); evaluation `docs/evals/eval-v1-p2-2026-09-05-openai.md` |
| Confirm/edit them | Review cards with edit/convert/remove via superseding proposals (`tests/db/inbox-routes.test.ts`) |
| Safely apply once | Explicit approval + transactional apply, idempotent replay (`tests/db/proposals.test.ts`) |
| Close and reopen with everything saved | Fresh-session e2e (`e2e/exit-criteria.spec.ts`); PostgreSQL persistence |
| Stale apply test passes | "turns a stale expected revision into conflicted with zero partial writes" |
| Unsafe undo test passes | "a later edit makes the undo proposal conflicted", "acquired dependents block undo", "batch undo conflicts as a whole", "undo racing a concurrent edit" |

Deviations from the plan, all recorded in `decisions.md`: `@prisma/adapter-pg` (required by Prisma 7); evidence spans re-anchored from quoted text (`quote` on `field_evidence`); login rate limit 10/min. Deferred inside Phase 1 scope: passkey ceremony (kind reserved), person-alias removal (archive-only tension with the global unique), scheduler-only task fields in the manual form (Phase 2 UI), undo-of-undo (not required).
