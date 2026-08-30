# Decision Log

Format: date, decision, alternatives rejected, reason. Newest at the bottom.

## 2026-08-30 Tooling
- Decision: Build with Claude Code (repository owner). Independent review by a second model at phase milestones.
- Installed: claude-code-setup, frontend-design, context7 (official plugins); Playwright MCP; GitHub via `gh` CLI.
- Rejected: GitHub MCP plugin (authentication failed; `gh` CLI covers the need).

## 2026-08-30 Scope
- Decision: AfHey (conversational control layer) is part of V1 architecture; text chat in Phase 3, voice in Phase 4.
- Decision: `waiting_for` is a first-class item type from Phase 1; automatic detection deferred to Phase 5.
- Decision: One unified Proposal model for Inbox, scheduler, and AfHey actions.

## 2026-08-30 Voice
- Decision: Voice layer will target the documented OpenAI Realtime API model current at Phase 4 (gpt-realtime-2.1 as of today). GPT-Live is not assumed to be API-available.

## Pending
- Calendar rendering library
- Date library
- Extraction and reasoning model selection
- Transcription provider for Phase 1
- Hosting and backups
- Tier 2 scope thresholds
