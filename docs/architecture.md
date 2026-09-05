# AfHey Architecture

Status: current. Defined before Phase 1 implementation; keep current thereafter.

## Stack
- Frontend: Next.js (App Router), React, TypeScript, Tailwind CSS
- Backend: Next.js route handlers / server actions
- Database: PostgreSQL via Prisma
- Dates: Luxon
- Calendar rendering: FullCalendar v7 standard (MIT) packages through `@fullcalendar/react` with `temporal-polyfill` — time-grid day/week views and the interaction plugin, in a client component; decided 2026-09-05 (decisions.md). The library renders and reports gestures; `core/scheduler` and Luxon own every date computation
- Validation: Zod at every LLM boundary
- Tests: Vitest for unit/integration tests; Playwright for end-to-end tests
- AI providers: OpenAI behind `ExtractionProvider` and `TextReasoningProvider`. Phase 1 extraction uses the pinned `gpt-5.4-mini-2026-03-17` snapshot through the Responses API with JSON-schema Structured Outputs, gated by the versioned extraction evaluation. The Phase 3b reasoning model is selected and pinned before that phase.
- Phase 1 dictation: device/browser dictation only (iPhone keyboard microphone or browser Speech API) for non-sensitive content; no uploaded audio or external transcription API
- Authentication: one provisioned user, no public registration; password or passkey `Credential` rows, database-backed `Session` rows with rotation and revocation, CSRF protection, and rate limits on authentication and AI endpoints
- Storage security: hosting-provider encryption at rest; no application-managed field-level encryption in V1; processed raw and redacted Capture text and evidence literals are deleted after 30 days

## Service boundaries
- `ai/adapters/` : TextReasoningProvider, ExtractionProvider, TranscriptionProvider, VoiceRealtimeProvider
- `ai/redaction/` : deterministic privacy guard for all provider-bound context, with tests; records marked `ai_excluded` are never provider input
- `core/resolution/` : deterministic entity resolution — lexicon over People/aliases/Projects/glossary, opaque placeholder substitution merged with the guard, candidate-ID context for the provider
- `core/interpretation/` : deterministic interpretation of extraction results — temporal resolution (dates, instants, DST policy), reference linking to preallocated UUIDs, duplicate warnings, FieldEvidence, Inbox Proposal construction
- `core/captures/` : Capture lifecycle (create, redaction preview, no-AI path, rejection) and the capture → extraction → Proposal orchestration
- `core/proposals/` : Proposal creation, validation, tier policy, transactional apply, action log, conflict-aware undo
- `core/scheduler/` : deterministic scheduling engine and composed operations
- `core/tools/` : tool registry (primitives + composed operations), stable ID conventions, tier per tool
- `core/auth/` : single-user credential and session management, CSRF defense, and rate limiting for authentication and AI endpoints
- `jobs/` : scheduled maintenance, including the Capture-text and evidence-literal expiry job
- `db/` : Prisma schema and migrations, evolved per the product-spec Section 9 “Phase 1 migration boundary”

## Data flow
Capture or request -> privacy guard immediately before transmission -> LLM interpretation -> Proposal -> schema/business validation -> approval policy -> internal database transaction -> action log -> conflict-aware undo when reversible

Phase 1 Inbox Proposals always require explicit approval; the general AfHey tool-tier system is Phase 3a. Future external side effects are outside V1 and will use a separately designed execution model rather than claiming atomicity with a PostgreSQL transaction. [Deferred: Phase 5; review item 7]

Device/browser dictation uses platform facilities and receives no AfHey provider credential. A future direct realtime client connection may use only short-lived, narrowly scoped server-issued credentials. Long-lived provider keys remain server-only. Phase 1 extraction and V1 text reasoning are server mediated.

## Open items
See `/docs/product-spec.md` Section 19. Hosting/backups, the exact Phase 3b text-reasoning model, and Phase 3a Tier 2 thresholds remain deliberately unresolved and must be recorded in `/docs/decisions.md` before their owning phase begins. The Phase 2 calendar rendering library was decided 2026-09-05.

## Deployment requirements

- **Trusted proxy boundary for rate limiting.** Per-address rate limits key on the first `X-Forwarded-For` value. That is only meaningful when the app is reachable exclusively through a proxy that overwrites (not appends to) that header, or when it terminates connections itself with no forwarding headers at all. This repository does not establish such a boundary; the hosting decision (spec §19) must, and until it does the per-address limits are advisory. Independent of address, the login endpoint enforces a single-account budget and the extraction endpoint an authenticated-user budget, so spoofing the header cannot bypass rate limiting entirely (review finding 15, 2026-09-05).
