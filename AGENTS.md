# AGENTS.md

Guidance for AI agents working on this codebase.

## Project Overview

Household budget for two people: ING export -> sorting (rules, then Claude: sure guesses count, doubtful ones are asked about) -> a plan per category -> "what is free to spend until payday?". Used in the web app and through a Telegram bot in a group the two share.

A sibling of life-dashboard, served at `/finances` behind its sign-in. Read [PRODUCT.md](PRODUCT.md) for what it is for and [DESIGN.md](DESIGN.md) before any visual change.

**Stack:** FastAPI + SQLAlchemy + SQLite (backend), React 19 + TypeScript + Vite (frontend).

## Repository Layout

```
backend/
  main.py              App entry point, CORS, startup, router registration
  db.py                SQLAlchemy engine + session config (SQLite)
  models.py            ORM models: Category, Transaction, Rule, AskShop, Budget, SetAside, IgnoredBill, Reminder (the chat keeps its own store)
  schemas.py           Pydantic schemas for request/response validation
  seed.py              Default categories + budget templates (idempotent)
  importers/           ing.py: the one parser, for English and Dutch ING exports (base.py holds the hashing)
  import_service.py    Parsed rows into transactions; recognising a row that is already in
  categorizer/         rules.py (longest matching text wins), ai.py (Claude: a category, sure or not, and options), claude_cli.py (the sandboxed Claude login through botkit's runner, with no tools; the runner settings the chat shares)
  guesses.py           Which guesses count, the questions about the rest, what an answer teaches, money moved to a personal account
  set_asides.py        Set-asides: a bill's monthly share and what its payment settles
  nudges.py            What the bot says unasked, and when (its loop also sends due reminders)
  reminders.py         Reminders the household asked the chat to set: when they next go out, and sending the due ones
  voice.py             Voice notes to text, on this machine (faster-whisper)
  clock.py             Today and now for the household; every date question goes through it
  assistant/           The chat, on the shared bot kit (docs/bot.md): bot.py (finance's Bot: tools, card kinds, file/photo/voice handlers, buttons, history, starters), questions.py (questions about unsure payments, unasked messages), actions.py (what it can change, preview + apply), prompts.py (system prompt), queries.py (read-only views and the Month page overview), charts.py (draws charts from query results), figures.py (wording helpers)
  telegram_bot.py      The Telegram bot, its own process: bot-kit's Telegram front (botkit.telegram) with finance's settings, layouts and words: one group, two people
  routers/             API route handlers (imports, transactions, budget, set_asides, rules, dashboard, categories, recurring, goals, settings); the chat is botkit's router at /chat
  tests/               pytest test suite
  data/finance.db      SQLite database (auto-created, gitignored)

frontend/
  src/App.tsx           Router + QueryClient setup
  src/api.ts            All backend API calls (fetch-based, /api prefix)
  src/types.ts          TypeScript interfaces
  src/styles/           Tokens (base.css), shell, shared controls, one stylesheet per page
  src/theme.ts, daylight.tsx, press.ts   Day/night and clay press, as in life-dashboard
  src/pages/            Month (+ month/), Transactions (+ transactions/), Trends, Setup, Rules, Settings, Import
  src/chat/             Chat.tsx (the round button and the panel/sheet around bot-kit's Bubble), kinds.tsx (finance's message kinds and card extras)
  src/components/       ReviewCard, CategorySelect, CategoryManager, SetAsides, TargetSplit, ImportLink, Split*, AddTransactionModal, ErrorBanner
  src/tests/            vitest test suite
```

## Conventions

### Backend

- **Framework:** FastAPI with dependency injection (`Depends(get_db)` for sessions).
- **ORM:** SQLAlchemy 2.0 declarative style. Models in `models.py`, all inherit from `Base` in `db.py`.
- **Database:** SQLite. Migrations via Alembic (`backend/alembic/`) -- startup runs `alembic upgrade head` programmatically, so fresh DBs are created by the baseline revision. A database from before Alembic needs a one-time `cd backend && .venv/bin/alembic stamp afe0635828ba` (its schema equals that baseline); the next start then runs the later migrations. New migrations go in `backend/alembic/versions/`. Override location with `DATABASE_URL` env var.
- **Schemas:** Pydantic v2 models in `schemas.py`. All API endpoints use these for request/response typing.
- **Enums:** `CategoryType` (needs/wants/savings/income/exclude), `TransactionSource` (ing/manual), `CategorisedBy` (rule/ai/manual). Defined in `models.py`. On a confirmed row `ai` means sorted automatically; a person's confirmation makes it `manual`.
- **Naming:** British spelling for domain terms (`categoriser`, `categorised_by`). Standard Python snake_case everywhere else.
- **Importer:** ING only (`importers/ing.py`, `parse_ing`), English or Dutch column names, semicolons or commas. A row is already in when its hash (`source|date|amount|description|notes|balance`) is, or when a stored ING row has the same date, amount and name (the same payment from an export in the other language); see `import_service.already_here`. The bank's note is kept whole in `Transaction.note`; `ing.written` gives the part the payer typed, which is what the sorter and the chat's `transactions` table are shown. A row that is in without a note gets it when its file is imported again.
- **Categorisation:** rules first (the longest matching text wins; a text under six characters only fits as a word of its own, `rules.fits`; a rule only fits money in the right direction), then Claude. Claude says whether it is sure. Sure: confirmed at once, `categorised_by = ai`. Not sure: unconfirmed with `ai_options`, counted nowhere, asked about (`guesses.py`, `assistant/questions.ask_questions`). A person's answer sorts the shop's other waiting payments (`guesses.settle_like`) and makes no rule by itself: remembering the shop is offered afterwards (a button after an answered question or an applied card, a tick box on the review card) and made by `guesses.remember`. The shop's name is worked out by `guesses.shop_pattern`, which keeps a number the name starts with; a payment service that hides the shop gets no rule (`guesses.hides_shop`). A shop marked "always ask" (`AskShop`, `guesses.always_ask`: one that sells a bit of everything) is never counted on Claude's say-so, each payment is asked about on its own, an answer settles only that payment, and it gets no rule. Money going out to a name in the `own_names` setting goes to "To personal accounts" (`guesses.sort_personal`).
- **Totals:** only confirmed rows count. A row with `set_aside_id` counts only for the part that had not been set aside yet when it was paid (`set_asides.counted_parts`); every total reads parts through that or through `spend_service`.
- **Budgets:** a row per category per month; a month takes the newest earlier month's amount (`routers/budget.planned_for`). Changing a row also changes the later rows that still hold the old amount, up to the first month that holds another (`patch_budget`).
- **Dates:** ask `clock.today()` / `clock.now()`, never `date.today()`.
- **Error handling:** when Claude cannot be reached or gives no answer for a row (`categorizer/ai.batch_categorise_with_ai` leaves it out of what it returns), the row stays waiting with `ai_options` NULL and is judged again after the next import or start (`guesses.judge_backlog`). An import sent in the chat is refused whole instead.

### Frontend

- **Framework:** React 19 with TypeScript, built with Vite.
- **Routing:** react-router-dom v7 with `BrowserRouter`. Routes defined in `App.tsx`.
- **Data fetching:** TanStack Query (`@tanstack/react-query`). Query keys follow `[resource, ...params]` pattern (e.g., `['dashboard', month]`). Use the pace endpoint's `current_month` for the current financial month; never derive it from the calendar.
- **API calls:** Centralised in `src/api.ts`. All calls use the `/api` prefix which Vite proxies to the backend at port 8000. The chat talks to `/api/chat` through bot-kit's own client (`bot-kit/client`).
- **The chat:** bot-kit's default bubble (`"bot-kit": "file:../vendor/bot-kit-0.1.0.tgz"`, prebuilt; Vite dedupes React). Finance's look is `styles/chat.css`, which maps every `--bk-*` variable to finance's tokens.
- **Styling:** No CSS framework, CSS modules or styled-components. Plain CSS classes in `src/styles/`, shared parts in `controls.css`, tokens only for colour, radius and shadow (see DESIGN.md). Inline `style` only for computed values such as a width.
- **Charts:** The Month pace line is hand-drawn SVG. Trends uses recharts, passing `var(--token)` strings so both themes work without a reload.
- **No component library:** All UI components are hand-built.

### Testing

- **Backend:** pytest. Run with `cd backend && pytest`. Tests use an in-memory SQLite database per test function (configured in `tests/conftest.py` with `StaticPool`). API tests use FastAPI `TestClient` with `dependency_overrides` to inject the test DB.
- **Frontend:** vitest with jsdom. Run with `cd frontend && npx vitest`. Uses `@testing-library/react` for component tests.

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `ANTHROPIC_API_KEY` | No | (none) | Claude for sorting imports, when the login below is not set up (with neither, only the rules sort); and the chat's "Claude API" runner, when picked. |
| `OPENAI_API_KEY` | No | (none) | The chat's "OpenAI API" runner, when picked. |
| `DATABASE_URL` | No | `sqlite:///./data/finance.db` | SQLAlchemy database URL. |
| `BOT_DB_PATH` | No | `bot.db` beside the finance database | The chat's own SQLite file (bot-kit's store: conversations, messages, cards). |
| `CLAUDE_CLI_HOME` | For chat | (none) | Private folder for the sandboxed Claude login: the chat's default runner ("Claude Code") and sorting imports. Keep it outside any folder holding a repository or agent instructions (`.git`, `CLAUDE.md`, `AGENTS.md`, `.claude`, `.codex`): botkit refuses to run there. |
| `CLAUDE_BIN`, `CLAUDE_CREDENTIALS` | No | `claude` on PATH, `~/.claude/.credentials.json` | The Claude CLI and the login token it uses (linked into the private folder, never copied). |
| `CODEX_CLI_HOME` | No | (none) | Private folder for the sandboxed Codex login: without it the chat's "Codex" runner shows as not set up. |
| `CHAT_MODEL` | No | `sonnet` | Claude Code model a new conversation starts on, in both chats. The picker in the chat changes it per conversation. |
| `SORT_MODEL` | No | `sonnet` | Claude model that sorts imported rows (on the Claude login). |
| `CHAT_TIME_LIMIT_SECONDS` | No | `540` | How long Claude may work on one reply before it is stopped and writes up what it found (about a minute more). |
| `TELEGRAM_BOT_TOKEN` | For the bot | (none) | From BotFather. A bot of its own, separate from Hermes. |
| `TELEGRAM_ALLOWED_USER_IDS` | For the bot | (none) | The two numeric Telegram accounts, comma-separated. |
| `TELEGRAM_GROUP_ID` | For the bot | (none) | The household group's numeric id. Without it the bot answers nobody and logs the id of a group one of the two writes in. |
| `VOICE_MODEL` | No | `small.en` | Speech model for voice notes, fetched on first use. |
| `FINANCE_TIMEZONE` | No | `Europe/Amsterdam` | The household's time. |
| `NUDGES` | No | `on` | `off` stops the bot writing what nobody asked for (the recap, old bank data, month end, questions at the morning catch-up). Reminders the household asked the chat to set are still sent. |
| `FINANCE_API_URL` | No | `http://127.0.0.1:18600/api` | Where the bot finds the app. |
| `FINANCE_SCRIPT_RUNNER` | Tests only | (off) | `1` adds botkit's scripted model ("Test script") to the picker, for the E2E suite. Never set in production. |

Place these in a `.env` file (gitignored).

## Key Patterns

### Adding a New API Endpoint

1. Add Pydantic schemas to `schemas.py` if needed
2. Create or extend a router in `routers/`
3. Register in `main.py` if it's a new router file
4. Add the corresponding fetch function to `frontend/src/api.ts`
5. Add TypeScript types to `frontend/src/types.ts` if needed

### Adding Something the Chat Can Change

Add an `Op` to `OPS` in `backend/assistant/actions.py` that calls the existing router function, with the argument signature the model is shown in bot-kit's `make_change` tool; `assistant/bot.py` makes every `OPS` entry a card kind. Preview, before/after fields, budget effect, apply-once and batching (the `batch` op) come for free: an action runs inside a transaction and is compared against the tables. When the app refuses a change, the reason goes back to Claude to correct, so make `ActionError` messages say exactly what is wrong (which row, which field).

### The Chat Agent

The chat runs on the shared bot kit (vendored in `vendor/`, `botkit`; its `SPEC.md` is the authority). To upgrade, replace the two release files in `vendor/` (the wheel and the tgz) and their paths in `backend/pyproject.toml` and `frontend/package.json`, per the kit's README, then reinstall and run the tests. The kit
does the conversation: the queue, the live log, Stop and the time limit with its write-up, New chat, the runner and
model picker (Claude Code, Claude API, Codex, OpenAI API; never a fallback to another), cards (Apply once, a stale card
shown again with a fresh preview), the HTTP API at `/api/chat` and the bubble. Finance supplies what is its own, in
`assistant/bot.py`, and `docs/bot.md` records its message kinds, payloads, buttons and card data, which the bubble and
the Telegram front are built on.

Each chat (`bubble`, `telegram`) is one ongoing conversation; Claude is given all of it since the last New chat, each
message as `bot.history_entry` shows it, plus `<context>` (today, how many payments wait, this month as the Month page
shows it). Its tools: `month_overview`, `run_query` and `show_chart`, and the kit's `make_change` and `show_choices`.
Every tool call adds a plain-words step to the live log. Lookups never change data: `month_overview` rolls back what
opening a month writes, and `run_query` only sees a private in-memory copy built per reply by the Month page's own code
(`assistant/queries.py`) and closed when the reply ends.

Every change in `actions.OPS` is a card kind: a card says what will change in the app's own words (`actions.plain`):
a line per change, or a summary per category when there are many, with every row on request (`actions.details`); its
extras (budget effect, refund's purchase, rows, the offer to remember shops) are in its `data` and `result`. A change
aimed at a payment that looks just like another is refused until the person has said which (`bot._check_target`).
Claude's closing words ride on the card it made. An import in the chat may offer `merge` cards (`bot.offer`); Claude
cannot make one.

The app also speaks without Claude, through `bot.post`: questions about payments Claude was not sure of
(`questions.ask_questions`, a few open at a time, in the Telegram group, answered by a button, and only once Claude has
judged the payment or gave no answer for it; "Something else" makes the app ask what it is, as a line of the
conversation), and what the bot says unasked (`nudges.py`, one message for everything owed; one the chat has not been
shown yet is replaced by the next, `questions.post_nudge`). Whatever nobody asked for carries `unasked` and is held back
between 21:00 and 9:00 (`clock.quiet_hours`). A reminder the household asked for (`reminder.add`, `reminders.py`) is
posted by the same loop as its own `reminder` message (never through `post_nudge`, which would replace one nobody has
been shown): once, at the first allowed moment after its time, whether or not `NUDGES` is off. A voice note is turned into text first (`voice.py`), and its words never
settle a card; a photo is shown to Claude as a picture beside the prompt, with no tool added.

The Telegram bot is bot-kit's Telegram front (`botkit.telegram`, SPEC §11): it polls Telegram, talks to the app only
through the chat's HTTP API, keeps the live log with Stop, edits messages in place and marks them delivered.
`telegram_bot.py` gives it finance's settings (the env vars below), words and layouts: every `render_*` returns a
`Shown` whose HTML has its text escaped, Claude's own words go through `rich`, and the first reply to a voice note
starts with what was heard. The layouts are recorded in `docs/design/telegram.md`.

Say what a tool does in its description and keep behaviour and judgement in `assistant/prompts.py`. To let Claude read
something new, add a table to `_DDL`, `_TABLES`, `SCHEMA` and `_fill`/`_fill_setup`. Keep the context bounded: history
is fetched on demand.

### Adding a New Category

Categories are seeded in `backend/seed.py`. Add to the `CATEGORIES` list with name, type (needs/wants/savings), and default budget amount.

## Running

```bash
# Backend
cd backend && uvicorn main:app --reload    # port 8000

# Frontend
cd frontend && npm run dev                 # port 5173

# Tests
cd backend && pytest
cd frontend && npx vitest
cd frontend && npm run build && npx playwright test e2e/bubble-real.spec.ts e2e/chat-layout.spec.ts   # chat E2E: the Claude login on synthetic data
```
