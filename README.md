# AfHey

Personal AI command center for one user. Messy input goes in; organized tasks, events, notes, and (from Phase 2) scheduled work blocks come out, all behind a review-first Proposal model.

Read before working on the code:

- `docs/product-spec.md` — authoritative specification
- `docs/architecture.md` — stack and service boundaries
- `docs/decisions.md` — dated decision log
- `docs/phase-1-plan.md` — approved Phase 1 step plan
- `CLAUDE.md` — non-negotiable implementation rules

## Status

Phase 1 (Foundation) and Phase 2 (Time: scheduler, calendar, Today, search, maintenance job) are implemented; see `docs/phase-1-plan.md` §10 and `docs/phase-2-plan.md` §10 for the exit-criteria records. Live AI extraction is off by default (`EXTRACTION_PROVIDER` unset → deterministic fake); the product owner enables it after reviewing `docs/evals/`. CI (`.github/workflows/ci.yml`) runs lint, typecheck, Vitest, and Playwright against a PostgreSQL service with the fake provider.

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

The `afhey` role has `CREATEDB` so Prisma Migrate can manage its shadow database. `afhey_dev` backs the app you use (`DATABASE_URL`); `afhey_test` backs the Vitest database suites **and** the Playwright e2e server (`TEST_DATABASE_URL`), both of which rebuild it — never point `TEST_DATABASE_URL` at a database with data you care about.

Verify everything with:

```bash
npm run db:check
```

To reset the dev database completely: drop and recreate it (`$PGBIN/dropdb afhey_dev && $PGBIN/createdb -O afhey afhey_dev`), then run migrations.

## Commands

- `npm run dev` — dev server. To open it from a phone over the LAN or Tailscale (plain HTTP), list that host in `AFHEY_DEV_ORIGINS` in `.env` (see `.env.example`); Next otherwise blocks its own dev scripts for non-localhost hosts and the login form cannot submit. Development only; `next start` ignores it and keeps the `Secure` cookie.
- `npm run build` / `npm start` — production build and serve
- `npm run lint` — ESLint
- `npm run typecheck` — TypeScript, no emit
- `npm test` — Vitest unit/integration suites
- `npm run db:unseed` — removes the fictional seed from the database at `DATABASE_URL` by its fixed ids (decisions.md 2026-09-06); your own rows and the Work/Personal areas and scheduler settings stay
- `npm run test:e2e` — Playwright end-to-end tests. Boots its own dev server on port 3799 bound **exclusively to `afhey_test`** (rebuilt, provisioned with `AFHEY_E2E_PASSWORD`, and seeded by the global setup); it never touches `afhey_dev`, and it builds into `.next-e2e` so it runs alongside a manually started `npm run dev`
- `npm run test:live` — live-provider tests against the pinned OpenAI model (needs `OPENAI_API_KEY`; not part of `npm test` or CI)

All of `lint`, `typecheck`, `test`, and (once present for the touched area) `test:e2e` run before every commit.

## Extraction evaluation

`npm run eval:extraction` runs the versioned extraction evaluation (spec §14.3) against the pinned OpenAI model — 33 fictional cases, field-level scoring — and writes a report to `docs/evals/` recording model, prompt version, dataset version, metrics, and the acceptance result. It costs real API calls; `npm run eval:extraction -- --fake` exercises the pipeline without any. Re-run it after any prompt, model, or dataset change. Live extraction (`EXTRACTION_PROVIDER=openai`) is enabled only by the product owner after an accepted run.

## Maintenance job

`npm run jobs:maintenance` (Phase 2 Step 11; formerly `jobs:expire`) runs, in order: capture-text retention (spec §9.5, §13: captures whose 30-day clock has passed lose their raw/redacted text and evidence literals, rows stay, and captures never resolved within 30 days are discarded the same way), recovery of Proposals left `applying` by an interrupted process, the missed-block transition (planned blocks that ended without a completion or work session become `missed_unconfirmed`), and the priority recompute for open tasks. Every part is idempotent, so the job is safe to run any time; the Today and Calendar screens also run the missed-block transition on load and the scheduler recomputes priorities before planning. Schedule it daily — for example with `launchd` on the Mac that hosts the app, or cron:

```
15 3 * * * cd /path/to/afhey && npm run jobs:maintenance >> logs/maintenance.log 2>&1
```

Hosting-side scheduling is decided with the hosting decision (spec §19).

## Scheduler worked example

`npx tsx scripts/scheduler-example.ts 2026-09-07 2026-09-05T18:00:00` rebuilds the disposable test database, provisions the user, loads the fictional seed, and prints the `plan_day` Proposal for the date with the given "now" (both in `America/New_York`). It never touches `afhey_dev`.

## Stack versions (recorded at Step 1, 2026-08-30)

Next.js 16.3.3 · React 19.2.8 · TypeScript 5 · Tailwind CSS 4 · Prisma 7.10.0 · Luxon 3.7.2 · Zod 4.5.4 · Vitest 4.1.11 · Playwright 1.62.1 · tsx 4 (dev-only)

Phase 2 (recorded at Step 1, 2026-09-05): FullCalendar `@fullcalendar/react` 7.1.0 (standard MIT packages: time-grid, interaction, Breezy theme plugin) · temporal-polyfill 1.0.4. Both are pinned exactly.

## Calendar rendering notes

- The calendar is a client component (`src/app/(app)/calendar/calendar-view.tsx`). The grid renders client-only behind a hydration-safe gate: FullCalendar formats ranges with `Intl`, and Node's ICU and the browser's ICU disagree on the invisible spacing in strings such as "10:00 – 10:30", which made React reject the server HTML. The page shell is still server-rendered.
- In v7 the theme is a plugin (`@fullcalendar/react/themes/breezy`) plus three stylesheets (`skeleton.css`, the theme, a palette). Without the plugin the grid renders unstyled and never emits resize handles.
- Per-event classes are one string (`className`), read back in tests as `.afhey-event`; time zones are named zones handled by Temporal, so events are passed as UTC instants and the library shifts them.
- Touch: drag, resize, and selection start after a long press (`longPressDelay` 400 ms, selection 500 ms). The e2e phone spec drives this through Chromium's touch emulation; a physical iPhone pass remains a manual check.
