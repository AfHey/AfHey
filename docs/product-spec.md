# AfHey Personal Command Center

## Product and Implementation Specification

**Status:** Authoritative implementation specification. Version 1.2, 2026-08-30 (pre-Phase-1 review, same-day cross-review, and the Capture `rejected` status decision applied).
**Location:** `/docs/product-spec.md`. Companion documents: `/docs/architecture.md` (stack, libraries, service boundaries) and `/docs/decisions.md` (dated decision log, one entry per decision with the rejected alternative).
**Owner:** Afshin (product owner). **Implementer:** Claude Code (repository owner). **Reviewer:** an independent model reviews this document once before Phase 1 and again at each phase milestone.

### How to use this document

1. Read the whole document before writing code.
2. When implementation forces a change in architecture, data model, or scope, update this document in the same commit and add an entry to `/docs/decisions.md`. The specification must never lag behind the code.
3. Never delete a requirement. If a requirement is deferred, mark it `[Deferred: phase N, reason]` in place. If a decision replaces it, preserve the old text and append `[Superseded by decisions.md entry: <dated heading>]`; only the replacement remains authoritative.
4. Sections marked **(A)** were added in a second review pass. Unmarked sections are the original specification, preserved in full. Section 12 (AfHey) is entirely new and is part of Version 1 architecture, though its voice layer is implemented later.
5. Priorities, in order: usefulness, simplicity, reliability, speed, clean UX. Features that do not serve these are out of scope.

---

## 1. Core Product Idea

This is not a generic to-do list or calendar app. The core idea is an AI-powered personal command center that can take messy, unstructured input and automatically turn it into organized tasks, calendar events, reminders, notes, and scheduled work blocks.

The application is for one user initially: Afshin.

The app should function as an AI executive assistant for his personal and professional life.

He should be able to throw almost anything into one universal input:

- typed text
- pasted email
- pasted text message
- pasted Slack/Teams message
- copied notes
- voice memo `[Superseded by decisions.md entry: 2026-08-30 Voice and provider boundaries]`; Phase 1 accepts only non-sensitive text produced by device/browser dictation, and realtime conversational voice is V1.1
- brain dump
- eventually screenshots or other files

The application should analyze the input and determine whether it contains:

- a task
- multiple tasks
- a calendar event
- a deadline
- a reminder
- a note
- a commitment the user made
- something the user is waiting for from another person
- a project-related item
- something irrelevant that does not need action

The user should not normally need to manually decide which category something belongs to.

The basic philosophy is:

**INPUT → AI INTERPRETATION → STRUCTURED ACTION → CALENDAR / TASKS / PROJECTS**

**(A)** With AfHey, the philosophy extends to:

**INPUT or REQUEST → AI INTERPRETATION → PROPOSAL → APPROVAL → TRANSACTION → CALENDAR / TASKS / PROJECTS**

---

## 2. Version 1 Scope

Build Version 1 around six main areas:

1. Universal Inbox
2. Today
3. Calendar
4. Projects
5. AI Automatic Scheduling
6. **(A)** AfHey, the conversational control interface (text in V1; voice in V1.1)

**Release boundary:** V1 ends when Phase 3b exits. Phase 4 realtime voice is V1.1. Phases 5 and 6 are V2. A later phase may be represented in the architecture without being a V1 deliverable.

These should feel like parts of one integrated system, not separate apps.

**(A)** Mental model of the interfaces:

| Screen | Question it answers |
|---|---|
| Today | What should I be doing? |
| Calendar | When am I doing everything? |
| Inbox | What just came into my life? |
| Projects | What am I working toward? |
| AfHey | Tell the system what you want, or ask it to reason across everything |

AfHey is the control interface. Today and Calendar are the visual interfaces. Chat does not replace them; chat is poor for scanning a week.

---

## 3. Universal Inbox

This should be the heart of the application.

There should be one prominent input area where the user can:

- type something
- paste a message
- paste an email
- paste multiple paragraphs
- enter a brain dump
- dictate non-sensitive content using the iPhone keyboard microphone or browser Speech API; Phase 1 does not accept audio uploads or call an external transcription API

The AI should parse the input and extract actionable information.

Example input:

> "Tomorrow I need to email Bridget about the study, check whether the patient completed the follow-up, buy detergent, and I should probably do UWorld for two hours after work."

The app should identify:

- Task 1: Email Bridget about the study. Suggested date: tomorrow.
- Task 2: Check patient follow-up. Suggested date: tomorrow.
- Task 3: Buy detergent. Suggested date: tomorrow. Category: personal / errand.
- Task 4: Do UWorld. Estimated duration: 2 hours. Suggested time: after work. Type: schedulable task / study block.

Before saving, show the AI interpretation in a clean confirmation interface.

The user should be able to:

- accept all
- edit individual items
- delete incorrect items
- change dates
- change project
- change duration
- convert task ↔ event ↔ note
- save everything

The AI should extract, when available:

- title
- description
- type
- due date
- due time
- event start/end time
- estimated duration
- priority
- project
- people involved
- location
- context
- source evidence spans linked to the Capture; do not duplicate the full source text on extracted items
- whether it can be automatically scheduled
- whether it is movable
- dependencies
- notes

Use structured data internally rather than storing everything only as text.

### 3.1 Inbox additions (A)

1. **Share sheet capture.** Build the app as an installable PWA with a `share_target` in the web manifest so an email, message, or screenshot can be shared directly from iOS or Android into the Inbox without opening the app first. This is what makes "copy it and it goes in" true on a phone. `[Superseded by decisions.md entry: 2026-08-30 Capture, offline, and multimodal scope]` Phase 1 accepts online text paste/type/dictation only. Images, screenshots, uploaded audio, the PWA share target, and offline capture are deferred to Phase 5 (V2); Phase 1 does not accept or queue them.
2. **Sensitive content guard.** Before any text is sent to an LLM, run a local, deterministic redaction pass (see Section 13). Show the user what was redacted. Provide a "no AI" toggle that stores the capture as a plain note without any external call.
3. **Entity resolution against the user's own data.** Before provider transmission, deterministic local matching compares the Capture with Projects, People aliases, and the glossary, then substitutes opaque stable-ID candidate placeholders into the guarded text. The provider receives only those placeholders and safe, minimal context—not a raw People/glossary dump—and returns candidate IDs or unresolved literals. This maps existing records without making known names a privacy-guard whitelist.
4. **Duplicate detection.** Warn when an extracted item closely matches an open item (title similarity plus same project or same due window).
5. **Capture record and batch undo.** A Capture record is created when input is received, before interpretation; confirmation links every created item to it via `capture_id`. One action requests reversal of the whole batch through the conflict-aware Proposal and action-log mechanism in Section 11. It must not delete any item whose revision changed after apply or that acquired dependents; conflicts are shown for review.
6. **Source linking.** Each item links to its Capture and stores field-level evidence spans, so the user can see why it exists without duplicating `raw_text` or `redacted_text` into Task, Event, or Note rows.
7. **Confirmation on mobile** should support rapid accept and swipe-to-delete per item.

---

## 4. Today Screen

The Today screen should answer one question:

**"What should I do today?"**

Do not simply display a huge task list.

Organize today into:

### Fixed Events

Examples:

- 9:00 AM – Research meeting
- 1:30 PM – Appointment
- 7:00 PM – Dinner

These are calendar commitments that should not automatically move.

### AI-Planned Work Blocks

Examples:

- 10:15–10:45 AM – Reply to Laura
- 10:45–11:30 AM – MoKA regulatory work
- 3:30–5:00 PM – Manuscript analysis
- 7:30–9:30 PM – UWorld

These are flexible blocks generated from tasks.

### Tasks

Separate tasks into:

**Must Do:** important or deadline-sensitive tasks.
**Should Do:** important but less urgent items.
**Could Do:** low-priority or optional items.

Example:

- Must Do: Send revised IRB response; Complete follow-up
- Should Do: 40 UWorld questions; Read manuscript draft
- Could Do: Order household item; Organize notes

The Today page should feel calm and focused, not overwhelming.

### 4.1 Today additions (A)

1. **Capacity check.** Show scheduled minutes against available minutes for the day and warn when the day is overcommitted before it starts.
2. **Waiting For section.** Tasks with `task_kind = waiting_for` represent items other people owe the user, each with `waiting_for_person_id` and optional `nudge_date`. This Task kind ships in Phase 1; automatic detection from text is deferred to Phase 5 (Section 15).
3. **Focus timer** on any block, recording actual time against the estimate (Section 9.3).
4. **End-of-day roll-over prompt.** Incomplete items are explicitly rescheduled, postponed, or moved to Backlog. Nothing is silently carried to the next day.

---

## 5. Calendar

The calendar must combine:

- regular events
- appointments
- meetings
- social plans
- AI-generated work blocks
- study sessions
- task time blocks

There are two fundamentally different calendar item types:

### Hard / Fixed Events

Examples: meetings, appointments, dinner, flights, scheduled calls, events involving other people.

These should be visually distinguishable and should NOT automatically move.

### Flexible / AI-Scheduled Blocks

Examples: study, writing, manuscript work, administrative tasks, reading, errands.

These may automatically move when the calendar changes.

If a fixed meeting suddenly occupies a previously free period, the scheduling engine should be able to move flexible work to another available time.

An Event with `kind = block` and a non-null `task_id` is the authoritative scheduled-work-block model. A Task can have many blocks. `schedule_type = fixed` means the time is intrinsically committed and the scheduler never moves it. `schedule_type = flexible` means scheduler movement is permitted unless `is_locked = true`; locking is a user pin and does not convert the block into a fixed commitment.

The user should also be able to:

- drag calendar blocks
- resize duration
- lock/unlock blocks
- mark a flexible block as fixed
- manually reschedule
- unschedule a task while keeping it in the task list

All-day Events are shown but do not consume scheduler time; whole-day unavailability is a protected window (decisions.md 2026-09-05 "Scheduler engine rules"). Provide at least: day view, week view, month view if practical. Day and week views are the highest priority. `[Superseded by decisions.md entry: 2026-08-30 Release boundaries and phase ownership]` Phase 2 (V1) requires day view; week/month views are Phase 5 unless explicitly promoted by a later decision. `[Superseded in part by decisions.md entry: 2026-09-05 Week view promoted to Phase 2]` The week view is promoted to Phase 2; the month view remains Phase 5.

### 5.1 Calendar additions (A)

1. **Use a mature calendar component library** for rendering, drag, resize, collision layout, and mobile gestures (candidates: FullCalendar, Schedule-X; final choice recorded in `/docs/decisions.md` — FullCalendar v7 standard packages, 2026-09-05). The scheduler is custom; the visual calendar infrastructure is not. A custom calendar engine is explicitly out of scope.
2. **Change log for rescheduling.** When the engine moves blocks, present a diff ("moved Manuscript tables from Wed 19:00 to Thu 19:00") with a single revert. This is a Proposal (Section 11).
3. **Do-date versus deadline.** A task has a deadline (when it is due) and a stored do-date set by the scheduler. `[Superseded by decisions.md entry: 2026-08-30 Scheduled blocks and task timing]` Authoritatively, the Task keeps its deadline while planned work dates are derived from non-cancelled `kind = block` Events; `do_date` is not stored.
4. **Backlog and Someday buckets** for unscheduled items, so they do not clutter Today.

---

## 6. Projects

Tasks should not exist only as isolated items. The user needs projects.

Example project groups:

- WORK: Study A, Study B, Manuscript, Research administration
- CAREER: USMLE, Residency, CV, Networking
- PERSONAL: Home, Car, Immigration, Shopping, Finances

Each project page should show:

- project name
- description
- active tasks
- completed tasks
- upcoming deadlines
- scheduled work blocks
- notes
- related people
- recent activity
- percentage completed if meaningful

Allow nested structure: Area → Project → Task.

Example: Career → USMLE → Cardiology review → Complete 40 questions. `[Superseded by decisions.md entry: 2026-08-30 Authoritative Phase 1 data model]` In V1, only Area → Project → Task is persisted; deeper project nesting is deferred.

Use one hierarchical `Project` entity with `kind = area | project`. An `area` has no parent. A `project` may have one area parent in V1; project-to-project nesting is deferred. Enforce cycle prevention even though V1 permits only one level. Project removal is archive/soft-delete in V1; the only hard-delete path is conflict-aware undo of an unmodified create without dependents (Sections 9.5 and 11.2).

### 6.1 Projects additions (A)

1. **People entity** (lightweight): name, aliases, relationship or role, last contact date, open items involving them. No CRM features beyond this.
2. **Project health indicator:** overdue count and next deadline. No charts.
3. **Area-level rollup** (Work, Career, Personal) on the Projects screen.

---

## 7. AI Automatic Scheduling

This is one of the most important features. The system should not only track tasks. It should try to decide WHEN the user should do them.

Each task may contain:

- deadline
- estimated duration
- priority
- importance
- urgency
- project
- energy requirement
- context
- whether it can be split
- earliest possible date
- preferred time
- fixed vs flexible status `[Superseded by decisions.md entry: 2026-08-30 Scheduled blocks and task timing]`; fixed/flexible belongs to Event blocks, while a Task has `is_schedulable`

Example task: "Prepare manuscript tables"

Internal representation:

```
Project: Manuscript
Estimated duration: 120 minutes
Deadline: September 6
Priority: High
Schedulable: Yes
Splittable: Yes
Requires computer: Yes
Work type: Deep work
```

If there is a free 90-minute block Wednesday, the system might schedule Wednesday 7:00–8:30 PM "Prepare manuscript tables" and leave the remaining 30 minutes for another session.

The scheduler should:

1. Look at fixed calendar events.
2. Identify available free time.
3. Consider deadlines.
4. Consider estimated task duration.
5. Consider priority.
6. Consider preferred times.
7. Avoid overlapping items.
8. Prefer realistic work blocks.
9. Allow tasks to be split when appropriate.
10. Reschedule flexible tasks when conflicts occur.

Tasks without `remaining_estimate_minutes` are not scheduled automatically. The UI requests an estimate or allows the user to confirm one; the scheduler must not invent a duration. `remaining_estimate_minutes` is an explicit user- or Proposal-updated estimate and is not computed as estimated minus elapsed time.

The scheduling algorithm itself should be deterministic and rule-based where possible.

Do NOT rely entirely on the LLM for calendar arithmetic or conflict detection.

Use the LLM mainly for understanding natural language and extracting structured task information.

Use deterministic code for: date calculations, calendar conflicts, scheduling, duration calculations, recurring rules, ordering, time-zone handling.

### 7.1 Scheduling additions (A)

1. **Scheduling constraints are first-class settings:**
   - configurable availability windows by weekday; a 07:00–15:30 weekday job may appear only as illustrative sample data, never hard-coded scheduler logic
   - hard-unavailable/protected windows (the scheduler cannot use them without an explicit override)
   - soft preferred windows by work type and context (the scheduler may go outside them with a visible reason); “working hours” are not a universal validation boundary
   - whether time at the user's job is available for work-related tasks, configured separately from the job event itself
   - minimum and maximum block length
   - buffer minutes between blocks
   - daily deep-work cap
   - preferred windows by work type (e.g. study in the evening)
2. **Feasibility check.** For each task with a deadline and an explicit `remaining_estimate_minutes`, compute whether that estimate fits into remaining eligible free time before the deadline, and flag "will not make September 6 at current capacity" as early as possible. Tasks lacking a remaining estimate are flagged `estimate_required`, not treated as feasible.
3. **Estimate calibration.** Store actual versus estimated minutes per task and per work type; expose the ratio. Later phases use it to adjust estimates automatically (Section 9.3).
4. **Scheduler output is always a Proposal** (Section 11), never a direct mutation, so every automatic change is reviewable and, after apply, eligible for conflict-aware undo while its preconditions still hold.
5. **Composed operations** the scheduler must expose to the tool layer (Section 12.3): `plan_day`, `plan_week`, `lighten_day`, `reschedule_day`, `schedule_task`, `make_room_for`, `postpone_low_priority_tasks`. `find_free_time` is removed from this list `[Superseded by decisions.md entry: 2026-08-30 Cross-review: Phase 1 schema boundary, auth tables, and Event kinds]`: free-time lookup is the read-only primitive `get_free_time` (Section 12.3), which returns data, not a Proposal, so it cannot satisfy the rule that composed operations return Proposals.
6. **The scheduler is independently testable** with unit tests for conflict detection, splitting, constraint respect, and timezone edge cases (DST transitions included). The implemented rules — ordering, candidate scoring, splitting, the deep-work cap, hard versus soft deadlines, the diff against re-plannable blocks, and the twice-enforced no-overlap rule — are recorded in decisions.md 2026-09-05 "Scheduler engine rules" and live in `core/scheduler/`.

---

## 8. Important AI Behavior

The application should distinguish between:

- known information
- inferred information
- uncertain information

If the AI is uncertain, do not silently make a strong assumption.

Example input: "Send this sometime before Claudia's meeting."

If the app knows which Claudia meeting is relevant, it can suggest a deadline. If there are multiple possible meetings, show the uncertainty and ask the user to choose.

Use the authoritative enum `high | medium | needs_confirmation`; the UI may display these as “High confidence,” “Medium confidence,” and “Needs confirmation.”

The AI should never silently create misleading dates from ambiguous text.

### 8.1 Natural Language Date Understanding

The app should understand expressions like: tomorrow, tomorrow afternoon, Friday, next Friday, this weekend, next week, before my meeting, after work, tonight, in two hours, a few days before the deadline.

Resolve them against `UserSettings.current_timezone`, an IANA zone (default `America/New_York`). Always preserve the literal phrase, source span, relation/anchor, and resolver result so the interpretation can be reviewed. Flexible preferences follow `current_timezone` when the user travels; a fixed Event preserves its own IANA `timezone` and absolute instant.

**(A)** The extraction model returns only the literal temporal phrase, its source span, semantic relation (`on | before | after | within | duration_after`), any referenced stable entity ID, and confidence. Deterministic code is the sole authority that resolves a date/time from the phrase, request timestamp, current timezone, and referenced entity. An LLM-supplied datetime is non-authoritative evidence and is never persisted as the resolved value merely because it passes schema validation.

Date-only deadlines are stored as calendar `date` values with no UTC conversion. Timed deadlines and timed Events store an absolute UTC instant plus the separate IANA zone used to interpret/display them. All-day Events store local start/end dates plus their IANA zone, not midnight UTC.

**DST policy:** for a nonexistent local time during spring-forward, resolution returns `needs_confirmation` and suggests the first valid local time after the gap; it never silently shifts. For a duplicated fall-back time, resolution returns `needs_confirmation` with both offsets unless the source includes an offset or disambiguating instant. Fixed Events retain their original zone while travelling. Floating preferences and relative phrases use the current zone at resolution time.

### 8.2 Voice Memo / Brain Dump Mode

Voice input is important. The user should be able to speak naturally without organizing thoughts.

Example: "Okay, tomorrow I need to ask Claudia about the samples, email Dunia when I get home, look at flights, study cardiology sometime this weekend, and we also need groceries."

The app should transcribe this and create multiple structured items. `[Superseded by decisions.md entry: 2026-08-30 Voice and provider boundaries]` In Phase 1, the device/browser supplies text and AfHey processes it as a normal text Capture; AfHey does not receive or transcribe audio.

The UI should first show "Here's what I found," then show each detected item for confirmation.

This should feel extremely fast. The goal is to eliminate the friction of manually creating tasks one by one.

**(A)** Original: transcription uses a pluggable provider; Phase 1 may use browser Web Speech and add a server transcription API if quality requires it. `[Superseded by decisions.md entry: 2026-08-30 Voice and provider boundaries]` Authoritatively, Phase 1 accepts non-sensitive dictation through the iPhone keyboard microphone or browser Speech API only; no audio file is stored/uploaded and no external transcription API is used. Realtime conversational voice is a separate Phase 4 (V1.1) capability. Voice is always for non-sensitive content because transcript guarding cannot protect audio already received by a speech provider.

### 8.3 Priority System

Do not require the user to manually assign every task a priority. The app can calculate a suggested priority using: deadline proximity, importance, consequences of missing it, task age, project importance, dependencies, whether someone else is waiting for it.

Conceptual formula: Priority Score = Urgency + Importance + Consequence + Task Age + Context.

Store required integer `computed_priority_score` (0–100, default 50) separately from nullable `user_priority` (`must | should | could`). `effective_priority` is derived: the manual value wins; otherwise 70–100 = `must`, 40–69 = `should`, and 0–39 = `could`. AI recalculation may update only the computed score and must never overwrite the manual value. The score is produced by deterministic code from the inputs above; extraction may propose an initial value only through the normal Proposal flow. The deterministic recomputation job ships with Phase 2, where Today and the scheduler consume the score; Phase 1 stores proposed or default values. The interface presents the effective value and allows clearing the override.

---

## 9. Data Model

Unless a subsection says otherwise, Task, Event, Note, Person, Project, WorkSession, Conversation, and Message use the common mutable-record fields defined in Section 9.1. PersonAlias and GlossaryEntry are also common mutable records with their listed fields. Capture and immutable ActionLog use their explicitly listed fields; Proposal and ProposalOperation are defined in Section 11.1. FieldEvidence and TurnReferenceSet rows are immutable (opaque UUID `id` plus `created_at`; FieldEvidence literal text is nullable so it can expire, per Section 9.5). TaskPerson and EventPerson join rows carry composite uniqueness plus `created_at` and no revision.

### 9.1 Task

A task might contain:

```
id, title, description, status, created_at, updated_at
due_date, due_time
estimated_duration_minutes
priority, AI_priority_score
project_id
source_type, source_text
people
location
context
energy_level
work_type
is_splittable
is_schedulable
is_locked
earliest_start
preferred_time_window
deadline_type
AI_confidence
notes
completed_at
```

Do not blindly use this exact schema if a better implementation makes sense, but preserve these concepts.

`[Superseded by decisions.md entry: 2026-08-30 Authoritative Phase 1 data model]` The block above is historical input, not an implementation schema. The authoritative Task contract follows.

**(A) Task extensions:**

```
do_date                       (planned work date, distinct from deadline)
actual_duration_minutes       (sum of work sessions)
capture_id                    (link to the Capture that created it)
bucket                        (active | backlog | someday)
waiting_for_person_id         (for waiting_for items)
nudge_date                    (for waiting_for items)
```

`[Superseded by decisions.md entry: 2026-08-30 Scheduled blocks and task timing]` `do_date` and cached actual duration are not Task columns; planned dates come from block Events and actual time comes from WorkSessions.

**Authoritative Phase 1 Task contract**

- Common mutable-record fields: opaque UUID `id`; integer `revision` starting at 1 and incremented on every mutation; `created_at` and `updated_at` instants; nullable `archived_at`; boolean `ai_excluded` default false. Titles are never identifiers.
- Required: non-empty `title`; `status: open | completed | cancelled`; `task_kind: action | waiting_for | reminder`; `bucket: active | backlog | someday`.
- Nullable content: `description`, `notes`, `location`, `context`, `project_id`, `capture_id`. `project_id`, when present, references a `Project` row whose `kind = project`; Tasks cannot attach directly to an area.
- “Due” and “deadline” are UI synonyms; storage uses `deadline_*` only. A deadline is exactly one of: nullable date-only `deadline_date`, or nullable instant `deadline_at` plus required IANA `deadline_timezone`. Both modes may be absent but may not coexist. `deadline_type: hard | soft` is required when either deadline mode is present and otherwise null.
- `remind_at` and `reminder_timezone` are both required exactly when `task_kind = reminder`; a reminder uses the normal Task lifecycle and is not a separate object/table. Reminder delivery/notifications are deferred to Phase 6, but the Task can be viewed and completed in Phase 1.
- `waiting_for_person_id` is required exactly when `task_kind = waiting_for`; `nudge_date` is optional and is a calendar date. Other Task kinds must have both fields null. Automatic classification as `waiting_for` is deferred to Phase 5.
- `estimated_duration_minutes` and `remaining_estimate_minutes` are nullable positive integers. Remaining work is explicit and never inferred by subtracting WorkSession time. `is_splittable` and `is_schedulable` are required booleans; a task without a remaining estimate cannot be auto-scheduled.
- `user_priority: must | should | could` is nullable; `computed_priority_score` is a required integer from 0 through 100 with default 50; `effective_priority` is derived by the exact bands in Section 8.3 and is not stored.
- `energy_level: low | medium | high` and `work_type: deep | shallow | study | communication | errand | other` are nullable enums. `earliest_start_date` is a nullable calendar date. `preferred_window_start_time` and `preferred_window_end_time` are nullable local `time` values that must be both null or both present with start before end (no overnight Task preference in V1); they are interpreted in `UserSettings.current_timezone` at scheduling time.
- `confidence: high | medium | needs_confirmation` is nullable and applies to the item overall only for UI summarization; field-level confidence and source justification live in `FieldEvidence`.
- `completed_at` is non-null exactly when `status = completed`. Task↔Person is many-to-many through `TaskPerson(task_id, person_id, role nullable)`; no array-valued `people` column exists.

### 9.2 Event

Events should include: `id, title, description, start_datetime, end_datetime, timezone, location, people, project_id, fixed_or_flexible, locked, source, notes`. `[Superseded by decisions.md entry: 2026-08-30 Authoritative Phase 1 data model]`

Flexible events generated from tasks must maintain a relationship to their original task (`task_id`). If the calendar block moves, the task remains the same task.

**Authoritative Phase 1 Event contract**

- Common fields are the mutable-record fields defined in Section 9.1. Required fields: non-empty `title`; `kind: meeting | appointment | personal | block | other` (an earlier `deadline` kind is removed `[Superseded by decisions.md entry: 2026-08-30 Cross-review: Phase 1 schema boundary, auth tables, and Event kinds]`; an externally imposed date is a Task `deadline_*`, and calendar display of deadlines is derived at render time, never a stored Event); `schedule_type: fixed | flexible`; `block_state: planned | in_progress | completed | missed_unconfirmed | cancelled` for blocks and null otherwise.
- Timed Events store `start_at` and `end_at` as UTC instants plus a required, separately stored IANA `timezone`; `end_at > start_at`. All-day Events instead store `all_day_start_date` and exclusive `all_day_end_date` plus `timezone`. Timed and all-day representations are mutually exclusive.
- `task_id` is required exactly when `kind = block`; one Task may have many block Events. `project_id` is nullable and must reference `kind = project`. Event↔Person is many-to-many through `EventPerson(event_id, person_id, role nullable)`.
- `schedule_type = fixed` means the time is intrinsically committed and is never moved by the scheduler. `schedule_type = flexible` permits scheduler movement unless boolean `is_locked = true`. Locking is a user pin on a flexible Event, is independent of fixedness, and must be false for fixed Events.
- `block_state = in_progress` holds exactly while an active WorkSession (`stopped_at` null) references the block. When a planned block's end passes without a completion signal or linked WorkSession, set `block_state = missed_unconfirmed`. This means only “outcome not recorded”; it does not assert that the user failed to work. The task remains open and may be proposed for rescheduling.
- Nullable content: `description`, `location`, `notes`, `project_id`, `capture_id`. Source text is not copied. Reserve nullable sync provenance fields now: `source_provider`, `external_id`, `external_version`, `last_synced_at`, and `sync_status: local | synced | pending | conflict | error`; no synchronization is implemented before Phase 5.

### 9.3 Work session (A)

```
id, task_id, event_id (nullable), started_at, stopped_at, actual_duration_minutes, notes
```

`task_id` and `started_at` are required; `event_id`, `stopped_at`, and `notes` are nullable. At most one WorkSession is active (`stopped_at = null`) for the user. When stopped, `stopped_at > started_at`. `actual_duration_minutes` above is derived from those instants, not independently entered; a manual correction uses nullable positive `adjusted_duration_minutes` plus required `adjustment_reason`. WorkSession rows are the sole source of truth for actual Task duration; Task summaries use the corrected-or-derived sum. `event_id`, if present, must reference a block for the same `task_id`. Feeds estimate calibration and the "when did I last work on X" query.

### 9.4 Item types

The AI should support task, event, note, reminder as distinct object types. `[Superseded by decisions.md entry: 2026-08-30 Task kinds]` Extraction may label an item `reminder`, but it maps to Task with `task_kind = reminder`; it is not a separate persisted object type. Notes remain a distinct simple entity: common mutable-record fields plus required `body`, nullable `title`, `project_id`, `capture_id`, and field evidence.

**(A)** Add `waiting_for` as a first-class type (or task state) in Phase 1. `[Superseded by decisions.md entry: 2026-08-30 Task kinds]` It is authoritatively Task `task_kind = waiting_for`; automatic detection from text is deferred to Phase 5.

### 9.5 Additional entities (A)

- **Capture:** opaque UUID `id`, `revision`, nullable `raw_text`, nullable `redacted_text`, `source_type: typed | pasted | dictated`, `processing_status: received | redacted | proposed | processed | rejected | failed | no_ai` (`rejected` added by decisions.md entry: 2026-08-30 Capture rejected status), `ai_excluded`, timestamps, `raw_delete_after`, and the processing claim `processing_claim_key` (unique, nullable) with `processing_claimed_at` (added by decisions.md entry: 2026-09-05 Capture processing claim) — held by exactly one extraction attempt from before transmission until the Capture becomes `proposed` or `failed`; no-AI processing and rejection are refused while it is held, and a claim older than ten minutes is treated as abandoned. `raw_text` is required before deletion; `redacted_text` is required before an AI Proposal, null for `no_ai`, and stores the exact final guarded payload transmitted to the provider (entity placeholders included); FieldEvidence offsets index into it. There is no `proposal_id`; Proposal has nullable `capture_id`, allowing one Capture to have multiple processing Proposals. `rejected` is a terminal user resolution: the user declined the Capture at the redaction preview or rejected its extraction review without requesting re-extraction; it records a user choice, never a technical failure, and no items are created from a rejected Capture. Set `raw_delete_after` to 30 days after successful, no-AI, or rejected resolution (rejection clock added by decisions.md entry: 2026-08-30 Capture rejected status); when it passes, one expiry job nulls `raw_text`, `redacted_text`, and every related `FieldEvidence.literal_text`, while the rows themselves persist for links and audit. Failed/unprocessed Captures are discarded or resolved and never retained more than 30 days after creation. Action logs and extracted records do not duplicate raw text.
- **Person:** opaque UUID `id`, `revision`, required `name`, related `PersonAlias` rows with normalized uniqueness, nullable `role`, `last_contact_at`, `notes`, `ai_excluded`, and timestamps.
- **Project:** one hierarchy table with `kind: area | project`, `status: active | completed | archived`, required `name`, nullable `parent_id`, `description`, `importance: low | medium | high`, and (Phase 2) nullable `domain: work | personal` on areas only — projects inherit their area's domain, and job-time availability admits tasks whose area is `work` under the `work_related_only` policy. Areas require null parents; V1 projects may have one area parent only. Reject cycles. Archive/soft-delete is the only user-facing removal operation in V1 for every domain entity where removal is offered. The sole V1 hard-delete path is conflict-aware undo of a create operation (Section 11.2 Rule 9), rejected while dependent rows exist; ActionLog snapshots reference entities by UUID value without foreign keys, so immutable audit records survive undo deletion and never block it.
- **Proposal, Action log:** see Section 11
- **User / UserSettings / Credential / Session:** exactly one provisioned `User` row with opaque UUID, session-revocation version, and timestamps; no registration flow. `Credential` rows (`kind: password | passkey`, secret hash or public-key material, `created_at`, nullable `last_used_at`) belong to the User; at least one exists at provisioning. Sessions are database-backed `Session` rows (random token stored hashed, `created_at`, `expires_at`, `last_seen_at`, nullable `revoked_at`); rotation issues a new row, revocation marks rows revoked, and incrementing the User's session-revocation version invalidates all earlier sessions at once. Exactly one `UserSettings` row references the User and owns `current_timezone` (IANA, default `America/New_York`). Scheduler-constraint child rows belong to UserSettings and ship with the Phase 2 scheduler (decisions.md 2026-09-05 "Phase 2 migration"): `AvailabilityWindow` (ISO weekday, local `start_time`/`end_time`, `kind: general | job`, label), `ProtectedWindow` (`recurrence: weekly | once` with a weekday or a date, times, label), `PreferredWindow` (optional weekday, times, optional `work_type`, label), and one `SchedulerPreferences` row (`min_block_minutes`, `max_block_minutes`, `buffer_minutes`, `daily_deep_work_cap_minutes`, `job_time_policy: unavailable | work_related_only | any`, `planning_horizon_days`). Settings/constraints carry revisions and are versioned inputs to scheduler Proposals.
- **Conversation, Message:** see Section 12.5
- **Glossary entry:** `term`, `expands_to`, optional stable `entity_type` + `entity_id` (validated on every write against the table the type names; a linked entry is an acquired dependent that blocks undo-deletion of its target — decisions.md 2026-09-05 finding 18); glossary membership never exempts text from the privacy guard.
- **FieldEvidence:** one row per extracted field with `proposal_operation_id`, field path, start/end offsets into the Capture's transmitted `redacted_text`, nullable literal text, `confidence: high | medium | needs_confirmation`, and optional resolver metadata. When Capture text expires, the same job nulls the literal text; the row keeps field path, offsets, and confidence, and the UI presents the span as “source expired.”

All foreign keys use opaque UUIDs. Join rows use composite uniqueness. Phase 1 application validation and database constraints enforce every “exactly when,” mutual-exclusion, range, enum, and parent rule above.

**Phase 1 migration boundary.** Phase 1 migrations create exactly: User, Credential, Session, UserSettings (timezone only), Project, Task, TaskPerson, Person, PersonAlias, Event, EventPerson, Note, Capture, GlossaryEntry, WorkSession, Proposal, ProposalOperation, ActionLog, and FieldEvidence, including the reserved Event sync-provenance columns. Scheduler-constraint child tables are Phase 2 migrations: **the Phase 2 migration (2026-09-05) creates exactly `availability_window`, `protected_window`, `preferred_window`, and `scheduler_preferences`, adds `project.domain`, and adds generated full-text `search_vector` columns with GIN indexes to task, project, note, and event.** Conversation, Message, TurnReferenceSet, and the `Proposal.conversation_id` column with its foreign key are Phase 3b migrations; Phase 1 Proposals carry `capture_id` only, and the column's absence before Phase 3b is not a data-model violation.

---

## 10. Interface Requirements

### 10.1 UX Principles

A very clean, modern, minimal interface. Do NOT make it look like enterprise project-management software. Avoid excessive dashboards, huge sidebars, dozens of settings, clutter, unnecessary charts, excessive colors.

The product should feel closer to Things, Linear, Sunsama, Motion, Notion Calendar, Apple Reminders, but with an AI-first workflow. The primary experience should feel personal, fast, and calm.

### 10.2 Main Navigation

Original proposal: Inbox, Today, Calendar, Projects. Optionally Search / Ask, Settings. Keep navigation minimal.

**(A)** Updated navigation: **Today | Calendar | Inbox | Projects | AfHey**, with an AfHey entry point permanently accessible from every screen (text field "Ask AfHey anything..." plus a microphone button once voice exists).

### 10.3 Quick Add

There should always be an easy way to add something ("+ Add") opening the universal input. Typing "Call Alex Thursday around 5" should immediately create a mandatory-review Inbox Proposal for the appropriate item; it does not save immediately.

### 10.4 Editing

Every item must remain manually editable for fields that apply: title, date/time, duration, project, priority, notes, and Event `schedule_type`/lock. Fixed/flexible is not a Task field. Never trap the user inside AI-generated decisions.

### 10.5 Completing Tasks

Tasks support complete, uncomplete, postpone, reschedule, and delete (delete is archive per Section 9.5; the only hard delete is undo of a create). Completing a task marks its in-progress or most recently ended block `completed` and cancels its later planned blocks. If a scheduled block passes without completion, the task remains incomplete and becomes eligible for rescheduling.

### 10.6 Rescheduling

If an AI-planned flexible block reaches `missed_unconfirmed`, the system asks whether work occurred and may propose another time, e.g. "This block ended without a recorded outcome. Mark work done or reschedule?" V1 supports suggested rescheduling; it never treats elapsed time alone as user failure.

### 10.7 Search

Basic search across tasks, projects, notes, events, supporting natural keywords ("Claudia", "USMLE", "manuscript", "things due Friday"). Advanced conversational search comes through AfHey (Section 12).

### 10.8 Cross-cutting additions (A)

1. Command palette and keyboard shortcuts on desktop. **Phase 3b (V1).**
2. Data export to JSON and iCal at any time. Data is never locked in. **Phase 3b (V1).** Export covers active and archived domain records, Proposals/action logs, Conversations/Messages, settings, and any retained Capture text; secrets, password credentials, and already-expired Capture text are excluded.
3. Offline support: read Today, capture to a local queue, sync later. `[Superseded by decisions.md entry: 2026-08-30 Capture, offline, and multimodal scope]` **Deferred to Phase 5 (V2); review item 44.** Phase 1 is online only and has no offline queue or service-worker cache containing personal content.
4. Weekly review screen (read-only in V1): completed, slipped, due next week. `[Superseded by decisions.md entry: 2026-08-30 Release boundaries and phase ownership]` **Deferred to Phase 5 (V2).**
5. Conflict-aware undo is available for every reversible internal AI-originated change (Section 11). Irreversible external actions introduced after V1 are audit-only after explicit confirmation.
6. Basic keyword/filter search across Tasks, Projects, Notes, and Events ships in **Phase 2 (V1)**; conversational search ships with AfHey text in **Phase 3b (V1)**.

### 10.9 Persistence, Authentication, Mobile

- **Persistence:** a real database; data persists across sessions. Not a visual prototype with temporary state.
- **Authentication:** one provisioned user, no public registration. Support password or passkey authentication, secure `HttpOnly`/`Secure`/`SameSite` session cookies, CSRF protection on mutations, session rotation and revocation, rate limiting on authentication and AI endpoints, and no secrets in client code. OAuth and enterprise identity are out of scope.
- **Mobile:** must work very well on desktop and mobile. Voice capture and quick entry are especially important on mobile. Today must be excellent on a phone.

---

## 11. Proposal Model (A)

All AI-originated and scheduler-originated internal changes share one flow:

```
Intent → Proposal → Validation → Approval policy → Transaction → Action log → conflict-aware undo when eligible
```

A **Proposal** is a set of intended operations against the data model, computed but not yet applied. It is used in three places:

| Origin | Example |
|---|---|
| Inbox interpretation | "I found these 4 items. Accept or edit?" |
| Scheduler | "I propose moving these 3 blocks. Apply?" |
| AfHey action | "Your request would change these 5 things. Confirm?" |
| User | Conflict-aware undo of an applied Action; later user-initiated batch flows (see Section 11.2 Rule 13) |

### 11.1 Proposal structure

```
id, origin (inbox | scheduler | afhey | user), created_at
operations[]: { op, entity_type, entity_id (nullable), before, after, confidence, reason }
status: pending | approved | applied | rejected | reverted
approval_tier (0-3, see Section 12.6)
conversation_id (nullable), capture_id (nullable)
```

`[Superseded by decisions.md entry: 2026-08-30 Proposal concurrency, execution, and undo]` The sketch above is historical. The authoritative structure is:

- Proposal: opaque UUID `id`; integer `revision`; `origin: inbox | scheduler | afhey | user`; `status: pending | approved | applying | applied | rejected | expired | conflicted | failed | superseded | reverted`; unique `idempotency_key`; `approval_policy: explicit | tiered`; nullable `approval_tier` from 0 through 3 (required exactly when policy is `tiered`); `created_at`, `updated_at`, optional `expires_at`; nullable `conversation_id`, `capture_id`, `supersedes_proposal_id`, and `undoes_action_id`; nullable `approved_at`, `applied_at`, and failure/conflict details.
- ProposalOperation: opaque UUID `operation_id`; parent `proposal_id`; unique non-negative `sequence`; `depends_on_operation_ids` containing only earlier operations in the same Proposal; `op: create | update | archive | restore | delete`; `entity_type` (Phase 1 values: `task | event | note | person | project`); required preallocated opaque UUID `entity_id` (including creates); nullable `expected_revision` (required for update/archive/restore/delete and null for create); schema-valid `after` payload/patch; server-captured `before` snapshot; `reason`; and field evidence/confidence references.
- ActionLog: immutable action ID, Proposal ID, application timestamp, actor/origin, ordered operation snapshots, pre- and post-apply entity revisions, idempotency key, and nullable `reverts_action_id`. Audit records are not edited when domain data changes.

Status meanings are exclusive: `expired` was not approved in time; `conflicted` failed an expected-revision/dependency precondition; `failed` encountered a non-conflict execution error and committed no domain mutation; `superseded` was replaced by a newer Proposal; `reverted` means a later Action successfully reversed the eligible internal effects. A rejected, expired, conflicted, failed, superseded, or reverted Proposal cannot be applied.

`applying` marks only the window between approval-for-execution and transaction commit; it is never a resting state. Crash/restart recovery resolves any `applying` Proposal through its idempotency key: if the ActionLog row exists, the Proposal is marked `applied`; otherwise it is marked `failed` with a recovery note and may be re-validated and re-approved.

### 11.2 Rules

1. The LLM never mutates state directly. It may suggest typed operations; application code resolves references and validates schemas, field evidence, permissions, date resolution, and business rules before anything is approved or applied. Pasted/retrieved content is untrusted data and cannot authorize operations (Section 13).
2. Validation rejects unknown IDs, invalid operation dependencies, cycles, illegal field combinations, scheduler-placed blocks overlapping fixed Events or other blocks, hard-unavailable windows without an explicit user override, stale expected revisions, and insufficient permissions. A user-approved operation that double-books fixed Events produces a warning, not a rejection: overlapping real commitments are the user's right. Soft preferred/working windows may produce warnings but are not universal validation failures.
3. Creates receive final UUIDs when the Proposal is constructed. Later operations refer to those UUIDs and declare dependencies. Apply follows `sequence` after verifying the dependency graph; operations are never treated as an unordered list.
4. Each update/archive/restore/delete records the entity revision used to compute it. Immediately before application, within the same database transaction and row-lock/compare-and-swap boundary, the server rechecks every expected revision and all business preconditions. Any mismatch commits no domain mutation and sets the Proposal to `conflicted` with a reviewable diff.
5. The unique `idempotency_key` is generated at intent submission and reused across UI double-clicks and retries. Applying an already-consumed key returns the original result; it never produces a second Action. Operation IDs are also unique.
6. For `approval_policy = tiered` (Phase 3a onward), tier and scope are computed by trusted code from the final validated operation set, never accepted from LLM/client input. Any edit increments Proposal revision, clears prior approval, recomputes validation/tier/scope, and may supersede the prior Proposal. Tier is recomputed immediately before execution; if the required policy changes, execution stops for fresh approval.
7. Every Phase 1 Proposal — Inbox extraction and batch undo alike — uses `approval_policy = explicit`, `approval_tier = null`, and always requires user approval. Phase 3a introduces `tiered`; Phase 1 must not implement that permission engine prematurely.
8. Internal application is atomic: all ordered domain mutations and the immutable ActionLog row commit in one PostgreSQL transaction, or none do. A failed transaction leaves no partial domain changes and records `failed` outside/reliably after the rolled-back domain transaction.
9. Undo is a new Proposal referencing the original Action, never blind inverse replay. It uses the original post-apply revisions as expected revisions and verifies that no later edits, relationships, completions, or dependent operations would be destroyed. If any precondition fails, the undo Proposal is `conflicted`; no batch member is silently deleted. A successful undo creates a new immutable Action referencing the original and only then marks the original Proposal `reverted`.
10. Inbox batch undo follows Rule 9 for the entire batch. The UI may offer a newly validated partial corrective Proposal after a conflict, but it must describe exactly what will and will not reverse and require approval.
11. One Proposal model and shared review primitives are required, but each origin may use an appropriate presentation (Inbox cards, scheduler calendar diff, or AfHey action summary). A single universal UI component is not required.
12. **[Deferred: Phase 5; review item 7.]** The external-action execution model is not designed in V1, and no external side effect may be implemented until a later decision defines it.
13. `origin = user` covers user-initiated flows that run through Proposals: conflict-aware undo of an applied Action (Rule 9) and future user batch operations. Ordinary manual single-entity edits are direct transactional mutations that increment `revision` without a Proposal or ActionLog row in V1; Proposals detect them through expected-revision checks. Quick Add text is Inbox interpretation and keeps `origin = inbox`.

---

## 12. AfHey: Conversational Control Interface (A)

AfHey is the assistant's name. It is one assistant that knows the user's tasks, calendar, projects, notes, people, and conversations, and can both answer questions and take actions through the tool layer.

Example interaction:

> **User:** What does tomorrow look like?
> **AfHey:** Two fixed meetings at 9:00 and 13:30. The IRB response is due Thursday. You have about three free hours; I would put 90 minutes of IRB work at 10:15 and UWorld from 19:00 to 21:00.
> **User:** I'm going out tomorrow night. Move UWorld somewhere else.
> **AfHey:** Wednesday 18:30 to 20:30 is open. Move it there?
> **User:** Yes.

AfHey then applies the change through a Proposal.

### 12.1 Five layers

1. **Voice** (Phase 4, V1.1): the user speaks and hears responses. Implemented against the documented OpenAI Realtime API model current at build time; exact model IDs are verified and recorded at implementation rather than frozen by this specification.
2. **Brain:** a text reasoning model handles everyday requests. Complex requests (e.g. "redesign my Step 1 schedule for the next three weeks without endangering the manuscript deadline") may be routed to a stronger reasoning model. The brain is provider-agnostic (Section 12.7).
3. **Tools:** controlled functions over the application (Section 12.3). This is what distinguishes AfHey from a voice assistant with no access to the user's system.
4. **Memory:** the application database is the memory. The LLM is never responsible for remembering the user's life. "When did I last work on my CV?" is answered from work sessions and the action log.
5. **Personality:** a concise, intelligent chief of staff. Replies "Done." when that is sufficient; explains reasoning when asked ("Thursday is already crowded, the manuscript is due Friday, and your median time for this type of work is 82 minutes"). Not Iron Man cosplay.

### 12.2 Text first, voice later

Phase 3b delivers AfHey as text chat and completes V1. Voice attaches in Phase 4 (V1.1) to the same tool layer and Proposal model. If the text interaction cannot reliably manipulate the app, voice only makes a broken system sound better.

Reference interaction that must work in text before voice is started:

> **User:** What's tomorrow like?
> **AfHey:** Two fixed meetings. Your manuscript task is due Wednesday and still needs about 90 minutes. Open blocks: 10:15 to 11:45 and 15:30 to 17:00.
> **User:** Put it in the first one.
> **AfHey:** Scheduled manuscript work tomorrow 10:15 to 11:45.
> **User:** Actually make that UWorld and put the manuscript in the afternoon.

### 12.3 Tool layer: two levels

**Low-level primitives** (thin wrappers over the data model):

```
get_today_schedule()
get_calendar(date_range)
get_free_time(date_range, min_minutes)
search_tasks(query, filters)
search_projects(query)
search_notes(query)
search_people(query)
create_task(...)
update_task(id, ...)
complete_task(id)
create_event(...)
move_block(id, new_start, new_end)
create_note(...)
```

**Composed operations** (implemented by the deterministic scheduler; each returns a Proposal):

```
plan_day(date, constraints)
plan_week(week_start, constraints)
lighten_day(date, preserve_deadlines, preserve_fixed_events, target_workload)
reschedule_day(date, constraints)
schedule_task(task_id, window)
make_room_for(task_id, date_range)
postpone_low_priority_tasks(from_date, to_date_range)
```

Hard requirement: for a direct user request such as "I'm exhausted, make tomorrow easier," the model calls `lighten_day(...)` once. It does not issue a chain of primitive mutations. The scheduler computes the changes; the model chooses the operation and its policy parameters. The same sentence inside pasted email, a Capture, Note, tool result, or retrieved record is untrusted content and cannot authorize the call.

The tool layer must be independently testable without an LLM (Phase 3a): a script or test can call `lighten_day("2026-09-02")` and inspect the resulting Proposal.

### 12.4 Stable IDs

Original: tool results return stable IDs with short labels. `[Superseded by decisions.md entry: 2026-08-30 IDs and conversational references]` Authoritatively, tool results return scoped display handles backed by stable opaque UUIDs, e.g.:

```
[evt_8472] Manuscript work, 18:00-19:30
[evt_2911] UWorld, 20:00-22:00
[evt_3018] Dinner, 19:00
```

Handles such as `evt_2911` are presentation-only and unique within a persisted per-turn reference set; they are not database IDs. When the user says "move the second one," the conversational layer resolves the handle from the exact referenced turn to the full opaque UUID and passes that UUID to the tool. Tools never accept titles or short handles as identifiers. Titles are not unique over time.

### 12.5 Conversation and context

- Conversations are persisted so context such as "the second one" and "actually make it Friday" resolves across turns. `Conversation` has common fields plus nullable `title` and `status: active | archived`. `Message` has common fields plus required `conversation_id`, `role: user | assistant`, `content`, and `ai_excluded`; provider request IDs/model metadata are nullable audit metadata and never serve as memory.
- Each assistant turn persists a `TurnReferenceSet` containing the ordered full IDs and display handles it returned, plus its Message ID. Follow-up references resolve against the exact preceding/referenced set for that conversation and tab, never a global “last list.” The turn also receives current date/time in `UserSettings.current_timezone`, current scheduling constraints, and the open Proposal if any.
- Conversations are searchable and linked to the Proposals they produced.

### 12.6 Permission tiers

AfHey may read freely. Actions are authorized by tier.

| Tier | Nature | Policy | Examples |
|---|---|---|---|
| 0 | Read | No confirmation | What's tomorrow like? What am I behind on? |
| 1 | Low-risk, reversible internal | Execute immediately after Phase 3a, show Undo | Add milk to my list. Mark this done. Schedule a task tomorrow. |
| 2 | Meaningful restructuring | Preview and confirm when scope exceeds a threshold; otherwise execute and offer conflict-aware Undo | Reorganize tomorrow. Move all my study sessions this week. |
| 3 | Destructive or external | Explicit confirmation always; immutable audit; no Undo claim for irreversible effects | Archive this project. Cancel an external meeting. Send an email (once integrations exist). |

Base tier is a trusted property of each tool/operation, not decided by the model. Trusted policy code computes the effective tier from the final validated operation set and configurable scope thresholds after every edit and immediately before execution. Phase 1 Inbox bypasses auto-execution and always requires explicit approval; general tiers begin in Phase 3a.

### 12.7 Provider architecture

Do not build a single `AIProvider` abstraction for everything. Use separate interfaces:

```
TextReasoningProvider   (OpenAI in V1)
ExtractionProvider      (OpenAI in V1)
TranscriptionProvider   (no Phase 1 external implementation; reserved for a later decision)
VoiceRealtimeProvider   (OpenAI Realtime in V1.1; adapter is vendor-specific)
```

The business tool protocol (tool names, arguments, Proposal format) is provider-independent. The realtime transport is not, and no attempt should be made to make it so. Replacing the voice provider later means rewriting the voice adapter, not the scheduling system. Provider calls are confined to adapter modules; no direct vendor SDK calls elsewhere in the codebase. Business interfaces remain provider-agnostic even though OpenAI is the selected provider.

Structured outputs from any provider are validated with a schema library before use.

Server mediation is required for Phase 1 extraction and V1 text reasoning. Device/keyboard dictation is platform-controlled and receives no AfHey provider credential. If browser Speech API is enabled, it is a platform speech facility for non-sensitive text input and receives no long-lived app key. Phase 4 direct client→OpenAI realtime transport, when required, uses only short-lived, narrowly scoped credentials issued by the server. Long-lived API keys never reach the client. Voice remains restricted to non-sensitive content because raw audio reaches a speech service before transcript guarding is possible.

### 12.8 Voice layer (Phase 4, V1.1)

- Push-to-talk or tap-to-talk microphone button. No always-listening behavior in V1.1.
- Uses the documented Realtime API model current at build time; model IDs and pricing are recorded in `/docs/decisions.md` at that point.
- Same tool layer and Proposal/action-log rules as text.
- Realtime audio has a materially different cost profile from text; verify current pricing and measure daily text-AfHey usage before committing to Phase 4.
- Voice is for non-sensitive content only. Guard transcripts immediately before they reach the reasoning model, but do not describe transcript guarding as protection for raw audio already sent to the realtime provider.

### 12.9 Wake word (Phase 6, optional)

An always-listening wake word raises background microphone access, battery, OS restrictions, privacy, and desktop versus iPhone behavior. If pursued:

- Detection must run locally on the device; the room is never streamed continuously to a provider.
- "Hey AfHey" and "AfHey" are both candidate phrases to be tested against whichever wake-word engine is selected. No assumption about phrase length or syllable count is encoded in the architecture; performance is measured empirically at that time.
- A native app or a small always-on device may be required; the PWA cannot listen in the background.

### 12.10 Future multimodal input

Camera or screenshot understanding ("Look at this letter, do I need to do anything?") is deferred to Phase 5 (V2) behind `ExtractionProvider`. Phase 1 does not accept image shares. Candidate providers are evaluated when that phase begins; none is selected by this specification.

---

## 13. Privacy and Sensitive Data (A)

The user is a clinical research coordinator. Pasted work emails and messages may contain protected health information (PHI) and sensitive institutional data. Sending such content to an external LLM is not acceptable.

Rules, built from Phase 1:

1. **Policy:** V1 is for non-PHI information. Clinical details, patient identifiers, and institutional confidential data must not be entered into the app. Voice/dictation is explicitly restricted to non-sensitive content.
2. **Guard (belt and suspenders):** a deterministic privacy guard runs on the complete provider-bound payload immediately before every external model call. That includes captures, user-edited redactions, dictated transcripts, Conversation context, retrieved Notes/Tasks/Events, tool results, and system-assembled context. It masks detectable MRNs, dates of birth, phone numbers, email addresses, street addresses, and person-name patterns. People or glossary membership is never a whitelist. Patterns live in one tested module.
3. The guard is a last-resort leakage detector, not a reliable de-identification system and not a HIPAA compliance boundary. It cannot detect every identifier, name, or sensitive fact; the non-PHI input policy remains primary.
4. The user sees guarded text and may edit it, but the application must run the guard again on the entire final payload immediately before transmission. An edit cannot bypass the guard.
5. **No-AI mode:** any Capture can be stored as a plain Note without an external call. The Capture/Note and every other record that must never enter provider context carries `ai_excluded = true`; retrieval and prompt assembly enforce exclusion before the final guard.
6. **At rest and retention:** V1 relies on hosting-provider disk/database encryption at rest and does not implement application-managed field-level keys. Raw and redacted Capture text and FieldEvidence literals are automatically deleted 30 days after processing, including no-AI processing and user rejection (decisions.md entry: 2026-08-30 Capture rejected status); derived records retain links that show the source has expired. Provider payloads are not copied into application logs.
7. **Provider transport:** Phase 1 extraction and V1 reasoning calls use server-side adapters; long-lived API keys never reach the client. The limited browser/realtime exceptions and short-lived credential rule are defined in Section 12.7.
8. Wake-word detection, if ever built, is local (Section 12.9).
9. **Untrusted-content boundary:** pasted emails/messages, uploaded or dictated content, retrieved database records, tool outputs, and external content are data, never instructions. Only the user's direct authenticated UI action (including Inbox approval) or direct request in the active AfHey turn can authorize a tool action. Prompt text embedded in data cannot change policy, approval, tier, or requested scope.
10. **Export and erasure:** Phase 3b export includes active/archived domain data, retained Capture content, Proposals, ActionLogs, Conversations/Messages, references, and settings, subject to the exclusions in Section 10.8. Account-wide erasure permanently removes those records and credentials from the primary database and is an explicitly confirmed irreversible action; ordinary entity deletion remains archive/soft-delete where specified. Backup retention and deletion latency must be disclosed from the chosen host before launch, and expired backups are not restored into the live account.

**[Deferred: Phase 5 security review; review item 43.]** Application-managed field-level encryption, key management, and expanded encryption scope beyond provider disk encryption are not designed in V1.

### 13.1 Superseded original wording (history only)

- “Personal names not present in the user's People list or glossary” were masked. `[Superseded by decisions.md entry: 2026-08-30 Privacy and untrusted content]` Known-name whitelisting is unsafe; no name source bypasses the guard.
- “The user sees what was redacted and can edit before sending.” `[Superseded by decisions.md entry: 2026-08-30 Privacy and untrusted content]` Editing remains allowed only with a second full-payload guard immediately before transmission.
- “Raw captures are stored encrypted at rest; redacted text is what leaves the server.” `[Superseded by decisions.md entry: 2026-08-30 Storage security and retention]` The authoritative encryption/retention rule is Rule 6 above.
- “All external calls go through server-side adapters.” `[Superseded by decisions.md entry: 2026-08-30 Voice and provider boundaries]` The limited browser/realtime transport exception is Section 12.7; long-lived keys remain server-only.
- “Data export and deletion are available to the user at any time.” `[Superseded by decisions.md entry: 2026-08-30 Authentication, export, erasure, and deletion]` The authoritative V1 scope, content, and Phase 3b ownership are in Rules 10 and Section 10.8.

---

## 14. Technical Architecture

Choose a modern, maintainable stack. Reasonable default:

- **Frontend:** Next.js, React, TypeScript
- **UI:** Tailwind CSS, a high-quality component library where useful
- **Backend:** Next.js route handlers/server actions
- **Database:** PostgreSQL
- **ORM:** Prisma
- **AI:** OpenAI behind separate extraction and text-reasoning adapters; Phase 1 extraction uses the pinned model in `/docs/decisions.md`, while the Phase 3b reasoning model is selected, pinned, and evaluated before that phase
- **Phase 1 dictation:** iPhone keyboard microphone or browser Speech API for non-sensitive text input; no app-managed audio upload or external transcription API
- **Dates:** Luxon
- **Validation:** Zod
- **Tests:** Vitest and Playwright

If another architecture is more appropriate, explain why before using it and record it in `/docs/decisions.md`.

**(A) Additional architecture requirements:**

- Calendar rendering via a mature library (Section 5.1).
- PWA with `share_target` and offline capture queue. `[Superseded by decisions.md entry: 2026-08-30 Capture, offline, and multimodal scope]` Both are deferred to Phase 5 (V2); Phase 1 is online text capture only.
- Provider adapters as in Section 12.7.
- Structured-output validation with Zod at every LLM boundary.
- Cost control: target one successful LLM call per capture; permit a bounded maximum of two retries for transient provider or schema-validation failure, with backoff and the same intent idempotency key. No LLM runs in the scheduling loop.
- Secrets in server environment only; basic rate limiting on AI endpoints.

### 14.1 AI Extraction Format

When processing incoming text, the extraction adapter returns schema-versioned, untrusted candidate data. The authoritative contract is:

```json
{
  "schema_version": "1",
  "prompt_version": "configured-version",
  "items": [
    {
      "item_ref": "item-1",
      "depends_on_item_refs": [],
      "entity_type": "task",
      "fields": {
        "title": "Proposed title",
        "task_kind": "action",
        "estimated_duration_minutes": 10
      },
      "temporal_expressions": [
        {
          "field": "deadline",
          "literal": "tomorrow afternoon",
          "relation": "on",
          "anchor_entity_id": null,
          "evidence": { "start": 0, "end": 18 },
          "confidence": "needs_confirmation"
        }
      ],
      "entity_references": [
        {
          "field": "project_id",
          "candidate_ids": ["opaque-project-uuid"],
          "unresolved_literal": null,
          "evidence": { "start": 25, "end": 35 },
          "confidence": "high"
        }
      ],
      "field_evidence": []
    }
  ]
}
```

Each `field_evidence` entry additionally carries a nullable `quote`: the exact source substring the field derives from (added by decisions.md entry: 2026-09-05 Evidence spans are re-anchored from quoted text). Provider-supplied offsets are non-authoritative; trusted code re-anchors every span that carries a literal (temporal phrase, placeholder, or quote) to that text's nearest occurrence in the transmitted payload before validation.

Allowed `entity_type` values in Phase 1 are `task | event | note | person | project`; reminders and waiting-for items use `task_kind`. Extraction never proposes an Event with `kind = block`; block Events first exist in Phase 2, created by the scheduler or direct calendar actions. `item_ref` values are unique only within this provider response and express extraction dependencies; the model never invents database or operation UUIDs. Existing projects and people are referenced only by candidate stable IDs that trusted code supplied to the model. Unknown names remain `unresolved_literal` or become an explicit proposed Person/Project create item requiring approval; a free-text `project`/`people` value is never silently saved. Every proposed field that derives from source text has its own evidence span and confidence.

Zod validation proves only shape. Trusted application code additionally validates enumerations/invariants, entity permissions and revisions, reference resolution, evidence bounds, temporal expressions, duplicates, and business rules. It then preallocates final entity and `operation_id` UUIDs, translates item references into the ordered Proposal dependency graph in Section 11, and captures expected revisions. Deterministic date code produces all authoritative dates/times. Valid output becomes a mandatory-review Inbox Proposal; it is never saved directly.

### 14.2 Design principle: separate AI interpretation from application logic

AI answers: What does this message mean? What tasks are contained in this? What deadline is implied? What project does this probably belong to? Which composed operation matches this request?

Deterministic software answers: Is 3 PM available? Does this overlap another event? How many minutes are free? Where can a 90-minute task fit? What date is next Thursday? What exactly changes if we lighten Tuesday?

This distinction is important for reliability.

### 14.3 Testing (A)

- **Extraction evaluation suite:** 30 to 50 synthetic, non-sensitive messy inputs scored with field-level precision/recall or explicit tolerances; do not require exact whole-response equality from an online model. Run on prompt/model changes and record model, prompt version, dataset version, metrics, and acceptance result. Deterministic schema, invariant, resolver, and business-rule tests run in CI. Two datasets exist (decisions.md 2026-09-05 finding 22): eval-v1, 33 guarded-input smoke cases scored on provider output (`npm run eval:extraction`), and eval-v2, the 2026-09-05 review's 20 held-out cases run from raw capture through guard, resolution, provider, interpretation, and persisted Proposal fields, with per-category denominators, a false-positive count, and a gate that tolerates no critical (authoritative-date, privacy, authorization) failure (`npm run eval:pipeline`; the scripted-extraction variant runs in CI).
- **Scheduler unit tests:** conflict detection, splitting, constraints, buffers, DST and timezone edge cases, feasibility check.
- **Tool layer tests:** each composed operation called directly, with the resulting Proposal asserted (Phase 3a).
- **Privacy-guard tests:** pattern coverage, false-positive checks, `ai_excluded` enforcement, final-payload rerun, and prompt-injection boundary cases.
- **Proposal transaction tests:** idempotency, operation ordering/dependencies, stale-revision conflict, apply, conflict-aware undo, batch-undo conflict, tier recomputation, and partial-failure rollback.

### 14.4 Initial Sample Data

During development, populate the app with wholly fictional example projects, events, tasks, deadlines, flexible work blocks, people, and glossary terms. Names, organizations, institutions, and study labels appearing anywhere in this specification are illustrative only and must never be copied into seed data or test fixtures. Sample/evaluation data contains no real patient, person, or institutional information.

---

## 15. Build Phases (A)

Each phase ends with an independent review of the spec and code before the next begins. Use the app personally from the end of Phase 2 onward. **V1 = Phases 1–3b; V1.1 = Phase 4; V2 = Phases 5–6.**

Authoritative V1 ownership map (later explicit deferral markers override a section-level assignment):

| Phase | Owning requirements |
|---|---|
| Phase 1 | Section 3 online text Inbox; Section 6 base Projects/People; Sections 8–9 interpretation and data model; Sections 10.3–10.4 and 10.9 persistence/auth/mobile baseline; Inbox subset of Section 11; Sections 13–14 privacy, extraction, architecture, and Phase 1 tests |
| Phase 2 | Sections 4–5 Today/Calendar; Section 7 scheduler; Sections 10.5–10.7 completion/rescheduling/basic search |
| Phase 3a | General Proposal/tool/permission behavior in Sections 11, 12.3, and 12.6 |
| Phase 3b | Section 10.2 final navigation and Section 10.8 V1 cross-cutting items; Sections 12.2, 12.4–12.5, and text-reasoning parts of 12.7 |

Sections 1–2 are product/release framing; Section 18 is risk mitigation; Sections 19–20 are decision gates/workflow, not unowned features. Cross-cutting security, privacy, stable-ID, Proposal, testing, and mobile rules continue to apply after their owning phase.

**Phase 1: Foundation**
Authoritative database/data model per the Section 9 Phase 1 migration boundary (including Task kinds `waiting_for` and `reminder`, Capture, Person, Project hierarchy, Event blocks, WorkSession, GlossaryEntry, revisions, Proposal, and ActionLog); projects; tasks; events; notes; online text Inbox with OpenAI extraction, entity resolution, duplicate warning, field evidence, privacy guard, mandatory confirmation, idempotency, and conflict-aware batch undo; persistence; defined single-user auth (Credential and Session rows); minimal settings for `current_timezone` and glossary entries; raw-Capture and evidence-literal expiry job. Non-sensitive iPhone keyboard/browser dictation may supply text, but AfHey accepts/stores no audio. No image/screenshot input, PWA share target, offline queue, external transcription API, general AfHey tier engine, scheduler, block creation, or calendar UI.
Exit: type, paste, or device-dictate a messy non-sensitive paragraph, get schema-valid items with evidence and deterministic dates, confirm/edit them, safely apply once, close and reopen with everything saved; stale apply and unsafe undo tests pass.

**Phase 2: Time**
Choose and record the calendar rendering library before implementation; fixed events; deterministic scheduler with constraints (the UserSettings scheduler-constraint child tables and their editing UI ship here), explicit remaining estimates, and feasibility check; basic search; day view using the library; Today screen (fixed events, planned block Events, effective Must/Should/Could priority, Waiting For, capacity check, roll-over prompt); `missed_unconfirmed` handling and rescheduling Proposals.
Exit: flexible tasks are placed automatically into real free time; Today is usable daily on a phone.

**Phase 3a: Tool layer**
Primitives and composed operations; full UUID tool identifiers plus per-turn handles; effective permission tiers on the final validated operation set; conflict-aware undo wired to all eligible internal Proposals; direct tests calling each operation without an LLM.
Exit: `lighten_day(date)` and every other composed operation produce correct, validated Proposals under test.

**Phase 3b: AfHey text**
Chat UI accessible from every screen; Conversation/Message and per-turn reference-set persistence; reference resolution to UUIDs; OpenAI `TextReasoningProvider` adapter; prompt-injection boundary; tier-based approval flow; personality prompt; command palette/keyboard shortcuts; JSON/iCal export and account-wide erasure flow.
Exit: the reference interaction in Section 12.2 works reliably, including multi-turn corrections.

**Phase 4: Voice (V1.1)**
Push-to-talk for non-sensitive content; VoiceRealtimeProvider adapter against the documented Realtime model current at that time; transcript privacy guard before reasoning; same Proposal/tool/action-log rules.
Exit: spoken requests produce the same Proposals as typed ones.

**Phase 5: Integrations, capture, and learning (V2)**
Before implementation, separately design external-action execution/compensation (review item 7), field-level encryption/key scope if adopted (review item 43), and offline persistence/idempotency/cache privacy (review item 44). Then consider Gmail and Google Calendar synchronization; email forwarding; automatic waiting-for and commitment detection; morning/evening and weekly review; estimate calibration applied to scheduling; week/month views; PWA share target; offline capture; screenshots/images and other multimodal input. None is a V1 requirement.

**Phase 6: Ambient (V2)**
Wake word (local detection, phrases tested empirically); notifications; location-aware reminders; recurring routines and smart recurring tasks. Original Phase 6 camera/screenshot input is `[Superseded by decisions.md entry: 2026-08-30 Capture, offline, and multimodal scope]`; it is owned by Phase 5.

Do not overbuild later phases while earlier phases are unfinished. Drag-and-resize calendar interactions belong to Phase 2 or 3 only through the chosen library; if they consume disproportionate time, defer resize to Phase 5 and record the decision.

---

## 16. Future Features (from the original specification)

Design stable boundaries so these can be added later without making them current scope:

**V1.1:** realtime conversational voice only. **V2:** Gmail integration; Google/Apple Calendar synchronization; email forwarding; screenshot OCR and interpretation; PWA share/offline capture; text-message integration; automatic commitment/waiting-for detection; morning/evening/weekly review; recurring routines; learning scheduling habits; energy-aware scheduling; automatic follow-up suggestions; notifications; location-aware reminders; smart recurring tasks. “AI chat Ask My Life” is `[Superseded by decisions.md entry: 2026-08-30 Release boundaries and phase ownership]`; AfHey text is a Phase 3b V1 requirement, not future scope.

---

## 17. Version 1 Success Criteria

Version 1 is successful if the user can:

1. Open the app.
2. Type, paste, or use device/browser dictation for a non-sensitive messy paragraph; no audio upload is required.
3. Have the AI correctly extract several tasks/events.
4. Confirm or edit them.
5. See tasks organized under the correct projects.
6. See deadlines.
7. See fixed calendar commitments.
8. Have the app automatically schedule flexible tasks into available calendar time.
9. See a useful Today page showing what to do.
10. Complete, move, postpone, or reschedule tasks.
11. Close the app and return later with everything still saved.

**(A)** Additional criteria:

12. Ask AfHey in text what tomorrow looks like and get an answer computed from real data.
13. Tell AfHey to move or reschedule something and have it apply through a Proposal with conflict-aware Undo when the internal change remains reversible.
14. Ask AfHey to lighten a day and see a preview of changes before they apply.
15. Confirm that pasting text containing a phone number or MRN pattern results in redaction before any external call.
16. Export all data as JSON at any time.

The experience should already be useful enough to serve as the daily personal productivity system.

---

## 18. Technical Risks (A)

1. **Calendar UI cost.** Mitigated by using a library; resize can be deferred.
2. **Extraction reliability on messy input.** Mitigated by the versioned evaluation suite, field confidence/evidence, deterministic validation, and mandatory confirmation.
3. **Timezone and DST bugs.** Mitigated by Luxon, separate instant/zone or local-date storage as appropriate, the explicit resolution/travel policy in Section 8.1, and transition tests.
4. **LLM tool misuse (chains of primitives).** Mitigated by composed operations, Proposals, validation, and tier policy.
5. **PHI leakage.** Mitigated primarily by the non-PHI policy, plus `ai_excluded`, a final-payload deterministic leakage guard, no-AI mode, and retention limits. The guard is not treated as de-identification.
6. **Realtime voice API churn and cost.** Mitigated by text-first sequencing and a vendor-specific, thin voice adapter.
7. **Scope creep.** Mitigated by phase exit criteria and independent review at milestones.

---

## 19. Open Decisions (record outcomes in /docs/decisions.md)

1. Calendar rendering library for Phase 2: FullCalendar versus Schedule-X; decide and record before Phase 2 implementation. **Decided 2026-09-05: FullCalendar v7 standard packages (decisions.md "Calendar rendering library: FullCalendar v7 standard packages").**
2. Exact OpenAI text-reasoning model for Phase 3b; select with a versioned evaluation before Phase 3b implementation.
3. Hosting/database/backups; decide before deploying Phase 1 and record backup retention/deletion behavior.
4. Tier 2 scope thresholds; decide before Phase 3a implementation.

No Phase 1 scope or data-model choice remains open. Phase 1 extraction uses the pinned OpenAI model recorded in `/docs/decisions.md`; Phase 1 dictation uses device/browser facilities only; PWA share/offline/image input is Phase 5.

---

## 20. Development Approach

Do not immediately start coding blindly. First:

1. Translate this specification into a clear product architecture (`/docs/architecture.md`).
2. Define the main screens.
3. Define the data model.
4. Define the AI extraction pipeline.
5. Define the scheduling logic.
6. Define the user flow.
7. Identify technical risks.
8. Propose the best stack.
9. Then build the MVP incrementally, phase by phase, keeping this document current.

When making product decisions, prioritize usefulness, simplicity, reliability, speed, and clean UX over adding features.

The end product should feel like a personal AI executive assistant, AfHey, whose job is to turn everything the user needs to remember or do into an organized, realistic plan for their time.
