# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Daniel and his partner, a Dutch household. Both open the app under the one shared sign-in of the life dashboard; there are no per-person accounts or per-person figures. Wording and flows can't assume which of the two is looking.

## Product Purpose

Household Finance shows the household whether it is on track this financial month. It turns bank CSV exports into categorised transactions and compares them against a 50/30/20 budget. Success means opening it answers "are we on track?" at once, and that the routine of importing and reviewing is small enough to keep up.

## Positioning

A private household ledger that sits beside the life dashboard: the household's own bank exports and categories, with rules and Claude doing the sorting and a person confirming what Claude guessed. No bank connection and no third-party account.

## Operating Context

- Budgeting has lapsed for weeks to months and is being picked up again. Coming back after a gap, with stale data and a large review backlog, is a normal state the product has to handle, and there is no settled import rhythm yet.
- The routine is: export CSVs from the banks, import, review what rules didn't settle, check the month.
- The financial month starts on a configurable day (default the 24th), so "this month" is not the calendar month.
- Reached from the life dashboard at `/finances`, in its own tab.

## Capabilities and Constraints

- Sibling app of life-dashboard: separate repository, backend, build and deploy (loopback port 18600, proxied at `/finances`). It has no sign-in of its own; the dashboard's sign-in protects it.
- CSV importers for ING, Revolut and DEGIRO, plus manually added transactions. Deduplicated by hash of source, date, amount and description.
- Categorisation: priority-ordered substring rules first (auto-confirmed), then Claude (needs human review), otherwise uncategorised.
- Category types: needs, wants, savings, income, exclude. Categories are user-managed and ordered.
- Budget per category per month, with drill-down and recategorisation.
- Transactions can be split across categories and marked as refunds. Standing adjustments are monthly recurring income/expense pairs.
- Money is integer cents on the wire. British spelling for domain terms (categorise).
- Undecided: whether the household wants reminders that an import is due, and in what form.

## Brand Commitments

- The visual design aligns with life-dashboard (`/home/daniel/code/life-dashboard/DESIGN.md`); the two should read as one system.
- Named "Finances" where the dashboard links to it.

## Evidence on Hand

- No real transactions in the development database (`backend/data/finance.db`: 21 categories, 16 budgets, 0 transactions). Designs use clearly synthetic figures; real figures live only in the production database and are not used for design work.

## Product Principles

- Answer "are we on track?" before showing anything else.
- Make coming back easy: a gap in the data is a state to guide through, not an error or a guilt trip.
- People confirm, machines sort: keep human review of guesses fast and obvious.
- Simple over elaborate: fewer places to go, and nothing on screen without a job.
- Written for two people: neutral about who is looking.
