# Household Finance Tracker — Design Spec
Date: 2026-03-17

## Overview

A local web application for visualising household spending, replacing a manual Google Sheet budget tracker. Imports transactions from CSV exports (Revolut, ING, DEGIRO), auto-categorises them via rules and AI, and presents planned vs actual spending against a monthly budget.

Single user (Daniël), runs locally on laptop, no authentication required.

## Problem Statement

The current Google Sheet workflow requires manually entering every transaction into the correct category row and tracking whether each ING/Revolut transaction has been entered. This is tedious and error-prone — transactions are missed and reconciliation is unclear.

**Core value:** Import transactions → auto-categorise → show planned vs actual. No manual entry, no reconciliation confusion.

## Tech Stack

- **Backend:** FastAPI (Python) + SQLAlchemy + SQLite
- **Frontend:** React (Vite) + TypeScript
- **AI categorisation:** Claude API (claude-haiku-4-5 for cost efficiency)
- **Charts:** Recharts

## Architecture

```
household-finance/
├── backend/
│   ├── main.py             # FastAPI app, routes
│   ├── models.py           # SQLAlchemy ORM models
│   ├── db.py               # SQLite session management
│   ├── importers/
│   │   ├── base.py         # Abstract importer interface
│   │   ├── ing.py          # ING CSV parser
│   │   ├── revolut.py      # Revolut CSV parser
│   │   └── degiro.py       # DEGIRO CSV parser
│   ├── categorizer/
│   │   ├── rules.py        # Rule-based matching engine
│   │   └── ai.py           # Claude API fallback categoriser
│   └── schemas/            # Pydantic request/response models
├── frontend/
│   └── src/
│       ├── pages/
│       │   ├── Dashboard.tsx
│       │   ├── Import.tsx
│       │   ├── Transactions.tsx
│       │   ├── Budget.tsx
│       │   ├── Rules.tsx
│       │   └── Settings.tsx
│       └── components/
└── data/                   # SQLite DB + uploaded files (gitignored)
```

## Data Model

### `categories`
| Field | Type | Notes |
|-------|------|-------|
| id | int PK | |
| name | str | e.g. "Food - Essential" |
| type | enum | needs / wants / savings |
| sort_order | int | display order |

### `transactions`
| Field | Type | Notes |
|-------|------|-------|
| id | int PK | |
| date | date | |
| amount | decimal | negative = expense, positive = income |
| description | str | raw merchant/description from CSV |
| source | enum | ing / revolut / degiro |
| category_id | int FK | nullable until categorised |
| confirmed | bool | false = needs review |
| categorised_by | enum | rule / ai / manual / null (uncategorised) |
| ai_confidence | float | 0.0–1.0, null if not AI-categorised |
| import_hash | str | SHA-256 of `source + date + amount + description`; unique constraint for deduplication |

### `rules`
| Field | Type | Notes |
|-------|------|-------|
| id | int PK | |
| pattern | str | substring match (case-insensitive) |
| category_id | int FK | |
| priority | int | higher wins on conflict |

### `budgets`
| Field | Type | Notes |
|-------|------|-------|
| id | int PK | |
| category_id | int FK | |
| month | date | first day of month; NULL = default (template) |
| planned_amount | decimal | |

A **default budget** per category uses `month = NULL`. When the dashboard or budget page is opened for a month with no rows yet, the backend auto-creates that month's budget rows by copying the defaults. This happens server-side on the `GET /budget?month=YYYY-MM` request if no rows exist for that month.

## REST API

| Method | Path | Description |
|--------|------|-------------|
| GET | `/dashboard/summary?month=YYYY-MM` | Summary cards + chart data for a given month |
| POST | `/import/preview` | Parse uploaded CSV, return parsed rows (not saved) |
| POST | `/import/confirm` | Save previewed transactions, run categoriser, return counts |
| GET | `/transactions?month=&category=&source=&confirmed=` | Paginated transaction list |
| PATCH | `/transactions/{id}` | Update category and/or confirmed status |
| GET | `/transactions/review` | Next uncategorised transaction for card review |
| GET | `/categories` | All categories |
| GET | `/budget?month=YYYY-MM` | Budget rows for a month (auto-creates from defaults if missing) |
| PATCH | `/budget/{id}` | Update a budget row's planned_amount |
| PATCH | `/budget/defaults/{category_id}` | Update the default planned_amount for a category |
| GET | `/rules` | All rules |
| POST | `/rules` | Create a rule |
| PATCH | `/rules/{id}` | Update a rule |
| DELETE | `/rules/{id}` | Delete a rule |
| POST | `/rules/test` | Test a pattern against all transactions, return matches |

## Pages

### Dashboard (`/`)
- Summary cards: Income, Spent, Saved, Left Over
- Planned vs Actual bar chart by category
- 50/30/20 donut chart (Needs / Wants / Savings)
- Monthly spending trend line chart
- Month selector (navigate between months)

### Import (`/import`)
- File upload with source selector (ING / Revolut / DEGIRO)
- Preview of parsed transactions before confirming import
- Deduplication: transactions with matching `import_hash` are skipped with a count shown
- On import: rules engine runs immediately, unmatched transactions are sent to Claude for AI categorisation

### Transactions (`/transactions`)
- Full transaction table, filterable by month, category, source, status
- Unconfirmed transactions shown first (orange badge count = rows where `confirmed = false`)
- Rule-matched transactions (`categorised_by = rule`) are `confirmed = true` and do not appear in the review queue
- Card-by-card review for unconfirmed transactions (`confirmed = false`):
  - Shows merchant, amount, date, source
  - If `categorised_by = ai`: shows AI suggestion + confidence percentage; user confirms or overrides
  - If `categorised_by = null`: no suggestion; user picks from category list
  - On confirm/override: `confirmed = true`, `categorised_by = manual` (if overriding AI)
  - "Always categorise [merchant] as [category]" button: pre-fills rule pattern with the trimmed lowercase description; saves rule; retroactively re-categorises all existing unconfirmed transactions matching the new rule (`confirmed = true`, `categorised_by = rule`); confirms the current transaction

### Budget (`/budget`)
- Table of categories with planned amount per selected month
- Separate "Default" column to update the template for future months
- Edit inline (PATCH on blur)
- Shows actual vs planned for current month

### Rules (`/rules`)
- Table of pattern → category rules
- Add, edit, delete rules
- Test a rule against existing transactions to preview matches

### Settings (`/settings`)
- Manage categories (name, type, sort order)
- Set 50/30/20 target percentages
- Future: ING Open Banking API credentials

## Categorisation Flow

1. Transaction imported → rule engine checks all rules in priority order (case-insensitive substring match on `description`)
2. Match found → `category_id` set, `confirmed = true`, `categorised_by = rule`
3. No match → Claude API called with `description` + list of category names. Response is structured output (JSON): `{ "category": "<name>", "confidence": 0.0–1.0 }`. Elicited via a system prompt instructing the model to return only valid JSON.
4. AI response stored: `category_id` set, `confirmed = false`, `categorised_by = ai`, `ai_confidence` = returned float
5. If Claude call fails → `category_id = null`, `confirmed = false`, `categorised_by = null`; surfaced in review queue
6. User reviews card → confirms or overrides → `confirmed = true`
7. Optional: user creates rule → new rule saved, all matching unconfirmed transactions retroactively confirmed

## Category Structure (initial seed data)

**Needs (50% target)**
- Taxes & Mortgage
- Utilities
- Food - Essential
- Transportation
- Insurance
- Medical & Healthcare

**Wants (30% target)**
- Food - Not Essential
- Recreation & Entertainment
- Miscellaneous

**Savings (20% target)**
- DEGIRO
- Fun Account

## CSV Import Format Notes

Each importer normalises to the common transaction schema (signed `amount`, `date`, `description`):

**ING** (semicolon-delimited, English export, all values quoted):
- `date` ← `Date` (format: `YYYYMMDD`)
- `description` ← `Name / Description`
- `amount` ← `Amount (EUR)` as decimal, negated if `Debit/credit` == `"Debit"`, kept positive if `"Credit"`

**Revolut** (comma-delimited):
- `date` ← `Started Date` (format: `YYYY-MM-DD HH:MM:SS`, truncated to date)
- `description` ← `Description`
- `amount` ← `Amount` (already signed: negative = debit)
- Skip rows where `State` == `"REVERTED"` (failed/cancelled transactions)

**DEGIRO** (comma-delimited):
- `date` ← `Date` (format: `DD-MM-YYYY`)
- `description` ← `Product`
- `amount` ← `Value` (already signed)

## Future: ING Open Banking API

The importer interface (`importers/base.py`) is designed to support both file-based and API-based sources. ING's API (https://developer.ing.com) will be added as a future importer, fitting the same interface. Settings page will hold API credentials.

## Error Handling

- CSV parse errors: show per-row errors in import preview, allow partial import of valid rows
- AI categorisation failure (API error or invalid JSON response): transaction left as uncategorised (`categorised_by = null`), surfaced in review queue
- Duplicate import: transactions whose `import_hash` already exists are skipped; count of skipped rows shown to user after import

## Testing

- Backend: pytest with a real SQLite test database (no mocking); unit tests for each importer, rule engine, and API routes
- Frontend: Vitest for component tests; focus on import flow and review card behaviour

## Out of Scope (v1)

- Multi-user / authentication
- Mobile app
- Automatic bank sync (ING Open Banking deferred to v2)
- Export to CSV/Excel
- Email reports
