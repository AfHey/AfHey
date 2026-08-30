# AfHey Architecture

Status: draft. Fill in during Phase 1 planning; keep current thereafter.

## Stack
- Frontend: Next.js (App Router), React, TypeScript, Tailwind CSS
- Backend: Next.js route handlers / server actions
- Database: PostgreSQL via Prisma
- Dates: (choose one: Luxon or date-fns-tz; record in decisions.md)
- Calendar rendering: (choose one: FullCalendar or Schedule-X; record in decisions.md)
- Validation: Zod at every LLM boundary
- Tests: (choose: Vitest + Playwright)

## Service boundaries
- `ai/adapters/` : TextReasoningProvider, ExtractionProvider, TranscriptionProvider, VoiceRealtimeProvider
- `ai/redaction/` : deterministic PHI/PII redaction, with tests
- `core/proposals/` : Proposal creation, validation, tier policy, transactional apply, action log, undo
- `core/scheduler/` : deterministic scheduling engine and composed operations
- `core/tools/` : tool registry (primitives + composed operations), stable ID conventions, tier per tool
- `db/` : Prisma schema and migrations

## Data flow
Capture or request -> (redaction) -> LLM interpretation -> Proposal -> validation -> approval by tier -> transaction -> action log -> undoable

## Open items
See /docs/product-spec.md section 19.
