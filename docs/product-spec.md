# AfHey Personal Command Center

## Product and Implementation Specification

**Status:** Authoritative implementation specification. Version 1.0, 2026-08-30.
**Location:** `/docs/product-spec.md`. Companion documents: `/docs/architecture.md` (stack, libraries, service boundaries) and `/docs/decisions.md` (dated decision log, one entry per decision with the rejected alternative).
**Owner:** Afshin (product owner). **Implementer:** Claude Code (repository owner). **Reviewer:** an independent model reviews this document once before Phase 1 and again at each phase milestone.

### How to use this document

1. Read the whole document before writing code.
2. When implementation forces a change in architecture, data model, or scope, update this document in the same commit and add an entry to `/docs/decisions.md`. The specification must never lag behind the code.
3. Never delete a requirement. If a requirement is deferred, mark it `[Deferred: phase N, reason]` in place.
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
- voice memo
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
6. **(A)** AfHey, the conversational control interface (text first, voice later)

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
- record or upload a voice memo and convert it to text

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
- source text
- whether it can be automatically scheduled
- whether it is movable
- dependencies
- notes

Use structured data internally rather than storing everything only as text.

### 3.1 Inbox additions (A)

1. **Share sheet capture.** Build the app as an installable PWA with a `share_target` in the web manifest so an email, message, or screenshot can be shared directly from iOS or Android into the Inbox without opening the app first. This is what makes "copy it and it goes in" true on a phone.
2. **Sensitive content guard.** Before any text is sent to an LLM, run a local, deterministic redaction pass (see Section 13). Show the user what was redacted. Provide a "no AI" toggle that stores the capture as a plain note without any external call.
3. **Entity resolution against the user's own data.** The extraction prompt receives the current project list, people list, and a user-maintained glossary of aliases (e.g. "Bridget", "Claudia", "MoKA", "BCVI"), so input maps to existing records rather than creating duplicates.
4. **Duplicate detection.** Warn when an extracted item closely matches an open item (title similarity plus same project or same due window).
5. **Capture record and batch undo.** Every confirmation creates a Capture record linking all items created from it. One action reverts the whole batch. This uses the Proposal and action-log mechanism in Section 11.
6. **Source linking.** Each item keeps the original text and a link to its Capture, so the user can always see why an item exists.
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
2. **Waiting For section.** Items other people owe the user (an export permission, a signed form), each with a nudge date. This is a first-class item type from Phase 1; automatic detection from text is deferred (Section 15).
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

The user should also be able to:

- drag calendar blocks
- resize duration
- lock/unlock blocks
- mark a flexible block as fixed
- manually reschedule
- unschedule a task while keeping it in the task list

Provide at least: day view, week view, month view if practical. Day and week views are the highest priority.

### 5.1 Calendar additions (A)

1. **Use a mature calendar component library** for rendering, drag, resize, collision layout, and mobile gestures (candidates: FullCalendar, Schedule-X; final choice recorded in `/docs/decisions.md`). The scheduler is custom; the visual calendar infrastructure is not. A custom calendar engine is explicitly out of scope.
2. **Change log for rescheduling.** When the engine moves blocks, present a diff ("moved Manuscript tables from Wed 19:00 to Thu 19:00") with a single revert. This is a Proposal (Section 11).
3. **Do-date versus deadline.** A task has a deadline (when it is due) and a do-date (when the user plans to work on it). The scheduler sets do-dates; deadlines belong to the user.
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

Allow nested structure if possible: Area → Project → Task.

Example: Career → USMLE → Cardiology review → Complete 40 UWorld questions.

Do not overcomplicate nested hierarchy in the first implementation, but design the data model so it can expand later.

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
- fixed vs flexible status

Example task: "Prepare manuscript tables"

Internal representation:

```
Project: Manuscript
Estimated duration: 120 minutes
Deadline: September 6
Priority: High
Flexible: Yes
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

The scheduling algorithm itself should be deterministic and rule-based where possible.

Do NOT rely entirely on the LLM for calendar arithmetic or conflict detection.

Use the LLM mainly for understanding natural language and extracting structured task information.

Use deterministic code for: date calculations, calendar conflicts, scheduling, duration calculations, recurring rules, ordering, time-zone handling.

### 7.1 Scheduling additions (A)

1. **Scheduling constraints are first-class settings:**
   - working hours by weekday (the user's job runs roughly 7:00 to 15:30 on weekdays)
   - protected time (sleep, meals, exercise)
   - minimum and maximum block length
   - buffer minutes between blocks
   - daily deep-work cap
   - preferred windows by work type (e.g. study in the evening)
2. **Feasibility check.** For each task with a deadline, compute whether remaining work fits into remaining free time before the deadline, and flag "will not make September 6 at current capacity" as early as possible.
3. **Estimate calibration.** Store actual versus estimated minutes per task and per work type; expose the ratio. Later phases use it to adjust estimates automatically (Section 9.3).
4. **Scheduler output is always a Proposal** (Section 11), never a direct mutation, so every automatic change can be previewed and reverted.
5. **Composed operations** the scheduler must expose to the tool layer (Section 12.3): `plan_day`, `plan_week`, `lighten_day`, `reschedule_day`, `schedule_task`, `make_room_for`, `postpone_low_priority_tasks`, `find_free_time`.
6. **The scheduler is independently testable** with unit tests for conflict detection, splitting, constraint respect, and timezone edge cases (DST transitions included).

---

## 8. Important AI Behavior

The application should distinguish between:

- known information
- inferred information
- uncertain information

If the AI is uncertain, do not silently make a strong assumption.

Example input: "Send this sometime before Claudia's meeting."

If the app knows which Claudia meeting is relevant, it can suggest a deadline. If there are multiple possible meetings, show the uncertainty and ask the user to choose.

Use confidence states: High confidence, Medium confidence, Needs confirmation.

The AI should never silently create misleading dates from ambiguous text.

### 8.1 Natural Language Date Understanding

The app should understand expressions like: tomorrow, tomorrow afternoon, Friday, next Friday, this weekend, next week, before my meeting, after work, tonight, in two hours, a few days before the deadline.

Convert them into actual dates/times using the user's local timezone. Always preserve the original phrase in metadata so the interpretation can be reviewed.

**(A)** Relative date resolution is deterministic code given the LLM's extracted phrase and anchor; the LLM returns the phrase and, where unambiguous, its interpretation, and the resolver validates it.

### 8.2 Voice Memo / Brain Dump Mode

Voice input is important. The user should be able to speak naturally without organizing thoughts.

Example: "Okay, tomorrow I need to ask Claudia about the samples, email Dunia when I get home, look at flights, study cardiology sometime this weekend, and we also need groceries."

The app should transcribe this and create multiple structured items.

The UI should first show "Here's what I found," then show each detected item for confirmation.

This should feel extremely fast. The goal is to eliminate the friction of manually creating tasks one by one.

**(A)** Transcription provider is a pluggable adapter (Section 12.7). Phase 1 may use the browser Web Speech API; a server-side transcription API is added when quality requires it.

### 8.3 Priority System

Do not require the user to manually assign every task a priority. The app can calculate a suggested priority using: deadline proximity, importance, consequences of missing it, task age, project importance, dependencies, whether someone else is waiting for it.

Conceptual formula: Priority Score = Urgency + Importance + Consequence + Task Age + Context.

The exact score does not need to be shown to the user. The interface presents Must Do, Should Do, Could Do. The user must always be able to override the AI.

---

## 9. Data Model

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

**(A) Task extensions:**

```
do_date                       (planned work date, distinct from deadline)
actual_duration_minutes       (sum of work sessions)
capture_id                    (link to the Capture that created it)
bucket                        (active | backlog | someday)
waiting_for_person_id         (for waiting_for items)
nudge_date                    (for waiting_for items)
```

### 9.2 Event

Events should include: `id, title, description, start_datetime, end_datetime, timezone, location, people, project_id, fixed_or_flexible, locked, source, notes`.

Flexible events generated from tasks must maintain a relationship to their original task (`task_id`). If the calendar block moves, the task remains the same task.

### 9.3 Work session (A)

```
id, task_id, event_id (nullable), started_at, stopped_at, actual_duration_minutes, notes
```

Feeds estimate calibration and the "when did I last work on X" query.

### 9.4 Item types

The AI should support task, event, note, reminder as distinct object types. For Version 1, notes can be relatively simple. Example note: "Dr. Smith prefers REDCap exports in CSV format."

**(A)** Add `waiting_for` as a first-class type (or task state) in Phase 1. Automatic detection of waiting-for items from text is deferred to Phase 5.

### 9.5 Additional entities (A)

- **Capture:** `id, raw_text, redacted_text, source_type, created_at, proposal_id`
- **Person:** `id, name, aliases[], role, last_contact_at, notes`
- **Area / Project:** `id, name, parent_id (nullable), description, importance, status`
- **Proposal, Action log:** see Section 11
- **Scheduling constraints:** see Section 7.1
- **Conversation, Message:** see Section 12.5
- **Glossary entry:** `term, expands_to, entity_ref`

---

## 10. Interface Requirements

### 10.1 UX Principles

A very clean, modern, minimal interface. Do NOT make it look like enterprise project-management software. Avoid excessive dashboards, huge sidebars, dozens of settings, clutter, unnecessary charts, excessive colors.

The product should feel closer to Things, Linear, Sunsama, Motion, Notion Calendar, Apple Reminders, but with an AI-first workflow. The primary experience should feel personal, fast, and calm.

### 10.2 Main Navigation

Original proposal: Inbox, Today, Calendar, Projects. Optionally Search / Ask, Settings. Keep navigation minimal.

**(A)** Updated navigation: **Today | Calendar | Inbox | Projects | AfHey**, with an AfHey entry point permanently accessible from every screen (text field "Ask AfHey anything..." plus a microphone button once voice exists).

### 10.3 Quick Add

There should always be an easy way to add something ("+ Add") opening the universal input. Typing "Call Alex Thursday around 5" should immediately create the appropriate item.

### 10.4 Editing

Every item must remain manually editable: title, date, time, duration, project, priority, fixed/flexible, notes. Never trap the user inside AI-generated decisions.

### 10.5 Completing Tasks

Tasks support complete, uncomplete, postpone, reschedule, delete. Completing a task with a calendar block marks the related block accordingly. If a scheduled block passes without completion, the task remains incomplete and becomes eligible for rescheduling.

### 10.6 Rescheduling

If an AI-planned flexible block is missed, the system proposes another time, e.g. "You did not complete UWorld at 7 PM. Reschedule for tomorrow?" Version 1 must support automatic or suggested rescheduling.

### 10.7 Search

Basic search across tasks, projects, notes, events, supporting natural keywords ("Claudia", "USMLE", "manuscript", "things due Friday"). Advanced conversational search comes through AfHey (Section 12).

### 10.8 Cross-cutting additions (A)

1. Command palette and keyboard shortcuts on desktop.
2. Data export to JSON and iCal at any time. Data is never locked in.
3. Offline support: read Today, capture to a local queue, sync later.
4. Weekly review screen (read-only in V1): completed, slipped, due next week.
5. Undo is available after every AI-originated change (Section 11).

### 10.9 Persistence, Authentication, Mobile

- **Persistence:** a real database; data persists across sessions. Not a visual prototype with temporary state.
- **Authentication:** single-user; simple authentication is sufficient. Do not spend effort on enterprise authentication.
- **Mobile:** must work very well on desktop and mobile. Voice capture and quick entry are especially important on mobile. Today must be excellent on a phone.

---

## 11. Proposal Model (A)

All AI-originated and scheduler-originated changes share one flow:

```
Intent → Proposal → Validation → Approval policy → Transaction → Action log → Undo
```

A **Proposal** is a set of intended operations against the data model, computed but not yet applied. It is used in three places:

| Origin | Example |
|---|---|
| Inbox interpretation | "I found these 4 items. Accept or edit?" |
| Scheduler | "I propose moving these 3 blocks. Apply?" |
| AfHey action | "Your request would change these 5 things. Confirm?" |

### 11.1 Proposal structure

```
id, origin (inbox | scheduler | afhey | user), created_at
operations[]: { op, entity_type, entity_id (nullable), before, after, confidence, reason }
status: pending | approved | applied | rejected | reverted
approval_tier (0-3, see Section 12.6)
conversation_id (nullable), capture_id (nullable)
```

### 11.2 Rules

1. The LLM never mutates state directly. It produces or requests a Proposal; application code validates it against the schema and business rules before anything is applied.
2. Validation rejects operations that reference unknown IDs, violate constraints (overlap with a fixed event, outside working hours unless overridden), or exceed the requester's permission tier.
3. Application is transactional: all operations succeed or none do.
4. Every applied Proposal writes an **action log** entry containing the before and after state of each operation. Undo replays the inverse in a new transaction and marks the original as reverted.
5. Approval policy is decided by tier (Section 12.6) and by scope thresholds (e.g. more than N items changed escalates from execute-with-undo to preview-and-confirm).
6. The same UI component renders a Proposal regardless of origin.

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

1. **Voice** (Phase 4): the user speaks and hears responses. Implemented against the documented OpenAI Realtime API model current at build time (as of 2026-08-30, `gpt-realtime-2.1` and `gpt-realtime-2.1-mini`; the ChatGPT GPT-Live models were not yet callable API models and should not be assumed).
2. **Brain:** a text reasoning model handles everyday requests. Complex requests (e.g. "redesign my Step 1 schedule for the next three weeks without endangering the manuscript deadline") may be routed to a stronger reasoning model. The brain is provider-agnostic (Section 12.7).
3. **Tools:** controlled functions over the application (Section 12.3). This is what distinguishes AfHey from a voice assistant with no access to the user's system.
4. **Memory:** the application database is the memory. The LLM is never responsible for remembering the user's life. "When did I last work on my CV?" is answered from work sessions and the action log.
5. **Personality:** a concise, intelligent chief of staff. Replies "Done." when that is sufficient; explains reasoning when asked ("Thursday is already crowded, the manuscript is due Friday, and your median time for this type of work is 82 minutes"). Not Iron Man cosplay.

### 12.2 Text first, voice later

Phase 3 delivers AfHey as text chat. Voice attaches in Phase 4 to the same tool layer and the same action log. If the text interaction cannot reliably manipulate the app, voice only makes a broken system sound better.

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

Hard requirement: for a request such as "I'm exhausted, make tomorrow easier," the model calls `lighten_day(...)` once. It does not issue a chain of primitive mutations. The scheduler computes the changes; the model chooses the operation and its policy parameters.

The tool layer must be independently testable without an LLM (Phase 3a): a script or test can call `lighten_day("2026-09-02")` and inspect the resulting Proposal.

### 12.4 Stable IDs

Tool results return stable IDs with short labels, e.g.:

```
[evt_8472] Manuscript work, 18:00-19:30
[evt_2911] UWorld, 20:00-22:00
[evt_3018] Dinner, 19:00
```

When the user says "move the second one," the conversational layer resolves the reference to `evt_2911` and passes the ID to the tool. Tools never accept titles as identifiers. Titles are not unique over time.

### 12.5 Conversation and context

- Conversations are persisted (`Conversation`, `Message`) so context such as "the second one" and "actually make it Friday" resolves across turns.
- Each assistant turn has access to: the current date and time in the user's timezone, the scheduling constraints, the last returned ID list, and the open Proposal if any.
- Conversations are searchable and linked to the Proposals they produced.

### 12.6 Permission tiers

AfHey may read freely. Actions are authorized by tier.

| Tier | Nature | Policy | Examples |
|---|---|---|---|
| 0 | Read | No confirmation | What's tomorrow like? What am I behind on? |
| 1 | Low-risk, reversible | Execute immediately, show Undo | Add milk to my list. Mark this done. Schedule UWorld tomorrow. |
| 2 | Meaningful restructuring | Preview and confirm when scope exceeds a threshold; otherwise execute with Undo | Reorganize tomorrow. Move all my study sessions this week. |
| 3 | Destructive or external | Explicit confirmation always | Delete this project. Cancel the meeting. Send this email (once integrations exist). |

Tier assignment is a property of each tool and operation, recorded in code, not decided by the model. Scope thresholds for Tier 2 are configurable settings.

### 12.7 Provider architecture

Do not build a single `AIProvider` abstraction for everything. Use separate interfaces:

```
TextReasoningProvider   (OpenAI | Anthropic | Gemini)
ExtractionProvider      (OpenAI | Anthropic | Gemini)
TranscriptionProvider   (browser Web Speech | OpenAI | Deepgram | Whisper self-hosted)
VoiceRealtimeProvider   (OpenAI Realtime initially; adapter is vendor-specific)
```

The business tool protocol (tool names, arguments, Proposal format) is provider-independent. The realtime transport is not, and no attempt should be made to make it so. Replacing the voice provider later means rewriting the voice adapter, not the scheduling system. Provider calls are confined to adapter modules; no direct vendor SDK calls elsewhere in the codebase.

Structured outputs from any provider are validated with a schema library before use.

### 12.8 Voice layer (Phase 4)

- Push-to-talk or tap-to-talk microphone button. No always-listening behavior in V1.
- Uses the documented Realtime API model current at build time; model IDs and pricing are recorded in `/docs/decisions.md` at that point.
- Same tool layer, same Proposals, same action log as text.
- Realtime audio is priced per minute and costs far more than text; measure daily usage of text AfHey before committing.
- Voice input bypasses the paste-time redaction path, so the redaction pass must also run on transcripts before they reach the reasoning model (Section 13).

### 12.9 Wake word (Phase 6, optional)

An always-listening wake word raises background microphone access, battery, OS restrictions, privacy, and desktop versus iPhone behavior. If pursued:

- Detection must run locally on the device; the room is never streamed continuously to a provider.
- "Hey AfHey" and "AfHey" are both candidate phrases to be tested against whichever wake-word engine is selected. No assumption about phrase length or syllable count is encoded in the architecture; performance is measured empirically at that time.
- A native app or a small always-on device may be required; the PWA cannot listen in the background.

### 12.10 Future multimodal input

Camera or screenshot understanding ("Look at this letter, do I need to do anything?") is a future capability behind `ExtractionProvider`. Google's Live API and similar continuous multimodal services are candidates when that phase arrives. Not V1.

---

## 13. Privacy and Sensitive Data (A)

The user is a clinical research coordinator. Pasted work emails and messages may contain protected health information (PHI) and sensitive institutional data. Sending such content to an external LLM is not acceptable.

Rules, built from Phase 1:

1. **Policy:** V1 is for non-PHI information. Clinical details, patient identifiers, and institutional confidential data are not entered into the app.
2. **Guard (belt and suspenders):** a deterministic, local redaction pass runs before any external LLM call, on pasted text, dictated text, and voice transcripts alike. It removes or masks: medical record numbers, dates of birth, phone numbers, email addresses, street addresses, and personal names not present in the user's People list or glossary. Patterns are maintained in one module with tests.
3. The user sees what was redacted and can edit before sending.
4. **No-AI mode:** any capture can be stored as a plain note without an external call.
5. Raw captures are stored encrypted at rest; redacted text is what leaves the server.
6. All external calls go through server-side adapters; API keys never reach the client.
7. Wake-word detection, if ever built, is local (Section 12.9).
8. Data export and deletion are available to the user at any time.

---

## 14. Technical Architecture

Choose a modern, maintainable stack. Reasonable default:

- **Frontend:** Next.js, React, TypeScript
- **UI:** Tailwind CSS, a high-quality component library where useful
- **Backend:** Next.js backend or another clean API layer
- **Database:** PostgreSQL
- **ORM:** Prisma or equivalent
- **AI:** LLM API for extraction and interpretation
- **Voice:** speech-to-text API
- **Dates:** a reliable timezone-aware date library

If another architecture is more appropriate, explain why before using it and record it in `/docs/decisions.md`.

**(A) Additional architecture requirements:**

- Calendar rendering via a mature library (Section 5.1).
- PWA with `share_target`, offline capture queue, installable on iOS and Android.
- Provider adapters as in Section 12.7.
- Structured-output validation with a schema library (e.g. Zod) at every LLM boundary.
- Cost control: one LLM call per capture; a cheaper model for extraction where accuracy permits; no LLM in the scheduling loop.
- Secrets in server environment only; basic rate limiting on AI endpoints.

### 14.1 AI Extraction Format

When processing incoming text, use structured output, for example:

```json
{
  "items": [
    {
      "type": "task",
      "title": "Email Bridget about the study",
      "due_date": "...",
      "estimated_duration": 10,
      "project": "...",
      "confidence": "high"
    }
  ]
}
```

Validate AI output before saving it to the database. The LLM never directly mutates application state without validation. **(A)** Extraction output becomes a Proposal (Section 11).

### 14.2 Design principle: separate AI interpretation from application logic

AI answers: What does this message mean? What tasks are contained in this? What deadline is implied? What project does this probably belong to? Which composed operation matches this request?

Deterministic software answers: Is 3 PM available? Does this overlap another event? How many minutes are free? Where can a 90-minute task fit? What date is next Thursday? What exactly changes if we lighten Tuesday?

This distinction is important for reliability.

### 14.3 Testing (A)

- **Extraction regression suite:** 30 to 50 messy real-style inputs with expected structured outputs, run on every prompt or model change.
- **Scheduler unit tests:** conflict detection, splitting, constraints, buffers, DST and timezone edge cases, feasibility check.
- **Tool layer tests:** each composed operation called directly, with the resulting Proposal asserted (Phase 3a).
- **Redaction tests:** pattern coverage and false-positive checks.
- **Proposal transaction tests:** apply, undo, partial-failure rollback.

### 14.4 Initial Sample Data

During development, populate the app with realistic example data: projects Research, USMLE, Career, Personal; sample events, tasks, deadlines, flexible work blocks, a few people, and a glossary. Sample data contains no real patient or institutional information.

---

## 15. Build Phases (A)

Each phase ends with an independent review of the spec and code before the next begins. Use the app personally from the end of Phase 2 onward.

**Phase 1: Foundation**
Database and data model (including `waiting_for`, Capture, Person, Proposal, action log); projects; tasks; events; Inbox with extraction, redaction guard, confirmation as a Proposal, batch undo; persistence; simple auth.
Exit: paste a messy paragraph, get correct items, confirm, edit, close and reopen with everything saved.

**Phase 2: Time**
Fixed events; deterministic scheduler with constraints and feasibility check; day view using the calendar library; Today screen (fixed events, planned blocks, Must/Should/Could, Waiting For, capacity check, roll-over prompt); missed-block rescheduling as Proposals.
Exit: flexible tasks are placed automatically into real free time; Today is usable daily on a phone.

**Phase 3a: Tool layer**
Primitives and composed operations; stable ID conventions; permission tiers on every tool; action log and undo wired to all Proposals; direct tests calling each operation without an LLM.
Exit: `lighten_day(date)` and every other composed operation produce correct, validated Proposals under test.

**Phase 3b: AfHey text**
Chat UI accessible from every screen; conversation persistence; reference resolution to IDs; TextReasoningProvider adapter; tier-based approval flow; personality prompt.
Exit: the reference interaction in Section 12.2 works reliably, including multi-turn corrections.

**Phase 4: Voice**
Push-to-talk; VoiceRealtimeProvider adapter against the documented Realtime model current at that time; transcript redaction; same tools and action log.
Exit: spoken requests produce the same Proposals as typed ones.

**Phase 5: Integrations and learning**
Gmail and Google Calendar synchronization; email forwarding; automatic waiting-for and commitment detection; morning briefing and evening review; estimate calibration applied to scheduling; week and month views if not already complete; PWA share target if deferred from Phase 1.

**Phase 6: Ambient**
Wake word (local detection, phrases tested empirically); notifications; location-aware reminders; camera or screenshot input; recurring routines and smart recurring tasks.

Do not overbuild later phases while earlier phases are unfinished. Drag-and-resize calendar interactions belong to Phase 2 or 3 only through the chosen library; if they consume disproportionate time, defer resize to Phase 5 and record the decision.

---

## 16. Future Features (from the original specification)

Design Version 1 so these can be added later without major architectural changes, but do NOT make them the primary focus yet:

Gmail integration; Google Calendar synchronization; Apple Calendar integration; email forwarding; screenshot OCR and interpretation; text-message integration; automatic commitment detection; automatic "waiting for" tracking; morning briefing; evening review; recurring routines; AI chat "Ask My Life" (now AfHey, moved into V1 architecture); learning scheduling habits; energy-aware scheduling; automatic follow-up suggestions; notifications; location-aware reminders; smart recurring tasks.

---

## 17. Version 1 Success Criteria

Version 1 is successful if the user can:

1. Open the app.
2. Paste or dictate a messy paragraph.
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
13. Tell AfHey to move or reschedule something and have it apply through a Proposal with Undo.
14. Ask AfHey to lighten a day and see a preview of changes before they apply.
15. Confirm that pasting text containing a phone number or MRN pattern results in redaction before any external call.
16. Export all data as JSON at any time.

The experience should already be useful enough to serve as the daily personal productivity system.

---

## 18. Technical Risks (A)

1. **Calendar UI cost.** Mitigated by using a library; resize can be deferred.
2. **Extraction reliability on messy input.** Mitigated by the regression suite, confidence states, and mandatory confirmation.
3. **Timezone and DST bugs.** Mitigated by a single timezone-aware date library, storing UTC plus zone, and explicit tests.
4. **LLM tool misuse (chains of primitives).** Mitigated by composed operations, Proposals, validation, and tier policy.
5. **PHI leakage.** Mitigated by the policy plus the deterministic guard, and by no-AI mode.
6. **Realtime voice API churn and cost.** Mitigated by text-first sequencing and a vendor-specific, thin voice adapter.
7. **Scope creep.** Mitigated by phase exit criteria and independent review at milestones.

---

## 19. Open Decisions (record outcomes in /docs/decisions.md)

1. Calendar library: FullCalendar versus Schedule-X versus another.
2. Extraction model and text reasoning model at Phase 1; criteria are accuracy on the regression suite and cost per capture.
3. Transcription provider for Phase 1 voice memos (browser Web Speech versus server API).
4. Hosting for the database and app (single-user, low cost, backups enabled).
5. Scope thresholds for Tier 2 preview-and-confirm.
6. Whether the PWA share target ships in Phase 1 or Phase 5.

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
