---
date: 2026-08-02
git_commit: 18c3530
branch: main
repository: household-finance
phase: 4-structure
---

# Structure Outline

## Approach

Ship the two backend capabilities (bounded AI prompt, rollover + DEGIRO) and the "Ledger" front-end
rewrite as independent vertical slices. The front-end track converts one route at a time onto a
Tailwind + shadcn kit, so a failed later phase leaves a half-converted-but-working app rather than a
broken one. Two safety nets land first because the design's Open Risks make them prerequisites.

Test commands: backend `cd backend && pytest`; frontend `cd frontend && npx vitest run`
(no `test` script exists — Vitest config is inlined in `vite.config.ts`), plus `npm run lint` and
`npm run build`.

---

## Phase 0: Safety nets

The one phase that is **not a vertical slice** — noted explicitly. Two test-only prerequisites the
design flags as blocking: `run_migrations` has zero coverage and has already drifted (Phases 6 and 8
add columns/a table under it), and two tests issue live Haiku calls (Phase 1 changes that prompt).

**Files**: `backend/tests/test_migrations.py` (new), `backend/tests/conftest.py`,
`backend/tests/test_imports.py`
**Key changes**:
- `test_migrations_match_models()` — builds a DB from `db.py:20-28` fragments, compares
  `PRAGMA table_info` + FK clauses against `Base.metadata`; asserts parity per table/column.
- `anthropic_client` fixture — autouse mock of `anthropic.Anthropic`, so no test hits the network.

**Verify**: `pytest` passes with `ANTHROPIC_API_KEY` unset; the new parity test **fails first** on the
two known drifts (`standing_adjustment_id` `ON DELETE SET NULL`, `start_month` nullability), then
passes once `db.py:20-28` is corrected.

---

## Phase 1: Bounded AI prompt + logging

Replace the category-names-only prompt with a cached guide block plus per-batch neighbour history,
under a hard character ceiling, and emit real logs (tokens, latency, outcome) from the first run.

**Files**: `backend/categorizer/ai.py`, `backend/categorizer/history.py` (new),
`backend/tests/test_ai_prompt.py` (new), `backend/routers/imports.py`
**Key changes**:
- `build_guide_block(db: Session, categories: list[Category]) -> str` — per category: name, type,
  top-3 most-frequent confirmed descriptions (first `group_by`/`func.count` in the backend).
- `build_neighbour_block(db: Session, descriptions: list[str], max_chars: int) -> str` — confirmed
  history for descriptions present in this batch only.
- `MAX_PROMPT_CHARS: int` — single constant; both builders hard-truncate against it.
- system prompt becomes `list[dict]` content blocks with a `cache_control` breakpoint on the guide.
- `logger = logging.getLogger(__name__)` replacing all 5 `print()`; log `response.usage` and
  `stop_reason` (currently never read).

**Verify**: `pytest backend/tests/test_ai_prompt.py` — with a synthetic 50k-row history the built
prompt stays under `MAX_PROMPT_CHARS`, and prompt size is invariant to history size at fixed
category count; import an ING CSV manually and check the log line reports token counts.

---

## Phase 2: Ledger kit + API hardening

Stand up Tailwind + shadcn/ui, the light/dark token ramp and the shared primitives, and prove them by
rebuilding Settings — the one page with an existing page-level test — with zero inline styles.

**Files**: `frontend/tailwind.config.ts`, `postcss.config.js`, `frontend/src/index.css`,
`frontend/src/components/ui/*` (new), `frontend/src/api.ts`, `frontend/src/App.tsx`,
`frontend/src/pages/Settings.tsx`, `frontend/src/components/{CategoryManager,StandingAdjustments}.tsx`,
`frontend/eslint.config.js`; delete `frontend/src/App.css`
**Key changes**:
- Token layer: ink/paper ramp × 2 themes, spacing + type scale (neither exists today), tabular-figure
  face; **no shadow and no `--grad-*` tokens ported**.
- Primitives: `Button`, `Card`, `Table`, `Input`, `Field`, `Modal`, `Badge`, `EmptyState`,
  `Spinner`, `Amount` — `Modal` implements `role="dialog"`, focus trap, Escape and focus restore
  (the bar is `ReviewCard.tsx:184-207`, not `AddTransactionModal.tsx:149-233`).
- `class ApiError extends Error { status: number; detail: string }`; `request<T>(...)` checks
  `response.ok` and throws — all 26 `api.ts` methods route through it.
- `QueryClient` gets explicit defaults; a route-level `ErrorBoundary` + `isError` rendering.
- `eslint-plugin-jsx-a11y` added and enforced.

**Verify**: `npx vitest run` (existing `Settings.test.tsx` still green) + a new `api.test.ts` asserting
a 4xx throws `ApiError`; `npm run lint` passes with jsx-a11y on; Settings shows 0 `style={{`, renders
in both themes, and survives 375px without horizontal overflow.

---

## Phase 3: Shell — four routes, month in the URL, unconfirmed banner

Nav collapses to Overview / Transactions / Budget / Settings; month selection becomes a URL param
shared across pages; every money page carries the "N unconfirmed (€X) not counted" banner. Backend
duplication is extracted here, before Phase 6 adds a fourth caller.

**Files**: `frontend/src/App.tsx`, `frontend/src/components/Nav.tsx`,
`frontend/src/hooks/useMonth.ts` (new), `frontend/src/components/UnconfirmedBanner.tsx` (new),
`backend/month_window.py` (new), `backend/routers/{budget,dashboard,transactions}.py`,
`backend/schemas.py`
**Key changes**:
- `get_start_day(db: Session) -> int` and
  `month_window_query(db, year, month, start_day) -> Query[Transaction]` — replaces `_get_start_day`
  ×3 and the byte-identical filter clause ×3. Read-only: **no materialisation side effect.**
- `useMonth(): [month: string, setMonth: (m: string) => void]` backed by `useSearchParams`, replacing
  three `useState` + three `currentMonth()` copies.
- `GET /transactions/unconfirmed-summary?month=` → `UnconfirmedSummary { count: int, total: Decimal }`
  with a wired `response_model`.
- Old routes (`/analytics`, `/import`, `/rules`) redirect to their new homes; Nav collapses below the
  breakpoint instead of overflowing 7 links.

**Verify**: `pytest` (new test: the shared window helper reproduces the three old filter results
byte-for-byte); `npx vitest run` (new: navigating Overview→Budget preserves `?month=`, banner shows
count and links to review); manually deep-link `?month=2026-04`.

---

## Phase 4: Overview page

Dashboard and Analytics merge into one Overview route rebuilt on the kit, with Ledger-rule charts
(hairline gridlines, no gradient fills, direct labels) and a `response_model` on its endpoint.

**Files**: `frontend/src/pages/Overview.tsx` (new; deletes `Dashboard.tsx`, `Analytics.tsx`),
`frontend/src/components/SummaryCards.tsx`, `backend/routers/dashboard.py`, `backend/schemas.py`
**Key changes**:
- `DashboardSummary` (defined at `schemas.py:157-166`, never imported) wired as `response_model`;
  the existing `total_expenses` vs `category_breakdown` divergence is **pinned by test, not changed**.
- Chart wrappers replacing the two duplicate colour maps and the page-entrance fade.

**Verify**: `pytest` (response-model shape + divergence pinned); `npx vitest run` (new Overview test);
Overview at 375px, both themes, zero inline styles, every amount decimal-aligned.

---

## Phase 5: Transactions page — list, review and import in one place

The list, the review queue and Import fold into a single route on the kit. Import stops being the
React-Query-free island and starts invalidating what it writes.

**Files**: `frontend/src/pages/Transactions.tsx`, `frontend/src/components/{ReviewCard,SplitModal,
AddTransactionModal,CategorySelect}.tsx` (deletes `pages/Import.tsx`),
`frontend/src/components/ImportPanel.tsx` (new)
**Key changes**:
- `ImportPanel` on React Query, invalidating `['transactions']`, `['review']`, `['dashboard']`,
  `['budget']` (today it invalidates nothing while writing the most rows).
- `CategorySelect` gains `aria-activedescendant`, focus restore and Home/End; both modals inherit the
  Phase 2 `Modal`.

**Verify**: `npx vitest run` — new tests for import→invalidation, review keyboard flow, and modal
focus trap/restore; manually import a real ING CSV and confirm the review queue drains.

---

## Phase 6: Rules inside Transactions, with editable patterns

Rule management moves onto the Transactions page, the pattern becomes editable at creation with a
live match count, and one matching mechanism replaces today's three.

**Files**: `backend/categorizer/rules.py`, `backend/routers/{rules,transactions}.py`,
`frontend/src/components/RuleDrawer.tsx` (new; deletes `pages/Rules.tsx`)
**Key changes**:
- `match_pattern(pattern: str, description: str) -> bool` — the single mechanism, replacing
  `rules.py:20`, `transactions.py:251` and the `ilike` in `rules.py:51-53`.
- `POST /transactions/{id}/create-rule` takes a body: `CreateRuleRequest { pattern: str, priority: int }`
  instead of deriving `tx.description.lower().strip()`.
- `GET /rules/preview?pattern=` → `{ match_count: int, samples: list[TransactionOut] }` — a true
  count (today's `.limit(20)`-then-`[:5]` reports a capped number as if it were total).
- The inline sign gate at `transactions.py:257-261` reuses `_is_sign_compatible`.

**Verify**: `pytest` — one matcher used by all three call sites; preview count is exact; sign gate
behaviour unchanged. `npx vitest run` — editing the pattern updates the count before saving.

---

## Phase 7: Budget page

Budget rebuilt on the kit: `TypeCell`'s independent dropdown dies in favour of `CategorySelect`, the
raw-hex colour map goes, and the `<tr>`/`<span>` click handlers become keyboard-reachable controls.

**Files**: `frontend/src/pages/Budget.tsx`, `backend/routers/budget.py`, `backend/schemas.py`
**Key changes**:
- `BudgetRow` wired as `response_model` (currently missing the `category_type` key the handler emits —
  fix the schema, not the handler).
- Drill-down rows become `<button>`/disclosure elements with `aria-expanded`.

**Verify**: `pytest` (response model matches emitted keys); `npx vitest run` (drill-down expandable by
keyboard); Budget at 375px with a horizontally scrollable table wrapper.

---

## Phase 8: Rollover

Opt-in per-category rollover, derived by walking financial months — never stored, never materialised
during a GET.

**Files**: `backend/models.py`, `backend/db.py`, `backend/rollover.py` (new),
`backend/routers/{budget,categories}.py`, `backend/schemas.py`, `backend/tests/test_rollover.py` (new),
`frontend/src/pages/Budget.tsx`
**Key changes**:
- `Category.rollover_enabled: bool` (server_default false) and `Category.rollover_start_month: str | None`
  — **two edits each**: the model and the `db.py:20-28` fragment, kept in agreement by the Phase 0 test.
- `category_balance(db, category, upto_month, start_day) -> Decimal` — walks months via
  `get_financial_month_range`, never calendar arithmetic; carries the negative, no special case;
  an unmaterialised month contributes `planned = 0` (pinned explicitly).
- `BudgetRow` gains `rollover_balance: Decimal | None`; `PATCH /categories/{id}` accepts the two
  new fields.

**Verify**: `pytest backend/tests/test_rollover.py` — a hand-computed three-month sequence including
one overspend month and one never-opened month reproduces the balance exactly; the schema-parity test
still passes. Manually toggle rollover in Budget and check the carried balance.

---

## Phase 9: DEGIRO portfolio snapshots

Portfolio value tracked in its own table, plotted on a real date axis, with contributions read from
existing ING→DEGIRO savings rows.

**Files**: `backend/models.py`, `backend/routers/portfolio.py` (new), `backend/schemas.py`,
`backend/importers/degiro_snapshot.py` (new), `frontend/src/pages/Overview.tsx`,
`frontend/src/api.ts`
**Key changes**:
- `PortfolioSnapshot { id, date, value: Decimal, import_hash: str (unique) }` — deterministic hash
  per the `adjustments.py:46` pattern, so repeat uploads of one export are idempotent.
- `POST /portfolio/import`, `GET /portfolio/snapshots?from=&to=` → `PortfolioSeries`.
- `growth = value_change - contributions` over the window; snapshots plot at their real dates with
  **no interpolation**.

**Verify**: `pytest` — re-importing the same export inserts nothing; `transactions` row count is
unchanged by any snapshot import (the double-counting guard); growth arithmetic on a hand-built
two-snapshot window. Manually upload a real DEGIRO export and read the chart.

---

## Testing Checkpoints

| After | True |
|---|---|
| 0 | `pytest` passes offline; schema parity is asserted and the two known drifts are fixed. |
| 1 | Prompt size is f(categories, batch) not f(database age), asserted against 50k synthetic rows; every AI call logs tokens and outcome. |
| 2 | Tailwind + tokens + primitives exist; Settings has zero inline styles; a 4xx throws `ApiError`; jsx-a11y passes. |
| 3 | Four routes; `?month=` survives navigation; the unconfirmed gap is visible on every money page; the window query exists once. |
| 4 | Overview replaces Dashboard + Analytics on the kit, with a wired `response_model`. |
| 5 | Transactions holds list + review + import; import invalidates its writes; modals trap and restore focus. |
| 6 | One pattern matcher; patterns editable at creation with an exact live match count; Rules page gone. |
| 7 | Budget on the kit, keyboard-reachable, one dropdown implementation app-wide. |
| 8 | A rollover balance is reproducible by hand from its month sequence, including overspend and never-opened months. |
| 9 | No portfolio snapshot ever appears in `transactions`; repeat imports are no-ops. |
