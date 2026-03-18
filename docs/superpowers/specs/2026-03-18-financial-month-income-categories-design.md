# Financial Month & Income Categories — Design Spec

**Date:** 2026-03-18
**Status:** Approved

## Overview

Two features that share surfaces across the backend and frontend:

1. **Financial month start day** — configurable day-of-month (default 24) that defines the financial period. "April 2026" means Mar 24 – Apr 23. Stored in a `Setting` database table, changeable from a new Settings page.
2. **Income categories** — new `income` value in the `CategoryType` enum. Positive-amount transactions get categorised into income categories (Salary, Refunds, Other Income). Income categories appear in the dashboard breakdown but are excluded from the 50/30/20 budget.

## Data Model Changes

### New model: `Setting`

Key/value table for app-wide configuration.

| Column | Type          | Notes                              |
|--------|---------------|------------------------------------|
| key    | String(100)   | Primary key                        |
| value  | String(500)   | Stored as string, parsed by caller |

Seeded with one row: `key="financial_month_start_day"`, `value="24"`.

### Modified enum: `CategoryType`

Add `"income"` alongside `"needs"`, `"wants"`, `"savings"`.

### New seeded categories

| Name         | Type   | Budget |
|--------------|--------|--------|
| Salary       | income | none   |
| Refunds      | income | none   |
| Other Income | income | none   |

Income categories do **not** get default budget rows.

## Financial Month Logic

### Date range calculation

Given a `month` label (e.g. "2026-04") and a `start_day` (e.g. 24):
- **Start date:** previous month's `start_day` → `2026-03-24`
- **End date:** this month's `start_day - 1` → `2026-04-23`

This is a pure date-range calculation. No weekend adjustment — the boundary is always fixed at the configured day.

### Shared helper

A single utility function `get_financial_month_range(year, month, start_day) -> (date, date)` used by all routers (dashboard, budget, transactions). Replaces the current `extract(year/month)` queries with `date BETWEEN :start AND :end`.

### Month picker

The frontend month picker continues to use `YYYY-MM` strings. The backend interprets "2026-04" as "the financial period labelled April 2026" and computes the actual date range server-side.

## Income Category Behaviour

### Categorisation

- **Rules engine:** When matching, filter available categories by transaction sign. Positive amounts only match rules pointing to income categories. Negative amounts only match rules pointing to needs/wants/savings.
- **AI categoriser:** Include the amount sign in the prompt context. Pass only income category names for positive transactions, only expense category names for negative ones.
- **Manual review (frontend):** The category dropdown filters by transaction sign. Positive → income categories only. Negative → expense categories only.

### Dashboard

- `total_income`: sum of confirmed positive-amount transactions in the period (unchanged logic, but now these transactions have category breakdowns).
- New field `income_breakdown`: list of `{category, amount}` for income-type categories, mirroring the existing `category_breakdown` for expenses.
- `category_breakdown`: unchanged — only expense categories (needs/wants/savings).
- `needs_wants_savings`: unchanged — only expense categories.
- `monthly_trend`: unchanged — only expense totals.

### Budget

- `_auto_populate()`: skip categories where `type == "income"`. Income categories never get budget rows.
- Budget actual-spend query: unchanged — still filters `amount < 0`, now also explicitly excludes income-type categories for safety.

### Transactions list

- No change to the listing endpoint. Income transactions already display with green `+` amounts.
- The `month` filter switches to the financial month date range (same as dashboard/budget).

## API Changes

### New endpoints

| Method | Path                   | Description                          |
|--------|------------------------|--------------------------------------|
| GET    | `/api/settings`        | Returns all settings as key/value    |
| PATCH  | `/api/settings/{key}`  | Updates a single setting value       |

### Modified endpoints

All endpoints accepting a `month` query parameter now interpret it as a financial month label and compute the date range server-side using the configured start day.

| Endpoint                    | Change                                                        |
|-----------------------------|---------------------------------------------------------------|
| GET `/api/dashboard`        | Uses financial month range; adds `income_breakdown` to response |
| GET `/api/budget/{month}`   | Uses financial month range                                    |
| GET `/api/transactions`     | Uses financial month range                                    |
| POST `/api/imports/confirm` | Categorisation is now sign-aware                              |

### Schema changes

- `DashboardSummary`: add `income_breakdown: list[dict]` field.
- New `SettingOut` and `SettingPatch` schemas.

## Frontend Changes

### New page: Settings

- Route: `/settings`
- Single numeric input for financial month start day (1–28).
- Displays example period for the current month.
- Calls `PATCH /api/settings/financial_month_start_day`.

### Modified: Dashboard

- Income summary card shows category sub-totals (e.g. "Salary: 5,000 | Refund: 200").
- Month label shows the financial period dates below (e.g. "Mar 24 – Apr 23").

### Modified: Transaction review / category dropdown

- When reviewing a transaction, the category `<select>` filters options by sign:
  - `amount > 0` → only income-type categories
  - `amount < 0` → only expense-type categories
- The categories API already returns the `type` field, so filtering is frontend-only.

### Modified: Nav

- Add "Settings" link to the navigation bar.

## Testing

### Backend

- **Unit tests for `get_financial_month_range()`**: boundary cases (start_day=1, start_day=28, year rollover Dec→Jan).
- **Settings API tests**: GET/PATCH, validation (must be 1–28).
- **Income category tests**: seed verification, sign-aware categorisation.
- **Dashboard tests**: verify `income_breakdown` field, verify financial month date filtering.
- **Budget tests**: verify income categories are excluded from auto-populate and actual-spend.

### Frontend

- **Settings page**: renders, saves, validates.
- **Category dropdown filtering**: positive amounts show income categories, negative show expense.

## Out of Scope

- Weekend-adjusted salary dates (the financial month boundary is always the fixed start day).
- Income budget tracking (planned vs actual income).
- Migration tooling — tables are auto-created via `create_all()`.
