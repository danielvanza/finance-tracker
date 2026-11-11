# AGENTS.md

Guidance for AI agents working on this codebase.

## Project Overview

Personal finance tracker: CSV bank import -> auto-categorisation (rules + Claude AI) -> budget tracking with 50/30/20 rule -> "are we on track this month?".

A sibling of life-dashboard, served at `/finances` behind its sign-in. Read [PRODUCT.md](PRODUCT.md) for what it is for and [DESIGN.md](DESIGN.md) before any visual change.

**Stack:** FastAPI + SQLAlchemy + SQLite (backend), React 19 + TypeScript + Vite (frontend).

## Repository Layout

```
backend/
  main.py              App entry point, CORS, startup, router registration
  db.py                SQLAlchemy engine + session config (SQLite)
  models.py            ORM models: Category, Transaction, Rule, Budget
  schemas.py           Pydantic schemas for request/response validation
  seed.py              Default categories + budget templates (idempotent)
  importers/           CSV parsers (base.py, ing.py, revolut.py, degiro.py)
  categorizer/         rules.py (pattern matching), ai.py (Claude Haiku), claude_cli.py (sandboxed login)
  assistant/           The chat agent: actions.py (what it can change, preview + apply), brain.py (the conversation it is given, running a reply, Stop and the time limit), prompts.py (system prompt), tools.py (the tools Claude can call), figures.py (wording helpers), service.py (queue, live log, Stop, New chat, Yes/No), queries.py (read-only views and the Month page overview), charts.py (draws charts from query results)
  telegram_bot.py      The private Telegram bot, its own process; a thin front on /chat
  routers/             API route handlers (imports, transactions, budget, rules, dashboard, categories)
  tests/               pytest test suite
  data/finance.db      SQLite database (auto-created, gitignored)

frontend/
  src/App.tsx           Router + QueryClient setup
  src/api.ts            All backend API calls (fetch-based, /api prefix)
  src/types.ts          TypeScript interfaces
  src/styles/           Tokens (base.css), shell, shared controls, one stylesheet per page
  src/theme.ts, daylight.tsx, press.ts   Day/night and clay press, as in life-dashboard
  src/pages/            Month (+ month/), Transactions (+ transactions/), Trends, Setup, Rules, Settings, Import
  src/components/       ReviewCard, CategorySelect, CategoryManager, StandingAdjustments, Split*, AddTransactionModal, ErrorBanner
  src/tests/            vitest test suite
```

## Conventions

### Backend

- **Framework:** FastAPI with dependency injection (`Depends(get_db)` for sessions).
- **ORM:** SQLAlchemy 2.0 declarative style. Models in `models.py`, all inherit from `Base` in `db.py`.
- **Database:** SQLite. Migrations via Alembic (`backend/alembic/`) -- startup runs `alembic upgrade head` programmatically, so fresh DBs are created by the baseline revision. Existing pre-Alembic DBs need a one-time `cd backend && .venv/bin/alembic stamp head` (schema already equals baseline). New migrations go in `backend/alembic/versions/`. Override location with `DATABASE_URL` env var.
- **Schemas:** Pydantic v2 models in `schemas.py`. All API endpoints use these for request/response typing.
- **Enums:** `CategoryType` (needs/wants/savings), `TransactionSource` (ing/revolut/degiro), `CategorisedBy` (rule/ai/manual). Defined in `models.py`.
- **Naming:** British spelling for domain terms (`categoriser`, `categorised_by`). Standard Python snake_case everywhere else.
- **Importers:** Each bank has its own class inheriting from `BaseImporter` in `importers/base.py`. Must implement `parse(file_content: str) -> list[ParsedTransaction]`. Deduplication uses SHA-256 hash of `source|date|amount|description`.
- **Categorisation:** Two-tier: rules first (priority-ordered substring match), then AI fallback. Rule-matched transactions are auto-confirmed. AI-matched need human review.
- **Error handling:** AI categoriser catches `anthropic.APIError` and returns `None` on failure (graceful degradation).

### Frontend

- **Framework:** React 19 with TypeScript, built with Vite.
- **Routing:** react-router-dom v7 with `BrowserRouter`. Routes defined in `App.tsx`.
- **Data fetching:** TanStack Query (`@tanstack/react-query`). Query keys follow `[resource, ...params]` pattern (e.g., `['dashboard', month]`). Use the pace endpoint's `current_month` for the current financial month; never derive it from the calendar.
- **API calls:** Centralised in `src/api.ts`. All calls use the `/api` prefix which Vite proxies to the backend at port 8000.
- **Styling:** No CSS framework, CSS modules or styled-components. Plain CSS classes in `src/styles/`, shared parts in `controls.css`, tokens only for colour, radius and shadow (see DESIGN.md). Inline `style` only for computed values such as a width.
- **Charts:** The Month pace line is hand-drawn SVG. Trends uses recharts, passing `var(--token)` strings so both themes work without a reload.
- **No component library:** All UI components are hand-built.

### Testing

- **Backend:** pytest. Run with `cd backend && pytest`. Tests use an in-memory SQLite database per test function (configured in `tests/conftest.py` with `StaticPool`). API tests use FastAPI `TestClient` with `dependency_overrides` to inject the test DB.
- **Frontend:** vitest with jsdom. Run with `cd frontend && npx vitest`. Uses `@testing-library/react` for component tests.

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `ANTHROPIC_API_KEY` | No | (none) | Anthropic API key for Claude AI categorisation. Without it, only rule-based categorisation works. |
| `DATABASE_URL` | No | `sqlite:///./data/finance.db` | SQLAlchemy database URL. |
| `CLAUDE_CLI_HOME` | For chat | (none) | Private folder for the sandboxed Claude login. The chat only uses this login, never an API key. |
| `CHAT_MODEL` | No | `sonnet` | Claude model behind both chats. |
| `CHAT_TIME_LIMIT_SECONDS` | No | `540` | How long Claude may work on one reply before it is stopped and writes up what it found (about a minute more). |
| `TELEGRAM_BOT_TOKEN` | For the bot | (none) | From BotFather. A bot of its own, separate from Hermes. |
| `TELEGRAM_ALLOWED_USER_ID` | For the bot | (none) | The one numeric Telegram account the bot answers. |
| `FINANCE_API_URL` | No | `http://127.0.0.1:18600/api` | Where the bot finds the app. |

Place these in a `.env` file (gitignored).

## Key Patterns

### Adding a New Bank Importer

1. Create `backend/importers/<bank>.py`
2. Subclass `BaseImporter`, implement `parse()` returning `list[ParsedTransaction]`
3. Add the source to `TransactionSource` enum in `models.py`
4. Register in `routers/imports.py` `_parse()` function
5. Add tests in `backend/tests/test_importers.py`

### Adding a New API Endpoint

1. Add Pydantic schemas to `schemas.py` if needed
2. Create or extend a router in `routers/`
3. Register in `main.py` if it's a new router file
4. Add the corresponding fetch function to `frontend/src/api.ts`
5. Add TypeScript types to `frontend/src/types.ts` if needed

### Adding Something the Chat Can Change

Add an `Op` to `OPS` in `backend/assistant/actions.py` that calls the existing router function, with the argument signature the model is shown in the `propose_change` tool. Preview, before/after fields, budget effect, apply-once and batching (the `batch` op) come for free: an action runs inside a transaction and is compared against the tables. When the app refuses a change, the reason goes back to Claude to correct, so make `ActionError` messages say exactly what is wrong (which row, which field).

### The Chat Agent

Each chat (panel, Telegram) is one ongoing conversation; `brain.build_prompt` gives Claude all of it since the last New chat (a `new_chat` marker row), plus this month's Month page overview. One `claude -p` run per reply works through the tools in `assistant/tools.py`, served by the app over loopback MCP; built-in tools stay off. Its final text is the reply. Every tool call adds a plain-words step to the live log (saved on the person's message, shown in both chats). Stop or the time limit ends the run; Claude then writes up what it found, without tools.

Lookups never change data: `month_overview` rolls back what opening a month writes, and `run_query` only sees a private in-memory copy built per reply by the Month page's own code (`assistant/queries.py`). Cards are made during the run and stay open until applied, rejected or replaced by a card that names them in `replaces`.

Say what a tool does in its description and keep behaviour and judgement in `assistant/prompts.py`. To let Claude read something new, add a table to `_DDL`, `_TABLES`, `SCHEMA` and `_fill`/`_fill_setup`. Keep the default context in `build_prompt` bounded: history is fetched on demand.

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
cd frontend && npm run build && npx playwright test   # chat E2E: uses the Claude login on synthetic data
```
