# AfHey

Personal AI command center for one user (Afshin). Turns messy input into tasks, events, notes, and scheduled work blocks, with a conversational control layer named AfHey.

## Read first
- `/docs/product-spec.md` is the authoritative specification. Read it fully before any work.
- `/docs/architecture.md` holds stack and service boundaries.
- `/docs/decisions.md` is the decision log. One dated entry per decision, with the rejected alternative.

## Current phase
Phase 1: authoritative data model, projects, tasks, events, online text Inbox extraction, privacy guard, Proposal + action log, persistence, and the defined single-user authentication baseline. Do not start Phase 2 work (scheduler, calendar UI) until Phase 1 exit criteria in the spec are met.

## Non-negotiable rules
1. AI never mutates state directly. Every AI-originated or scheduler-originated change is a Proposal: validate, approve by policy, apply internal mutations transactionally, and log. Reversible internal mutations support conflict-aware undo. Irreversible external actions, once introduced after V1, require explicit confirmation and an immutable audit record; they are not described as undoable.
2. Deterministic code owns dates, timezones, conflicts, scheduling arithmetic. The LLM only interprets language and picks operations.
3. Run the local privacy guard on all provider-bound context immediately before every external LLM call, including captures, retrieved records, conversation context, and user-edited redactions. Never send raw captures or records marked `ai_excluded`.
4. Tools identify entities by stable ID, never by title.
5. Provider calls live only in adapter modules (`TextReasoningProvider`, `ExtractionProvider`, `TranscriptionProvider`, `VoiceRealtimeProvider`). Validate all structured output with a schema.
6. When implementation changes architecture, data model, or scope, update `/docs/product-spec.md` and add a `/docs/decisions.md` entry in the same commit. Preserve requirement history: mark deferrals with a reason and phase, and mark replaced text `[Superseded by decisions.md entry: <dated heading>]` rather than leaving contradictory requirements active.
7. Use a calendar library for rendering. Do not build a calendar engine.
8. Sample data and test fixtures contain no real patient or institutional information. Names, organizations, and study labels in specification examples are illustrative only and must not be copied into seeds or fixtures.

## Stack (see architecture.md for details)
Next.js, React, TypeScript, Tailwind, PostgreSQL, Prisma, Luxon, Zod, Vitest, and Playwright. Tests required for scheduler, extraction evaluation and deterministic validation, privacy guard, and Proposal transactions.

## Workflow
- Small commits with clear messages. Run tests before committing.
- Ask before adding a dependency that is not in architecture.md.
- Prefer editing the spec over inventing behavior it does not cover.
