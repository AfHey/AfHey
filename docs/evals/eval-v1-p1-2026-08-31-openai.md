# Extraction evaluation — eval-v1-p1-2026-08-31-openai

- Run at: 2026-09-05T02:17:55.158Z
- Provider / model: openai / gpt-5.4-mini-2026-03-17
- Prompt version: p1-2026-08-31
- Dataset version: eval-v1 (33 fictional cases)
- Acceptance: **FAIL**

## Metrics

| Metric | Value |
|---|---|
| Item precision | 97.3% |
| Item recall | 97.3% |
| Item F1 | 97.3% |
| task_kind accuracy | 100.0% |
| event_kind accuracy | 100.0% |
| Duration accuracy | 100.0% |
| Temporal literal recall | 92.0% |
| Reference recall | 100.0% |
| Evidence validity | 88.6% |
| Literal ↔ evidence alignment | 27.6% |
| Hallucinated ids | 0 |
| Provider errors | 0 |

## Acceptance checks

| Check | Threshold | Actual | Result |
|---|---|---|---|
| item recall | ≥ 85% | 97.3% | pass |
| item precision | ≥ 85% | 97.3% | pass |
| task_kind accuracy | ≥ 85% | 100.0% | pass |
| temporal literal recall | ≥ 85% | 92.0% | pass |
| reference recall | ≥ 90% | 100.0% | pass |
| evidence validity | ≥ 95% | 88.6% | FAIL |
| hallucinated ids | = 0 | 0 | pass |
| provider errors | = 0 | 0 | pass |

## Per-case notes

- `agenda-note`: 1/1 matched, 0 extra
- `all-day-personal`: 0/1 matched, 1 extra — missed: cabin; extra: note "cabin trip next weekend"
- `ambiguous-person`: 1/1 matched, 0 extra
- `appointment-explicit-date`: 1/1 matched, 0 extra
- `before-ordinal`: 1/1 matched, 0 extra
- `bill`: 1/1 matched, 0 extra
- `brain-dump`: 3/3 matched, 0 extra
- `call-family`: 1/1 matched, 0 extra
- `duration-and-window`: 1/1 matched, 0 extra
- `email-paste`: 2/2 matched, 0 extra
- `expires-month`: 1/1 matched, 0 extra
- `grocery-list`: 1/1 matched, 0 extra
- `iso-hard-deadline`: 1/1 matched, 0 extra
- `lunch-event-with-person`: 1/1 matched, 0 extra
- `meeting-with-time`: 1/1 matched, 0 extra — temporal missed: thursday 3pm
- `month-only`: 1/1 matched, 0 extra
- `multi-task-with-person`: 3/3 matched, 0 extra
- `next-weekday`: 1/1 matched, 0 extra
- `non-actionable`: 0/0 matched, 0 extra
- `note-with-project`: 1/1 matched, 0 extra
- `plain-note`: 1/1 matched, 0 extra
- `prepare-for-review`: 1/1 matched, 0 extra
- `project-reference-end-of-month`: 1/1 matched, 0 extra
- `prompt-injection`: 1/1 matched, 0 extra
- `redacted-token`: 1/1 matched, 0 extra
- `relative-weeks`: 1/1 matched, 0 extra
- `reminder-time`: 1/1 matched, 0 extra
- `simple-errand`: 1/1 matched, 0 extra
- `single-task-no-date`: 1/1 matched, 0 extra
- `single-task-tomorrow`: 1/1 matched, 0 extra
- `time-and-day`: 1/1 matched, 0 extra
- `two-people`: 1/1 matched, 0 extra
- `waiting-for`: 1/1 matched, 0 extra
