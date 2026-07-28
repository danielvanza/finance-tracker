# Household Finance — Setup & Usage Guide

Personal finance tracker: import CSV bank statements, auto-categorise transactions (rules + Claude AI), track budgets with the 50/30/20 rule, and visualise spending on a dashboard.

## Prerequisites

- Python 3.11+ (tested on 3.14)
- Node.js 18+ with npm
- An [Anthropic API key](https://console.anthropic.com/) (optional — only needed for AI categorisation)

## Quick Start (one command)

From the repo root:

```bash
./dev.sh
```

On first run this creates `backend/.venv`, installs backend + frontend
dependencies, then starts both servers. It re-installs automatically when
`pyproject.toml` or `package-lock.json` change. Press `Ctrl+C` to stop both.
Open **http://localhost:5173**.

- `./dev.sh setup` — install/refresh dependencies only, don't start the servers.
- AI categorisation is still optional: add `ANTHROPIC_API_KEY` to `backend/.env`.

Prefer to run the two processes yourself? The manual steps below still work.

## Quick Start (manual)

### 1. Backend

```bash
cd backend

# Create virtual environment and install dependencies
python3 -m venv .venv
source .venv/bin/activate        # macOS/Linux
# .venv\Scripts\activate         # Windows
pip install -e ".[dev]"

# Create .env file (optional, for AI categorisation)
echo 'ANTHROPIC_API_KEY=sk-ant-...' > .env

# Start the server (port 8000)
uvicorn main:app --reload
```

The database and seed data (categories, default budgets) are created automatically on first startup.

### 2. Frontend

```bash
cd frontend
npm install
npm run dev                      # starts on http://localhost:5173
```

Open **http://localhost:5173** in your browser. The Vite dev server proxies all `/api/*` calls to the backend at port 8000.

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `ANTHROPIC_API_KEY` | No | — | Anthropic API key for Claude AI categorisation. Without it, only rule-based categorisation works. |
| `DATABASE_URL` | No | `sqlite:///./data/finance.db` | SQLAlchemy database URL. |

Place these in `backend/.env` — it's loaded automatically on startup and is gitignored.

## Running Tests

```bash
# Backend (pytest, uses in-memory SQLite per test)
cd backend
source .venv/bin/activate
pytest                           # or: pytest -v for verbose output

# Frontend (vitest with jsdom + testing-library)
cd frontend
npx vitest                       # interactive watch mode
npx vitest run                   # single run
```

---

## How to Use the App

### Importing Transactions

1. Go to **Import** (`/import`)
2. Select your bank: **ING**, **Revolut**, or **DEGIRO**
3. Upload the CSV file exported from your bank
4. **Preview** shows all parsed transactions, highlighting duplicates already in the database
5. Click **Confirm** to import — duplicate transactions are automatically skipped

Each bank expects its own CSV format:

| Bank | Delimiter | Date Format | Amount | Notes |
|------|-----------|-------------|--------|-------|
| ING | Semicolon (`;`) | `YYYYMMDD` | `Amount (EUR)` with comma decimal, `Debit/credit` column for sign | Uses `Notifications` and `Resulting balance` for dedup |
| Revolut | Comma | ISO 8601 | `Amount` (already signed) | Rows with `State = REVERTED` are skipped |
| DEGIRO | Comma | `DD-MM-YYYY` | `Change` with comma decimal | Empty amounts are skipped |

### Reviewing Transactions

After import, transactions are categorised in two tiers:

1. **Rules** — pattern-matched transactions are auto-confirmed
2. **AI (Claude Haiku)** — AI-matched transactions need human review

Go to **Transactions** (`/transactions`) and click the review queue button to step through unconfirmed transactions one by one. For each you can:

- **Confirm** the suggested category
- **Change** the category and confirm
- **Create Rule** — creates a rule from the transaction's description and retroactively applies it to all matching unconfirmed transactions
- **Skip** to review later

### Managing Rules

Go to **Rules** (`/rules`) to manage categorisation rules:

- **Add a rule**: set a pattern (substring match, case-insensitive), select a category, and set a priority
- **Test a pattern**: preview which existing transactions would match before committing
- **Edit/delete** existing rules
- Higher priority rules are checked first — first match wins

### Budget Tracking

Go to **Budget** (`/budget`) to view and edit monthly budgets:

- Default budgets are pre-seeded for all 11 categories (see table below)
- When you view a new month for the first time, budgets are auto-populated from defaults
- Edit **Planned** amounts inline for any month
- Progress bars show actual vs planned spending (green < 80%, yellow 80–100%, red > 100%)

### Dashboard

Go to **Dashboard** (`/`) for a monthly overview:

- **Summary cards**: Income, Spent, Saved, Left Over
- **Bar chart**: Planned vs actual spending per category
- **Pie chart**: 50/30/20 split (needs/wants/savings)
- **Line chart**: 6-month spending trend

Only **confirmed** transactions are included in dashboard calculations.

---

## Database Management

The database is a single SQLite file at `backend/data/finance.db`. No migration tool is used — tables are auto-created on startup.

### Reset the Database

Delete the file and restart the backend. Categories and default budgets are re-seeded automatically:

```bash
rm backend/data/finance.db
# Restart uvicorn
```

### Direct SQLite Access

```bash
cd backend
sqlite3 data/finance.db
```

#### Useful Queries

```sql
-- List all tables
.tables

-- View table schema
.schema transactions

-- List all categories
SELECT id, name, type, sort_order FROM categories ORDER BY sort_order;

-- List all categorisation rules
SELECT r.id, r.pattern, c.name AS category, r.priority
FROM rules r JOIN categories c ON r.category_id = c.id
ORDER BY r.priority DESC;

-- Count transactions by source
SELECT source, COUNT(*) FROM transactions GROUP BY source;

-- Count by categorisation method
SELECT categorised_by, COUNT(*) FROM transactions GROUP BY categorised_by;

-- Unconfirmed transactions needing review
SELECT id, description, amount, categorised_by, ai_confidence
FROM transactions WHERE confirmed = 0;

-- Monthly spending summary (confirmed expenses only)
SELECT strftime('%Y-%m', date) AS month,
       SUM(CASE WHEN amount < 0 THEN amount ELSE 0 END) AS expenses,
       SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END) AS income
FROM transactions
WHERE confirmed = 1
GROUP BY month ORDER BY month;

-- View default budget templates
SELECT c.name, b.planned_amount
FROM budgets b JOIN categories c ON b.category_id = c.id
WHERE b.month IS NULL ORDER BY c.sort_order;

-- View a specific month's budget vs actual
SELECT c.name, b.planned_amount,
       COALESCE(SUM(t.amount), 0) AS actual
FROM budgets b
JOIN categories c ON b.category_id = c.id
LEFT JOIN transactions t ON t.category_id = c.id
  AND t.confirmed = 1 AND t.amount < 0
  AND strftime('%Y-%m', t.date) = '2026-03'
WHERE b.month = '2026-03-01'
GROUP BY c.id ORDER BY c.sort_order;
```

#### Modifying Data Directly

```sql
-- Manually confirm a transaction
UPDATE transactions SET confirmed = 1 WHERE id = 42;

-- Change a transaction's category (use category id from `SELECT * FROM categories`)
UPDATE transactions SET category_id = 3, categorised_by = 'manual', confirmed = 1 WHERE id = 42;

-- Bulk-confirm all AI-categorised transactions
UPDATE transactions SET confirmed = 1 WHERE categorised_by = 'ai';

-- Delete all transactions (keeps categories, rules, budgets)
DELETE FROM transactions;

-- Update a default budget amount
UPDATE budgets SET planned_amount = 500.00
WHERE category_id = (SELECT id FROM categories WHERE name = 'Food - Essential')
AND month IS NULL;

-- Add a new rule
INSERT INTO rules (pattern, category_id, priority)
VALUES ('spotify', (SELECT id FROM categories WHERE name = 'Recreation & Entertainment'), 10);

-- Delete a specific rule
DELETE FROM rules WHERE id = 5;
```

---

## Default Categories

These are seeded on first startup:

| Name | Type | Default Budget |
|------|------|---------------|
| Taxes & Mortgage | needs | €2,000 |
| Utilities | needs | €200 |
| Food - Essential | needs | €350 |
| Transportation | needs | €200 |
| Insurance | needs | €400 |
| Medical & Healthcare | needs | €100 |
| Food - Not Essential | wants | €200 |
| Recreation & Entertainment | wants | €100 |
| Miscellaneous | wants | €300 |
| DEGIRO | savings | €300 |
| Fun Account | savings | €100 |

---

## API Reference

All endpoints are served by the backend on port 8000. The frontend accesses them via the `/api` prefix (stripped by the Vite proxy).

### Import

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/import/preview` | Upload CSV, preview parsed transactions with duplicate detection |
| `POST` | `/import/confirm` | Upload CSV, import new transactions with auto-categorisation |

Both accept `multipart/form-data` with fields `source` (`ing`/`revolut`/`degiro`) and `file`.

### Transactions

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/transactions` | List transactions. Filters: `month`, `category_id`, `source`, `confirmed` |
| `GET` | `/transactions/review` | Get next unconfirmed transaction for review |
| `PATCH` | `/transactions/{id}` | Update category and/or confirmed status |
| `POST` | `/transactions/{id}/create-rule` | Create rule from transaction, apply retroactively |

### Budget

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/budget?month=YYYY-MM` | Get budget rows for a month (auto-populates from defaults) |
| `PATCH` | `/budget/{id}` | Update a specific month's planned amount |
| `PATCH` | `/budget/defaults/{category_id}` | Update default budget template for a category |

### Rules

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/rules` | List all rules (ordered by priority desc) |
| `POST` | `/rules` | Create a new rule |
| `PATCH` | `/rules/{id}` | Update a rule |
| `DELETE` | `/rules/{id}` | Delete a rule |
| `POST` | `/rules/test` | Test a pattern against existing transactions |

### Dashboard

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/dashboard/summary?month=YYYY-MM` | Full dashboard data for a month |

### Categories

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/categories` | List all categories |

### Health

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Health check — returns `{"status": "ok"}` |

---

## Architecture Notes

- **No migration tool**: Tables are auto-created via `Base.metadata.create_all()` on startup. Schema changes require deleting the DB and restarting, or manual `ALTER TABLE` via sqlite3.
- **Deduplication**: Import hashes are SHA-256 of `source|date|amount|description` (plus bank-specific fields for ING). Identical rows within the same CSV get occurrence-counter-based dedup.
- **AI fallback**: If `ANTHROPIC_API_KEY` is missing or the API fails, transactions just won't get AI categorisation — the app continues working with rules only.
- **Frontend re-sends CSV**: The confirm step re-uploads and re-parses the file (it's not cached from preview).
- **Budget auto-population**: Viewing a month that has no budget rows yet copies the default templates.
- **Dashboard scope**: Only confirmed, negative-amount transactions count as expenses.
