---
date: 2026-08-02
git_commit: 18c3530
branch: main
repository: household-finance
phase: 1-question
---

# Task

Rework the Household Finance front end and add two targeted capabilities. Migrate the UI to
Tailwind + shadcn/ui with an original, restrained visual design, collapse the seven nav pages to
four (Overview / Transactions / Budget / Settings), and rebuild the dashboard and review flow from
scratch — including feeding the user's own confirmed categorisation history into the AI prompt so
the app finally learns from its own data. Add opt-in per-category rollover balances so
unpredictable lumpy bills stop wrecking a month, and track DEGIRO portfolio value over time via
dated snapshots of the Portfolio CSV export.

The existing backend model (financial months anchored to payday, needs/wants/savings, refunds as
contra-expense, splits, standing adjustments) stays as-is. This is a front end worth the model's
quality, plus two targeted additions.

## Why

Three pains, in the user's own framing:

1. **The import + review grind** — rules don't generalise, many decisions are genuinely hard, and
   the AI suggestions aren't trusted so every one gets checked anyway. Root cause: the app has no
   learning loop; every import is a cold start.
2. **It tells you what happened, not what to do** — the app reports, it doesn't advise.
3. **The dashboard and front end contain a lot that doesn't earn its place** — plus things spread
   across pages that belong together.

Rollover balances are the one primitive that makes lumpy, unpredictable bills survivable without
forecasting anything — the user knows neither the amount nor the timing of bills like taxes, which
rules out classic sinking funds. A buffer pot was proposed and explicitly rejected.

## Sequencing (agreed in brainstorm)

Thin foundation step, then vertical slices — each slice rebuilds one page on the new foundation
*and* ships its backend feature together, so the project can stop cleanly after any of them.

- **Slice 0** — Foundation: Tailwind + shadcn/ui, tokens ported, contrast failures fixed,
  primitives built, nav collapsed to four routes. No page rewrites.
- **Slice 1** — Review flow + learning AI.
- **Slice 2** — Budget + rollover (largest backend change).
- **Slice 3** — Overview rebuild (Dashboard + Analytics merged).
- **Slice 4** — DEGIRO portfolio-value tracking.

## Constraints

- **Visual direction:** "not AI sloppish with all the gradients/shadows that AI likes adding in
  everywhere. Make it a beautiful original design." A hard constraint on the design phase.
- **Desktop-first**, but must not break on a phone.
- **50/30/20 needs/wants/savings stays** — the user values the lens, not as a target they're
  failing to hit.
- The user wants **better assistance, not more automation** — no auto-proposed rules, no fuzzy
  matching; they stay in control of each decision.
- **The AI prompt must be bounded in size, and stay bounded forever.** Feeding confirmed history
  into the prompt must not mean pasting in the full decision log. Prompt length must be a function
  of a fixed budget — not of how long the app has been in use. Naively appending every past
  decision grows without limit, which makes the model steadily more expensive *and* less accurate
  as the signal gets buried. The history that goes in must be **selected and capped** (e.g.
  relevance to the transaction at hand, recency, or per-category top-N exemplars), with a hard
  ceiling that holds at year five as well as month one. Any design that has no such ceiling is
  not acceptable.
- Category add/rename/delete/reorder is **already built** (commit `18c3530`) — do not re-propose.

## Open questions carried into Research/Design

- **How history is selected and capped for the prompt** — which selection strategy, what the
  ceiling is, and how it is enforced and verified. See the bounded-prompt constraint above.
- Rollover semantics for overspent categories: carry the negative, or zero and absorb?
- Whether rollover balances are stored state or derived-with-carry.
- How unconfirmed transactions should be surfaced (currently invisible in all totals).
- Whether DEGIRO share purchases currently double-count as household expenses.
- DEGIRO snapshot cadence and irregular-snapshot handling.
- The visual direction itself — needs a real proposal, not a menu.

Full context, alternatives considered, and the deferred-features catalogue: `brainstorm.md`.
