---
date: 2026-08-02
git_commit: 18c3530
branch: main
repository: household-finance
phase: 3-design
---

# Design Discussion

## Current State

**The backend model is sound; the front end is not.** `aggregate.py:1-27` is the one place
duplication was deliberately factored out, and the financial-month window
(`financial_month.py:4-43`) is pinned by 8 tests. Everything below is what the rework touches.

- **No styling system.** 428 inline `style={{…}}` objects across 17 files; 7 `className` usages
  total, all `"animate-fade-in"`. 110 hardcoded hex literals duplicating `index.css` values, ~520 px
  literals, ~40 tokens with zero consumers. **No spacing scale and no type scale exist**
  (`index.css:6-134`). No Tailwind, PostCSS, or CSS Modules — `vite.config.ts` is 17 lines.
- **No primitives.** Only `CategorySelect.tsx` and `SplitEditor.tsx` are shared. Card shell ×12
  with subtly differing shadows (`Dashboard.tsx:51-58` … `ReviewCard.tsx:96-103`), gradient button
  ×9, `labelStyle` ×3, 4 loading treatments, 4 empty states, two independent dropdowns
  (`CategorySelect.tsx` and `Budget.tsx:21-115`).
- **Accessibility is broken by default.** 18 aria attributes app-wide, 5 keyboard handlers, 0
  `tabIndex`. Both modals lack `role="dialog"`, focus trap, Escape and focus restore
  (`SplitModal.tsx:68-86`, `AddTransactionModal.tsx:114-133`). Budget's two primary interactions are
  click handlers on a `<tr>` (`Budget.tsx:320`) and a `<span>` (`:370`). `outline:'none'` at 8 sites
  cancels the global focus ring. `--text-muted` on `--bg-card` measures **2.2:1** against a 4.5:1 AA
  floor and is used for real content.
- **Zero responsive breakpoints ship** — the only `@media (max-width:…)` rules live in dead
  `App.css`. `Nav.tsx:74-84` is a non-collapsing 7-link row.
- **The AI has no memory.** `ai.py:81-87` sends a comma-joined list of **category names only** — no
  history, no descriptions, no reasoning requested. The prompt never reads the `transactions` table.
  The live DB shows `categorised_by='ai'` on **0 of 222 rows**.
- **Rules cannot generalise.** `transactions.py:241` uses `tx.description.lower().strip()` — the
  *entire* description — as the pattern, with no edit step. Three different matching mechanisms exist
  for one concept (`rules.py:20`, `transactions.py:251`, `rules.py:51-53`).
- **No persistent category balance exists.** Every month starts at zero by construction
  (`budget.py:70-82`). This is the structural gap rollover fills.
- **Unconfirmed rows are invisible.** All three window queries filter `confirmed == True`
  (`budget.py:70-74`, `dashboard.py:33-37`, `:106-110`) with nothing on screen saying so.
- **Month state is component-local `useState` in three pages**, each with its own `currentMonth()`
  copy (`Dashboard.tsx:23-26`, `Analytics.tsx:21-24`, `Budget.tsx:241-244`). Navigating resets it.
- **No error handling.** No `api.ts` method checks `response.ok` (`api.ts`, all 26); no `useQuery`
  destructures `isError`; no error boundaries.
- **Zero DEGIRO rows have ever been imported** (live DB: ing 214 / manual 8). The DEGIRO category
  holds one −€300 ING outflow.

## Desired End State

Four routes — Overview / Transactions / Budget / Settings — on a Tailwind + shadcn/ui foundation
with a single token set consumed through classes, plus two backend capabilities: opt-in per-category
rollover, and DEGIRO portfolio-value tracking. Verifiable when:

- Zero `style={{}}` objects remain in rewritten pages; zero hardcoded hex literals; every token has
  a light and a dark value and every text/background pair clears 4.5:1.
- Every interactive element is keyboard-reachable, modals trap focus and restore it, `jsx-a11y`
  is in the ESLint config and passes.
- The layout survives a 375px viewport without horizontal overflow.
- The AI prompt's character count is asserted by a test to stay under a fixed ceiling given a
  synthetic 50k-row history.
- A rollover category's balance is reproducible by hand from its month sequence.
- No portfolio snapshot ever appears in `transactions`.

## Patterns to Follow

- **`aggregate.py:12-27`** — `effective_parts` / `is_spend_part`. Every new money calculation goes
  through these. The docstring states the invariant; keep it true.
- **`financial_month.py:4-43`** — the window helper, already total by construction via its
  `1 <= start_day <= 28` guard. Rollover walks months using *this*, never calendar arithmetic.
- **`ReviewCard.tsx:184-207`** — the one correct `role="radiogroup"` in the app. The a11y bar for
  every new primitive is this, not what `AddTransactionModal.tsx:149-233` does.
- **`categories.py:77-79`** — reorder as a permutation among submitted ids only, so untouched rows
  never shift. Good, and already shipped; leave alone.
- **`adjustments.py:46`** — deterministic hash for idempotent re-materialisation. The pattern
  DEGIRO snapshot import should copy for repeat uploads of the same export.

**Do NOT follow:**

- **`_get_start_day` copy-pasted into three routers** (`budget.py:15-17`, `dashboard.py:15-17`,
  `transactions.py:20-22`) and the month-window query duplicated three times. Extract before
  Slice 2 adds a fourth caller.
- **Reads that write.** `GET /budget` materialises budget rows *and* standing adjustments;
  `GET /dashboard/summary` and `GET /transactions?month=` materialise adjustments. Rollover must not
  add a fourth. Balances are computed, never persisted as a GET side effect.
- **`api.ts`'s `.then(r => r.json())`** with no `response.ok` check — a 4xx resolves successfully as
  `{"detail": …}`. Fix in Slice 0; do not replicate in new methods.
- **Endpoints with no `response_model`.** `DashboardSummary` and `BudgetRow` are defined and never
  imported (`schemas.py:122-130`, `:157-166`); `BudgetRow` is already missing a key the handler
  emits. Wire response models on every new or rebuilt endpoint.
- **Bare `print()` for diagnostics** (`ai.py`, 5 calls). The AI path gets real logging in Slice 1.
- **The `run_migrations` DDL dict** (`db.py:20-28`) is hand-written and has **already drifted** from
  the models (missing `ON DELETE SET NULL`, wrong nullability) with zero test coverage. Every new
  column is two edits — model *and* fragment — and they must be written to agree.

## Design Decisions

1. **Visual direction — "Ledger."** Structure from hairlines and whitespace, not boxes and shadows.
   No shadow tokens and no `--grad-*` get ported. Typography carries the design: a text face plus a
   **tabular-figure** face, with every amount decimal-aligned. Colour is near-absent and therefore
   meaningful — a neutral ink/paper ramp, two semantic hues (over/under), one accent used only for
   the primary action and current selection. needs/wants/savings becomes a typographic tag, killing
   the three duplicate colour maps. Motion on state change only (~150ms); the seven page-entrance
   fades go. Charts obey the same rules: hairline gridlines, no gradient area fills, direct labels.
   *Why:* the hard constraint was "not AI sloppish with all the gradients/shadows" — met at the
   token level, so it can't recur page by page.

2. **Light + dark, dark default.** Both ramps defined in Slice 0 so no later page rewrite can be
   theme-blind; dark stays what the app opens to. `--text-muted`'s 2.2:1 failure is fixed once, in
   both ramps.

3. **Bounded prompt — hybrid guide + neighbours.** A cached prefix block (per category: name, type,
   top-3 most-frequent confirmed descriptions) plus, per batch, confirmed history only for
   descriptions actually present in that batch. Prompt size = f(categories × 3 + batch × k), never
   f(database age). Enforced by a single `build_history_block()` with a `MAX_CHARS` constant that
   hard-truncates, pinned by a test against a synthetic large history. The prefix is a content-block
   list with a `cache_control` breakpoint — impossible today because `ai.py:92` is a plain string.
   *Why:* per-category exemplars alone give the batch's actual merchants no targeted evidence;
   retrieval alone gives a novel merchant nothing, which is exactly where AI is needed.

4. **Rollover carries the negative.** Balance is a running total with no special case: one rule to
   implement, explain and test. Opt-in per category via `rollover_enabled`; no second toggle.
   *Why:* zero-and-absorb makes the overspend vanish from the category that caused it, and needs a
   second rule to state a truth the data already contains.

5. **Rollover is derived-with-carry, not stored.** Two columns on `Category`
   (`rollover_enabled`, `rollover_start_month`); balance is recomputed by walking months from the
   start month. *Why:* stored balances go stale on any retro-edit or late confirmation — which
   happens constantly, since `confirmed` gates all money. Derived is self-healing, and two columns is
   the cheapest possible change under the `db.py` migration mechanism.

6. **Unconfirmed: excluded, with a persistent banner.** Aggregation semantics do not change. Every
   money-bearing page shows "N unconfirmed (€X) not counted" linking into review. *Why:* no number
   ever means two things, and the invisible gap becomes a call to action.

7. **Nav: Import and Rules both live inside Transactions.** The list, the review queue, an Import
   action and rule management on one page. *Why:* the review → Rules-page round trip is the
   mechanical cause of "rules don't generalise"; folding it in is the fix.

8. **Rule patterns become editable at creation**, with a live count of how many existing rows the
   pattern would match, and one matching mechanism replacing today's three.

9. **DEGIRO snapshots are a new `portfolio_snapshots` table, never `transactions`.** Contributions
   come from existing ING→DEGIRO savings rows; growth = value change − contributions over the window.
   Irregular snapshots plot on a real date axis and are never interpolated. Repeat uploads of the
   same export are idempotent by deterministic key. *Why:* double-counting is impossible by
   construction, and zero degiro-source rows exist today, so there is nothing to reconcile.

10. **Month selection moves to a URL search param**, replacing three local `useState` copies, so
    navigation preserves it and a month is linkable.

## What We're NOT Doing

- **Not rewriting the backend financial model** — financial months, needs/wants/savings, refunds as
  contra-expense, splits, standing adjustments all stay exactly as they are.
- **Not touching category CRUD/reorder** — shipped in `18c3530`.
- **Not adding automation:** no auto-proposed rules, no fuzzy or similarity matching, no
  auto-confirm on high confidence. Better assistance, not more automation.
- **Not migrating Import and Settings ahead of time** — they move onto the new primitives when the
  slice that touches them touches them.
- **Not building** targets, scheduled transactions, recurring detection, a multi-condition rule
  engine, accounts/net worth, position-level DEGIRO accounting, tags, or per-person attribution.
  All catalogued as deferred in `brainstorm.md`.
- **Not adding indexes, pagination or caching** to the backend at 222 rows — noted as a future
  concern, not this project.
- **Not deleting the existing `degiro.py` statement importer**, but not using it either.

## Open Risks

- **Migration drift is the highest-risk mechanic here.** Slices 2 and 4 each add columns/tables under
  a hand-written DDL dict that has already drifted, with no test coverage — and tests build schemas
  from the models, so drift is structurally invisible to the suite. Slice 2 should not add a column
  before `run_migrations` has a test that compares live schema to model metadata.
- **Rollover interacts with lazy budget materialisation.** `_auto_populate` (`budget.py:20-42`) runs
  on first `GET /budget` only, so a month never opened has no rows — and a derived balance walking
  months would see a gap. `GET /dashboard/summary` doesn't call it at all. Walk semantics for
  unmaterialised months need pinning explicitly.
- **The AI history block has no real data to validate against** — 0 of 222 rows are AI-categorised
  and no accuracy or confidence telemetry has ever been recorded. Slice 1 should log token counts
  and outcomes from day one, or there will still be nothing to tune against at the end of it.
- **Two tests issue live Haiku calls** (`test_imports.py`, via `load_dotenv()` at `main.py:1-2` and
  a real key in `backend/.env`). Slice 1 changes the prompt; these need mocking first or the suite
  gets slower, costlier and non-deterministic as the prompt grows.
- **`aggregate.py` is inert against production data** — `transaction_splits` is empty and both the
  Revolut and DeGiro importers have never run against a real file. Split and multi-source paths are
  tested but unexercised.
- **Contrast fixes may shift the palette more than expected.** Raising `--text-muted` to 4.5:1
  changes chart legends, table secondary text and every muted label at once; worth doing in Slice 0
  where nothing else is moving.
