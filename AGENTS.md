# AGENTS.md

Guidance for AI agents working on this codebase.

## Project Overview

Personal finance tracker: CSV bank import -> auto-categorisation (rules + Claude AI) -> budget tracking with 50/30/20 rule -> dashboard visualisation.

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
  categorizer/         rules.py (pattern matching), ai.py (Claude Haiku)
  routers/             API route handlers (imports, transactions, budget, rules, dashboard, categories)
  tests/               pytest test suite
  data/finance.db      SQLite database (auto-created, gitignored)

frontend/
  src/App.tsx           Router + QueryClient setup
  src/api.ts            All backend API calls (fetch-based, /api prefix)
  src/types.ts          TypeScript interfaces
  src/index.css         Dark theme design system (CSS custom properties)
  src/pages/            Dashboard, Import, Transactions, Budget, Rules
  src/components/       Nav, SummaryCards, ReviewCard
  src/tests/            vitest test suite
```

## Conventions

### Backend

- **Framework:** FastAPI with dependency injection (`Depends(get_db)` for sessions).
- **ORM:** SQLAlchemy 2.0 declarative style. Models in `models.py`, all inherit from `Base` in `db.py`.
- **Database:** SQLite. No migration tool -- tables are auto-created via `Base.metadata.create_all()` on startup. Override location with `DATABASE_URL` env var.
- **Schemas:** Pydantic v2 models in `schemas.py`. All API endpoints use these for request/response typing.
- **Enums:** `CategoryType` (needs/wants/savings), `TransactionSource` (ing/revolut/degiro), `CategorisedBy` (rule/ai/manual). Defined in `models.py`.
- **Naming:** British spelling for domain terms (`categoriser`, `categorised_by`). Standard Python snake_case everywhere else.
- **Importers:** Each bank has its own class inheriting from `BaseImporter` in `importers/base.py`. Must implement `parse(file_content: str) -> list[ParsedTransaction]`. Deduplication uses SHA-256 hash of `source|date|amount|description`.
- **Categorisation:** Two-tier: rules first (priority-ordered substring match), then AI fallback. Rule-matched transactions are auto-confirmed. AI-matched need human review.
- **Error handling:** AI categoriser catches `anthropic.APIError` and returns `None` on failure (graceful degradation).

### Frontend

- **Framework:** React 19 with TypeScript, built with Vite.
- **Routing:** react-router-dom v7 with `BrowserRouter`. Routes defined in `App.tsx`.
- **Data fetching:** TanStack Query (`@tanstack/react-query`). Query keys follow `[resource, ...params]` pattern (e.g., `['dashboard', month]`).
- **API calls:** Centralised in `src/api.ts`. All calls use the `/api` prefix which Vite proxies to the backend at port 8000.
- **Styling:** No CSS framework. Dark theme via CSS custom properties in `index.css`. All component styling is done via inline `style` objects -- no CSS modules, no styled-components.
- **Charts:** recharts library for BarChart, PieChart, LineChart on the Dashboard page.
- **No component library:** All UI components are hand-built.

### Testing

- **Backend:** pytest. Run with `cd backend && pytest`. Tests use an in-memory SQLite database per test function (configured in `tests/conftest.py` with `StaticPool`). API tests use FastAPI `TestClient` with `dependency_overrides` to inject the test DB.
- **Frontend:** vitest with jsdom. Run with `cd frontend && npx vitest`. Uses `@testing-library/react` for component tests.

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `ANTHROPIC_API_KEY` | No | (none) | Anthropic API key for Claude AI categorisation. Without it, only rule-based categorisation works. |
| `DATABASE_URL` | No | `sqlite:///./data/finance.db` | SQLAlchemy database URL. |

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
```
