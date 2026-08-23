# Household Finance

Personal finance tracker for a Dutch household. Import bank transactions from CSV, auto-categorise them with rules and AI, track budgets using the 50/30/20 rule, and visualise spending on a dashboard.

## Architecture

```
frontend/          React 19 + TypeScript + Vite (port 5173)
  src/pages/       Dashboard, Import, Transactions, Budget, Rules
  src/components/  Nav, SummaryCards, ReviewCard
  src/api.ts       All backend fetch calls via /api proxy

backend/           FastAPI + SQLAlchemy + SQLite (port 8000)
  routers/         imports, transactions, budget, rules, dashboard, categories
  importers/       ING, Revolut, DEGIRO CSV parsers
  categorizer/     Rule engine + Claude AI fallback
  data/finance.db  SQLite database (auto-created on startup)
```

**Database:** SQLite file at `backend/data/finance.db`. Schema is managed by Alembic (`backend/alembic/`): fresh databases are migrated automatically to head on startup. An EXISTING database must be registered once: `cd backend && .venv/bin/alembic stamp head` (its schema already equals the baseline; the first upgrade after stamping is a no-op). Override the path with the `DATABASE_URL` env var.

## Prerequisites

- Python 3.11+
- Node.js 18+
- An [Anthropic API key](https://console.anthropic.com/) (optional, for AI categorisation)

## Quick Start (one command)

```bash
./dev.sh
```

This bootstraps the backend virtualenv + dependencies and the frontend
`node_modules` on first run, then starts **both** servers together. Press
`Ctrl+C` to stop them both. Open http://localhost:5173.

Run `./dev.sh setup` to only install/refresh dependencies without starting the
servers. The manual, two-terminal steps below still work if you prefer them.

## Setup

### Backend

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
```

Create a `.env` file in the project root (or `backend/`):

```
ANTHROPIC_API_KEY=sk-ant-your-key-here
```

The AI categoriser uses Claude Haiku. Without the key, transactions that don't match a rule will remain uncategorised -- the app still works.

### Frontend

```bash
cd frontend
npm install
```

## Running

Start both in separate terminals:

```bash
# Terminal 1 -- backend
cd backend
uvicorn main:app --reload

# Terminal 2 -- frontend
cd frontend
npm run dev
```

Open http://localhost:5173

The Vite dev server proxies `/api` requests to the backend at port 8000.

## Testing

```bash
# Backend (pytest)
cd backend
pytest

# Frontend (vitest)
cd frontend
npx vitest
```

Backend tests use an in-memory SQLite database per test. Frontend tests use vitest with jsdom and @testing-library/react.

## How It Works

### Import Flow

1. Upload a CSV from ING, Revolut, or DEGIRO on the Import page
2. Preview shows parsed transactions with duplicate detection (SHA-256 hash of source|date|amount|description)
3. On confirm, each transaction is categorised:
   - **Rule engine** (first): case-insensitive substring match on description, ordered by priority. Matched transactions are auto-confirmed.
   - **Claude AI** (fallback): sends the description + category list to Claude Haiku, returns a category with confidence score. AI-categorised transactions need human review.
   - If neither matches, the transaction is left uncategorised.

### Categories (50/30/20 Rule)

11 default categories seeded on startup:

| Type | Categories |
|------|-----------|
| **Needs** (50%) | Taxes & Mortgage, Utilities, Food - Essential, Transportation, Insurance, Medical & Healthcare |
| **Wants** (30%) | Food - Not Essential, Recreation & Entertainment, Miscellaneous |
| **Savings** (20%) | DEGIRO, Fun Account |

### Review Workflow

AI-categorised and uncategorised transactions appear in a review queue on the Transactions page. For each transaction you can:

- **Confirm** the suggested category
- **Skip** to review later
- **Create a rule** -- saves a pattern-based rule and retroactively applies it to all matching unconfirmed transactions

### Dashboard

- Summary cards: income, spent, saved, left over
- Bar chart: planned vs actual by category
- Pie chart: 50/30/20 needs/wants/savings split
- Line chart: 6-month spending trend

## Project Structure

```
backend/
  main.py              FastAPI app, CORS, startup, router registration
  db.py                SQLAlchemy engine + session (SQLite)
  models.py            Category, Transaction, Rule, Budget models
  schemas.py           Pydantic request/response schemas
  seed.py              Default categories + budget templates
  importers/
    base.py            Abstract base importer + SHA-256 hashing
    ing.py             ING bank CSV parser
    revolut.py         Revolut CSV parser
    degiro.py          DEGIRO CSV parser
  categorizer/
    rules.py           Pattern-matching rule engine
    ai.py              Claude AI categoriser (Haiku 4.5)
  routers/
    imports.py         POST /import/preview, /import/confirm
    transactions.py    GET/PATCH /transactions, /transactions/review
    budget.py          GET/PATCH /budget
    rules.py           CRUD /rules, POST /rules/test
    dashboard.py       GET /dashboard/summary
    categories.py      GET /categories
  tests/               pytest suite (35 tests, in-memory SQLite)

frontend/
  src/
    App.tsx            Router + QueryClient setup
    api.ts             Backend API client
    types.ts           TypeScript interfaces
    index.css          Dark theme design system
    pages/             Dashboard, Import, Transactions, Budget, Rules
    components/        Nav, SummaryCards, ReviewCard
    tests/             vitest suite (6 tests, jsdom)
```
