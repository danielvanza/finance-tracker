---
date: 2026-08-02
git_commit: 18c3530
branch: main
repository: household-finance
phase: 1-question
---

# Research Questions

## Context

This is a personal-finance application: a FastAPI + SQLAlchemy backend in `backend/` and a React
19 + Vite front end in `frontend/`. Research should cover both halves broadly — the front end's
styling and component architecture, its routing and page structure, and the backend's transaction,
categorisation, budget, import, and aggregation paths, along with how the database schema comes
into existence and evolves.

Answers should be strictly factual: what exists today, where it lives (file paths and line
anchors), and how the pieces connect. Trace flows end to end rather than describing files in
isolation. Where the same logic appears in more than one place, say so and note how the copies
differ. Where behaviour is covered by tests, note which test file pins it — backend tests are in
`backend/tests/` (pytest), front-end tests in `frontend/src/tests/` (vitest).

## Questions

1. **How is the front end structured — both how it is styled and how data reaches each page?**
   On styling: what design tokens are defined and where, how components actually consume (or
   bypass) them, what build tooling and CSS configuration exist, which stylesheets are live versus
   unreferenced, what shared UI primitives exist as reusable components versus being
   re-implemented per page, and what is the current state of responsive behaviour, keyboard
   interaction, focus management and ARIA usage — including how the hand-rolled interactive
   widgets (dropdowns, modals, drag-reorder) implement those behaviours. On data flow: enumerate
   every route and page component, and for each one which API client methods it calls, which
   backend endpoints those hit, and what it renders from the response. Where do two or more pages
   read from the same endpoint or display the same underlying data? How is server state fetched,
   cached and invalidated, and how is the currently-selected month held and passed around?

2. **Trace the full lifecycle of a transaction from import to confirmed state.** Follow it through
   file parsing, deduplication, rule matching, AI categorisation, the review queue, and the patch
   that confirms it. What determines the order transactions are reviewed in? What exactly happens
   when a rule is created from a transaction — how is the pattern derived, how is it matched
   afterwards, and what retroactive effect does it have on existing rows? How do refunds, splits,
   transfers, and manually-created transactions travel through that same path differently?

3. **How does the AI categorisation path work, and what bounds the size of what it sends?**
   Document the prompt construction in full: what is sent, what is not, what response shape is
   expected, how failures and invalid responses are handled, how batching and model configuration
   are set, and where the result and its confidence are persisted. Then quantify the size
   question: which inputs does prompt length scale with today (number of transactions? categories?
   anything that grows without limit as the database accumulates rows?), what mechanisms currently
   cap or chunk what is sent, how are token counts, `max_tokens`, cost, or latency observed or
   controlled anywhere in the codebase, and is any form of prompt caching or reuse configured?

4. **What does the system record about how each transaction was categorised, and how could a
   bounded subset of that record be queried?** Inventory the columns, enums, and relationships
   that capture who or what assigned each category and whether a human subsequently confirmed or
   changed it — including where those values are set, overwritten, or downgraded along the flows
   in question 2. Then characterise the data as a dataset: roughly how many rows accumulate per
   month and in total, what indexes and unique constraints exist on the transaction and category
   tables, and which query shapes are therefore cheap — filtering by category, by recency, by
   description text, by categorisation source, or selecting the top-N most frequent values.
   Is there any existing query in the codebase that retrieves a capped or ranked subset of
   transactions rather than a full window, and how is that limit expressed?

5. **How are categories and budgets modelled, and how is "actual" spending computed?** Cover the
   category schema (fields, types, ordering, CRUD, referential constraints) and the budget schema,
   including how default/template rows relate to per-month rows and how a month's rows come into
   existence. Then trace the budget-versus-actual computation step by step: how the financial-month
   window is derived, which transactions are included or excluded and on what criteria, how splits,
   refunds and standing adjustments are folded in, and which shared helpers enforce that. What
   state is persisted versus recomputed on every request?

6. **How is the database schema created, evolved, and seeded?** Document the ORM model definitions
   and their relationships and constraints, how tables are brought into being at startup, what
   mechanism exists (if any) for adding columns or altering existing tables on a database that
   already has data, how backfills are handled, how seeding works and when it runs, and how the
   test suite constructs its database differently from the running application. What would adding
   a new table or a new column to an existing table concretely involve today?

7. **How does the CSV import pipeline work per source, and what do the aggregate/reporting
   endpoints compute?** For each importer: which columns it reads, which it discards, what
   filtering or row-skipping it applies, and how the deduplication hash is built and enforced at
   each layer. For the reporting endpoints: what each one returns, how totals and breakdowns are
   assembled, how multi-month trends are produced, and precisely which transactions are counted
   versus filtered out of every total.
