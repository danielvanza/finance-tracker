# Shared bot kit — requirements

Approved 2026-11-15. Spans the new shared bot repo, household-finance, life-dashboard and roadmap-studio.

## Shared packages

### R-001 — One spec, two packages
The shared bot repo has a written spec and a Python package and a TypeScript package that both follow it.

**Acceptance:** The same scenario (ask, tool lookup, card, Apply, Undo, Stop, New chat) behaves the same in a Python app and in Roadmap Studio.

### R-002 — Four runners
Both packages can run a bot on Claude Code CLI, a Claude API key, Codex CLI and an OpenAI API key.

**Acceptance:** In each of the three apps, a question that needs a tool lookup gets a correct answer on Claude Code CLI, a Claude API key and Codex CLI. The OpenAI API runner is built in both packages; until Daniel has an OpenAI API key, it is accepted on its failure cases (no key, rejected key, rate limit) plus a tool call and answer against a fake local server. Its correct-answer check in the three apps is deferred (see below).

### R-003 — Runner picker per conversation
The bubble has a picker for runner and model that applies to the current conversation.

**Acceptance:** Switching the picker changes which runner answers the next message; the choice is still set after closing and reopening the bubble.

### R-004 — No silent fallback
When the picked runner cannot run, the reply fails with a plain reason and nothing changes.

**Acceptance:** With a runner logged out, rate limited or missing its key, the reply says why, no other runner answers, no data changes, and runners known to be unavailable are greyed out in the picker.

### R-005 — Only the app's tools
On every runner, the bot can use only the tools its app supplies.

**Acceptance:** The bot cannot run shell commands, read files, or call any tool its app did not list, on any of the four runners.

### R-006 — Card or immediate-with-Undo, per kind of change
Each app declares, for each kind of change, whether it goes on a card or happens immediately with Undo.

**Acceptance:** A card change alters nothing until Apply; tapping Apply twice applies it once; if the data changed since the card was made, a fresh preview is shown instead of applying. An immediate change happens at once and shows an Undo that restores the previous state.

### R-007 — Starter buttons
Each app supplies starter buttons, shown at the top of an empty chat; the app may vary them by page or time of day.

**Acceptance:** In an empty chat the app's starters show; tapping one sends its text as the person's message; once the chat has messages they are no longer shown; an app can show different starters on different pages or times.

### R-008 — Shared bubble basics
All three bots have a live step log, Stop, New chat, and a written-up partial answer when the time limit is reached.

**Acceptance:** In each app: steps appear while a reply is worked on; Stop ends it and a partial answer follows; New chat starts an empty conversation; a reply that hits the time limit ends with what was found so far.

## Finance

### R-009 — Finance unchanged for its users
Household-finance runs on the Python package with everything it does today still working.

**Acceptance:** Cards, questions about unsure payments, bank-file imports, photos, voice notes, unprompted messages and the shared Telegram group all behave as before the move.

### R-010 — Telegram in the Python package
The Telegram front is part of the Python package; in this feature only finance uses it.

**Acceptance:** The finance Telegram group works as before; LifeSystem and Roadmap Studio have no Telegram chat.

## LifeSystem

### R-011 — Arnold's day plan removed
LifeSystem's plan feature is removed entirely: its screens, its backend, its stored proposals and change history, and the Hermes morning run that started it.

**Acceptance:** No Arnold card, note or change list appears anywhere in LifeSystem; the Hermes morning planning job no longer exists; the lifesystem map reflects this; task times and calendar events created by earlier schedules remain and keep matching their tasks.

### R-012 — Planning bot, on request only
LifeSystem has a bubble with a productivity planning agent (not Arnold) that plans only when asked.

**Acceptance:** Asking it to plan, for example with a "Let's plan my day" starter, produces a plan for the day; it never posts or changes anything unprompted.

### R-013 — Based on researched productivity methods
The planning agent's instructions are based on research into common productivity systems, written down with sources.

**Acceptance:** A written research note with sources exists, and the agent's instructions name the methods they draw on.

### R-014 — Small changes immediate, the rest on cards
In LifeSystem, moving a task to today, filing it into a project, setting a time, rewriting it and splitting it happen at once with Undo; deleting, merging, a full-day schedule and anything touching the calendar go on a card.

**Acceptance:** Each of the five small changes takes effect immediately and can be undone; each of the other changes waits for Apply.

### R-015 — Calendar
The planning agent reads the calendar and tasks; a schedule it proposes, on Apply, sets task times and creates calendar events kept in step with their tasks.

**Acceptance:** The agent plans around existing appointments; applying a schedule card sets the task times and creates one event per task; later changes to those tasks are reflected in their events.

### R-016 — Second brain read-only
The planning agent can search and read the Brain vault and never writes to it.

**Acceptance:** It can use notes such as current focus and goals in its answers; no file in the vault is created, changed or committed by it.

## Roadmap Studio

### R-017 — Assistant rebuilt fresh
Roadmap Studio's assistant is rebuilt on the TypeScript package, and the old assistant code is removed.

**Acceptance:** The new assistant can read the course and the learner's progress, edit lessons with undo and redo, read and write notes, run code and track progress (mark steps finished, record quiz evidence), and start generation jobs once their current implementation has been reviewed; the previous assistant implementation is gone.

## Bubble visuals (added 2026-11-15, revision 1)

### R-018 — Default bubble, fully replaceable
The package ships a default bubble UI that an app can use as it is, or the app can build its own UI on the package's behaviour and data.

**Acceptance:** An app can show its own chat UI using only the package's public interface; whichever UI is used, nothing changes without Apply on a card, Undo restores an immediate change, and no other runner answers when the picked one cannot run.

### R-019 — Default bubble fits each app
The default bubble follows the host app's colours, fonts and day/night theme.

**Acceptance:** In each app that uses the default bubble it matches that app in both themes, and it is usable at phone width (390 px) and desktop width with no overflowing or clipped text.

### R-020 — Default bubble starts from the polished finance chat
The default bubble keeps the changes chosen in the `/visual-polish` pass on finance's current chat, done before the extraction.

**Acceptance:** Every option chosen in that pass is present in the default bubble.

## Change history

- 2026-11-15: R-001 to R-017 approved.
- 2026-11-15, revision 1: R-018 to R-020 added (bubble visuals), approved.
- 2026-11-15, clarifications during execution (no requirement changed):
  - R-011: the whole Hermes "Daily plan" job goes, including its 07:00 coach message and the Brain `plans/YYYY-MM-DD.md` note it wrote; Today's section showing that note is removed with it. Hermes's mentions of "today's plan", Brain `AGENTS.md` and the lifesystem map are updated. History questions ("my plans of the last 7 days") are answered from what is already recorded: calendar events from applied schedules, completed tasks and the evening check-in's journal. The live Hermes pieces (cron job, `day-plan` webhook route, skill link, `plan` CLI link, `HERMES_PLAN_URL`) are removed during this work.
  - R-016: the planning agent reads the Brain (search, goals, `now.md`, journals, older plans, projects) on request; it never writes.
  - R-002: Daniel has no OpenAI API key; the OpenAI API runner is built and its failure cases tested, but its correct-answer check cannot run and is reported as unverified.
- 2026-11-16, revision 2: R-002 acceptance changed by Daniel after the first review. The OpenAI API runner counts on its failure cases and a fake-server tool run; its real correct-answer check is deferred until there is a key. Also recorded: the evening check-in (21:00) still writes tomorrow's `plans/` draft when Daniel gives direction, so those notes remain part of the recorded history (R-011).

## Deferred or retired

- R-002, OpenAI API runner correct-answer check in the three apps: deferred until Daniel has an OpenAI API key (2026-11-16).
