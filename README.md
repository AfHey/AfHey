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

Local development uses Homebrew PostgreSQL 18 (installed as 18.6 on 2026-08-30):

```bash
brew install postgresql@18
brew services start postgresql@18
PGBIN=/opt/homebrew/opt/postgresql@18/bin
$PGBIN/psql -d postgres -c "CREATE ROLE afhey LOGIN CREATEDB PASSWORD 'afhey'"
$PGBIN/createdb -O afhey afhey_dev
$PGBIN/createdb -O afhey afhey_test
```

The `afhey` role has `CREATEDB` so Prisma Migrate can manage its shadow database. `afhey_dev` backs the app (`DATABASE_URL`); `afhey_test` backs the Vitest database suites (`TEST_DATABASE_URL`), which reset it — never point `TEST_DATABASE_URL` at a database with data you care about.

Verify everything with:

```bash
npm run db:check
```

To reset the dev database completely: drop and recreate it (`$PGBIN/dropdb afhey_dev && $PGBIN/createdb -O afhey afhey_dev`), then run migrations.

## Commands

- `npm run dev` — dev server
- `npm run build` / `npm start` — production build and serve
- `npm run lint` — ESLint
- `npm run typecheck` — TypeScript, no emit
- `npm test` — Vitest unit/integration suites
- `npm run test:e2e` — Playwright end-to-end tests (boots its own dev server on port 3799)

All of `lint`, `typecheck`, `test`, and (once present for the touched area) `test:e2e` run before every commit.

## Maintenance jobs

`npm run jobs:expire` runs the capture-text retention job (spec §9.5, §13): captures whose 30-day clock has passed lose their raw/redacted text and evidence literals (rows stay; the Inbox shows "source expired"), and captures never resolved within 30 days are discarded the same way. It is idempotent and safe to run any time. Schedule it daily — for example with `launchd` on the Mac that hosts the app, or cron:

```
15 3 * * * cd /path/to/afhey && npm run jobs:expire >> logs/expiry.log 2>&1
```

Hosting-side scheduling is decided with the hosting decision (spec §19).

## Stack versions (recorded at Step 1, 2026-08-30)

Next.js 16.3.3 · React 19.2.8 · TypeScript 5 · Tailwind CSS 4 · Prisma 7.10.0 · Luxon 3.7.2 · Zod 4.5.4 · Vitest 4.1.11 · Playwright 1.62.1 · tsx 4 (dev-only)
