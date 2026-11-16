# Shared bot kit — brainstorm

## Starting point and direction

Daniel wants the same kind of in-app bot in household-finance, LifeSystem (life-dashboard) and Roadmap Studio, each with its own tools supplied by its app, runnable through headless Claude Code as well as with an API key and Codex. The finance bot is the most complete one, so it is the source of the extraction.

Converged direction: a new shared bot repo, extracted from the finance bot, holding a Python package and a TypeScript package that follow one written spec. Finance moves onto the Python package without visible change. LifeSystem's Arnold day-plan feature is removed and replaced by a productivity planning bot on the Python package. Roadmap Studio's assistant is rebuilt fresh on the TypeScript package. Every app supplies its own tools, instructions and starter buttons; the bubble, runner picker, cards, Undo, Stop and New chat are shared.

This feature folder lives in household-finance because the kit is extracted from it; the feature spans four repositories (the new repo, household-finance, life-dashboard, roadmap-studio).

## Decisions

- **Scope:** everything in one feature: the kit, finance on it, LifeSystem plan replacement, Studio rebuild, starter buttons.
- **Extract from finance, not Studio:** finance is Python like LifeSystem, the most complete (cards with preview/apply, Stop, New chat, Telegram, end-to-end tests) and had no open-source constraint. Studio's provider interface (`server/providers/types.ts`) and launch-shape checks are worth borrowing.
- **Shape:** two packages (Python, TypeScript) following one written spec, rather than a shared service.
- **Studio's standalone/open-source requirement is dropped.** This deliberately reverses the 7 November decision (Brain: `decisions/roadmap-studio-microfrontend.md`).
- **Runners:** Claude Code CLI, Claude API key, Codex CLI, OpenAI API key — all four.
- **Choosing a runner:** a picker in the bubble, per conversation (runner and model).
- **Unavailable runner:** say why, change nothing, never fall back to another runner; grey out runners known to be unavailable.
- **Starter buttons:** supplied by the app, shown at the top of an empty chat; the app may vary them by page or time.
- **Changes:** per app and per kind of change, either a card (nothing happens until Apply) or immediate with Undo.
- **LifeSystem bot:** not Arnold. A productivity planning agent whose instructions are based on researched productivity methods. Plans only on request; the Hermes morning run is removed.
- **LifeSystem immediate changes:** move to today, file into a project, set a time, rewrite, split. Delete, merge, full-day schedule and calendar changes go on a card.
- **Calendar:** read for planning; a schedule card on Apply sets task times and creates events kept in step with their tasks.
- **Second brain:** read-only access for the LifeSystem bot. Writing stays with Hermes and Claude Code.
- **Studio:** rebuild fresh. Brought back: read course and progress, edit lessons (undo/redo), notes, run code and progress tracking, generation jobs after a review of how they work now.
- **Telegram:** part of the Python package; only finance uses it in this feature.
- **Old plan data:** proposals and change history are deleted; task times and calendar events from earlier schedules stay and keep matching their tasks.

- **Bubble UI (revision 1):** the package ships a default bubble; apps may replace the UI entirely and build on the package's behaviour and data. The shared rules (Apply, Undo, no fallback) are enforced below the UI so they hold under any UI.
- **Visual polish (revision 1):** a `/visual-polish` pass on finance's current chat runs now, before the extraction, so the default bubble starts from a polished base.

## Alternatives considered

- Bubble customisation through tokens and fixed slots only, or one fixed look for every app: rejected for a default plus fully replaceable UI.
- Polishing after the build, or as a separate later task: rejected; polish finance's chat first.

- Scope "kit + LifeSystem" (Studio later), "kit + finance only", and "copy finance's code into LifeSystem, extract later": rejected; Daniel chose the full scope.
- One shared bot service over HTTP: rejected in favour of two packages, avoiding a new service.
- Python package with Studio keeping its own runner: rejected.
- Making the kit open-sourceable or vendoring it into Studio to keep Studio publishable: rejected; the requirement was dropped instead.
- Runner chosen per app in settings, or fixed in config: rejected for the per-conversation picker.
- Automatic fallback or ask-before-fallback when a runner is unavailable: rejected.
- Starters always on top / fixed lists only: refined to app-defined, empty-chat, page- or time-dependent.
- Every change on a card: rejected for LifeSystem small changes, which should be quick.
- A morning message or morning plus on-request planning: rejected; on request only.
- Brain read plus proposed notes, or free writing: rejected; read only.
- Studio keeping today's abilities as-is, or adding new tools: rejected for a fresh rebuild.
- Telegram for LifeSystem too, or no Telegram in the package: rejected.
- Calendar read-only or no calendar: rejected.

## Grounding notes

- Finance bot: `backend/assistant/` (brain.py, tools.py, service.py, actions.py, prompts.py, queries.py), `backend/categorizer/claude_cli.py`, `backend/telegram_bot.py`, `frontend/src/chat/`. Tools reach the CLI as a per-reply loopback MCP server; prompt on stdin, system prompt as `--system-prompt`.
- Studio assistant: `server/providers/` (Provider with `run`/`runAgent`, claude and codex adapters), `server/assistant/` (tools.ts with tools such as read_outline, read_step, edit_step, edit_exercise, propose_edit, plan_ops, read_notes, write_note, run_code, start_job, mark_finished, record_quiz_evidence, undo_change, redo_change; mcp.ts loopback endpoint).
- LifeSystem plan feature: `backend/app/dayplan/` (api.py, service.py: Arnold's morning pass via Hermes, auto changes `move_today`/`file`/`time`, proposals, Calendar events and `reconcile`), `frontend/src/dayplan/` (ArnoldCard, ArnoldChanges, ArnoldNote, usePlan), used from Today, Tasks, Agents and HabitsCard pages.
- Recaps explaining the finance bot: https://plan.agent-native.com/recaps/recap-305746417c734942 and https://plan.agent-native.com/recaps/recap-87a814356e364669 (private).
- Machine rules (`~/.claude/CLAUDE.md`): removing the Hermes morning job and any new automation must be reflected in `~/vaults/Brain/concepts/lifesystem-map.md`.

## Optional wishes and carried uncertainties (not agreed scope)

- Codex CLI: not yet confirmed that `codex exec` accepts an HTTP MCP server with a bearer token. Investigate early.
- Studio generation jobs: review the current implementation before rebuilding.
- Prompt caching: putting chat history before the per-reply context would let history be reused; an implementation choice.
- Subscription login vs API key: three bots on one login share its limits; whether a subscription login may sit behind an app is not checked.
- Productivity research: which methods, and how deep, is for execution to determine.
