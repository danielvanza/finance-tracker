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
| categorised_by | enum | rule / ai / manual |
| import_hash | str | deduplication hash |

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
| month | date | first day of month |
| planned_amount | decimal | |

A **default budget** per category is stored as `month = NULL`. New months auto-populate from defaults; individual months can be overridden.

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
- On import: rules engine runs immediately, unmatched go to AI queue

### Transactions (`/transactions`)
- Full transaction table, filterable by month, category, source, status
- Flagged/unconfirmed transactions shown first (orange badge with count)
- Card-by-card review for uncategorised transactions:
  - Shows merchant, amount, date, source
  - AI suggestion with confidence score
  - One-click confirm, or pick from category list
  - Option to create a rule: "Always categorise [merchant] as [category]"

### Budget (`/budget`)
- Table of categories with planned amount per month
- Edit inline
- Default column: set once, auto-fills future months
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
2. Match found → category assigned, `confirmed = true`, `categorised_by = rule`
3. No match → Claude API called with transaction description + list of available categories → suggestion returned with confidence
4. AI suggestion stored, `confirmed = false`, `categorised_by = ai`
5. User reviews card → confirms or overrides → `confirmed = true`
6. Optional: user creates rule to automate future matches

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

Each source has a different CSV format; each importer normalises to the common transaction schema:

- **ING:** Semicolon-delimited; columns include Datum, Naam/Omschrijving, Bedrag, Af Bij
- **Revolut:** Comma-delimited; columns include Date, Description, Amount, Currency
- **DEGIRO:** Comma-delimited; transaction history export with Date, Product, Value columns

## Future: ING Open Banking API

The importer interface (`importers/base.py`) is designed to support both file-based and API-based sources. ING's API (https://developer.ing.com) will be added as a future importer, fitting the same interface. Settings page will hold API credentials.

## Error Handling

- CSV parse errors: show per-row errors in import preview, allow partial import
- AI categorisation failure: transaction left as uncategorised, surfaced in review queue
- Duplicate import: skip silently, show count of skipped duplicates to user

## Testing

- Backend: pytest with test SQLite database; unit tests for each importer, rule engine, and API routes
- Frontend: Vitest for component tests; focus on import flow and review card behaviour
- No mocking of the database in backend tests — use a real SQLite test DB

## Out of Scope (v1)

- Multi-user / authentication
- Mobile app
- Automatic bank sync (ING Open Banking deferred to v2)
- Export to CSV/Excel
- Email reports
