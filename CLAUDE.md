# AfHey

Personal AI command center for one user (Afshin). Turns messy input into tasks, events, notes, and scheduled work blocks, with a conversational control layer named AfHey.

## Read first
- `/docs/product-spec.md` is the authoritative specification. Read it fully before any work.
- `/docs/architecture.md` holds stack and service boundaries.
- `/docs/decisions.md` is the decision log. One dated entry per decision, with the rejected alternative.

## Current phase
Phase 1: data model, projects, tasks, events, Inbox extraction, redaction guard, Proposal + action log, persistence, simple auth. Do not start Phase 2 work (scheduler, calendar UI) until Phase 1 exit criteria in the spec are met.

## Non-negotiable rules
1. AI never mutates state directly. Every AI-originated or scheduler-originated change is a Proposal: validate, approve by tier, apply as a transaction, log, undoable.
2. Deterministic code owns dates, timezones, conflicts, scheduling arithmetic. The LLM only interprets language and picks operations.
3. Run the local redaction pass before any text reaches an external LLM. Never send raw captures.
4. Tools identify entities by stable ID, never by title.
5. Provider calls live only in adapter modules (`TextReasoningProvider`, `ExtractionProvider`, `TranscriptionProvider`, `VoiceRealtimeProvider`). Validate all structured output with a schema.
6. When implementation changes architecture, data model, or scope, update `/docs/product-spec.md` and add a `/docs/decisions.md` entry in the same commit. Never delete a requirement; mark it deferred with a reason.
7. Use a calendar library for rendering. Do not build a calendar engine.
8. Sample data contains no real patient or institutional information.

## Stack (see architecture.md for details)
Next.js, React, TypeScript, Tailwind, PostgreSQL, Prisma, timezone-aware date library. Tests required for scheduler, extraction (regression suite), redaction, and Proposal transactions.

## Workflow
- Small commits with clear messages. Run tests before committing.
- Ask before adding a dependency that is not in architecture.md.
- Prefer editing the spec over inventing behavior it does not cover.
