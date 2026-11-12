# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Daniel and his partner, a Dutch household. Both open the app under the one shared sign-in of the life dashboard, and both talk to its bot in one Telegram group; there are no per-person accounts or per-person figures. One of the two is not technical. Wording and flows can't assume which of the two is looking.

## Product Purpose

Household Finance shows the household whether it is on track this financial month. It turns bank CSV exports into categorised transactions and compares them against a 50/30/20 budget. Success means opening it answers "are we on track?" at once, and that the routine of importing and reviewing is small enough to keep up.

## Positioning

A private household ledger that sits beside the life dashboard: the household's own bank exports and categories, with rules and Claude doing the sorting and a person confirming what Claude guessed. No bank connection and no third-party account.

## Operating Context

- Budgeting has lapsed for weeks to months and is being picked up again. Coming back after a gap, with stale data, is a normal state the product has to handle.
- The routine is: export a CSV from ING, send it to the bot or the Import page, answer the few questions about what Claude was not sure of, check the month. The bot says when the bank data is more than a week old.
- The financial month starts on a configurable day (default the 24th), so "this month" is not the calendar month.
- Reached from the life dashboard at `/finances`, in its own tab.

## Capabilities and Constraints

- Sibling app of life-dashboard: separate repository, backend, build and deploy (loopback port 18600, proxied at `/finances`). It has no sign-in of its own; the dashboard's sign-in protects it.
- The shared ING account only: ING exports with English or Dutch columns, plus manually added transactions. A row already in is skipped, whichever language its earlier export was in.
- Sorting: rules first (the longest matching text wins), then Claude. A guess Claude is sure of counts at once; a doubtful one waits, counts nowhere, and is asked about. A person's answer for a shop becomes a rule when they ask for it: a button after the answer, or a tick box in the app.
- Category types: needs, wants, savings, income, exclude. Categories are user-managed and ordered.
- A plan per category; a changed amount applies from its month on. The household sets its own target split between needs, wants and savings.
- The headline is "free to spend until payday": what is left in the plan, less fixed bills still to come and what the month sets aside.
- Set-asides spread a yearly or irregular bill over the months before it is due.
- Transactions can be split across categories and marked as refunds. Money moved to one of the household's own accounts counts as spending.
- A Telegram bot in the household's group: text, voice notes in English, photos and ING files. It writes first when the bank data is old, with a weekly recap and at the month's close.
- Money is integer cents on the wire. British spelling for domain terms (categorise).

## Brand Commitments

- The visual design aligns with life-dashboard (`/home/daniel/code/life-dashboard/DESIGN.md`); the two should read as one system.
- Named "Finances" where the dashboard links to it.

## Evidence on Hand

- No real transactions in the development database (`backend/data/finance.db`: 21 categories, 16 budgets, 0 transactions). Designs use clearly synthetic figures; real figures live only in the production database and are not used for design work.

## Product Principles

- Answer "what is free to spend?" before showing anything else.
- Make coming back easy: a gap in the data is a state to guide through, not an error or a guilt trip.
- Machines sort, people decide the doubtful: what Claude is sure of counts by itself; what it is not sure of is a short question, asked once.
- Simple over elaborate: fewer places to go, and nothing on screen without a job.
- Written for two people: neutral about who is looking.
