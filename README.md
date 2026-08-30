# AfHey

Personal AI command center for one user. Messy input goes in; organized tasks, events, notes, and (from Phase 2) scheduled work blocks come out, all behind a review-first Proposal model.

Read before working on the code:

- `docs/product-spec.md` — authoritative specification
- `docs/architecture.md` — stack and service boundaries
- `docs/decisions.md` — dated decision log
- `docs/phase-1-plan.md` — approved Phase 1 step plan
- `CLAUDE.md` — non-negotiable implementation rules

## Prerequisites

- Node.js 20.12+ (built and tested with Node 26)
- npm
- Homebrew PostgreSQL (see "Database setup")

## Setup

```bash
npm install
cp .env.example .env
```

Fill `.env` values as needed. `.env` is gitignored; long-lived secrets stay server-side and are never committed. `OPENAI_API_KEY` stays empty until the extraction adapter step needs it.

### Database setup

Added in Step 2 of `docs/phase-1-plan.md` (local PostgreSQL via Homebrew); this section is updated there.

## Commands

- `npm run dev` — dev server
- `npm run build` / `npm start` — production build and serve
- `npm run lint` — ESLint
- `npm run typecheck` — TypeScript, no emit
- `npm test` — Vitest unit/integration suites
- `npm run test:e2e` — Playwright end-to-end tests (boots its own dev server on port 3799)

All of `lint`, `typecheck`, `test`, and (once present for the touched area) `test:e2e` run before every commit.

## Stack versions (recorded at Step 1, 2026-08-30)

Next.js 16.3.3 · React 19.2.8 · TypeScript 5 · Tailwind CSS 4 · Prisma 7.10.0 · Luxon 3.7.2 · Zod 4.5.4 · Vitest 4.1.11 · Playwright 1.62.1 · tsx 4 (dev-only)
