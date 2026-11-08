---
date: 2026-08-02T10:44:40+02:00
git_commit: f363e22022f7379d2073687687f42961d9552c17
branch: main
repository: household-finance
topic: "How can we implement that we can add new categories and also change the names of the ones we already have. E.g. I changed in my banking app the name of \"Fun account\" to \"Dog savings\". How can I reflect that here?"
type: "vertical_slice"
status: complete
---

# Research: Adding new categories and renaming existing categories

## 1. Research Question

How does the codebase currently model, store, and expose transaction categories, and what already exists (or is missing) to support creating a new category or renaming an existing one (e.g. "Fun Account" → "Dog savings")?

## 2. Slice Scope & Interface Boundaries

- **Ingress (Inputs):** Category data enters the system in exactly one place today — `backend/seed.py`, which inserts a hardcoded Python list of category names/types/sort-orders into the `categories` table on first run (idempotent by name). Category *type* can also be mutated via `PATCH /categories/{id}` from the Budget page UI.
- **Egress (Outputs/Exports):** `GET /categories` (`backend/routers/categories.py`) is the single read path; every frontend page/component that needs categories calls `api.getCategories()` via its own `useQuery(['categories'], ...)`. Category name/type is also denormalized read-only into many other API responses (`TransactionOut`, `SplitOut`, `BudgetRow`, `RuleOut`, `DashboardSummary` breakdowns) for display.
- **Out of Scope:** This document does not cover category *deletion*, budget-amount editing, the import/categorizer pipeline's rule-matching logic in depth, or the standing-adjustments feature beyond noting its hardcoded category-name dependency. It does not propose an implementation — see "Open Questions" for what a future plan would need to resolve.

## 3. Summary

Categories are stored in a single `categories` table (`backend/models.py:24-32`) with `id`, unique `name`, `type` (enum), and `sort_order`. Every other table (`Transaction`, `TransactionSplit`, `Rule`, `Budget`, `StandingAdjustment`) references a category **by integer `category_id` foreign key**, never by name — so a rename is, structurally, a single-row `UPDATE` to `Category.name` that automatically propagates everywhere, since all consumers read the name live off the FK-joined row rather than storing a persisted copy. However, today there is **no API to create a category and no API to rename one**: `backend/routers/categories.py` exposes only `GET /categories` (list) and `PATCH /categories/{id}` (type-only patch, `name` and `sort_order` are not patchable, and there's no `POST`). Two prior design specs (`docs/superpowers/specs/2026-04-09-budget-category-drill-down-design.md` and `2026-04-12-category-type-edit-design.md`) explicitly deferred "add/rename/delete category" as out of scope, so this is a known, previously-postponed gap rather than an oversight. A few places still key off category **name as a string** rather than id and would need attention when renaming: `backend/seed.py`'s idempotent-by-name upsert logic (would insert a duplicate "Fun Account" row if `run_seed()` is ever re-invoked after a rename) and two hardcoded lookups for `"Retained Salary"`/`"Personal Allowance"`; `backend/categorizer/ai.py`'s per-call `cat_by_name` map (self-healing, re-queried live each time); and two frontend files, `CategorySelect.tsx` (icon lookup keyed by exact name) and `AddTransactionModal.tsx` (hardcoded `"Retained Salary"`/`"Personal Allowance"` name lookups).

## 4. Detailed Findings

### Data model (`backend/models.py`)

- `CategoryType` enum (`backend/models.py:6-11`): `needs`, `wants`, `savings`, `income`, `exclude`.
- `Category` model (`backend/models.py:24-32`): `id` (PK), `name` (`String, nullable=False, unique=True`), `type` (`SAEnum(CategoryType)`), `sort_order` (`Integer, default=0`). Relationships: `transactions`, `rules`, `budgets`.
- All FK references to `Category` are by `category_id`, with these delete behaviors:
  - `Transaction.category_id` (`models.py:41`) — `ondelete="SET NULL"`
  - `TransactionSplit.category_id` (`models.py:67`) — `ondelete="SET NULL"`
  - `Rule.category_id` (`models.py:93`) — `ondelete="CASCADE"`
  - `Budget.category_id` (`models.py:100`) — `ondelete="CASCADE"`, plus `UniqueConstraint("category_id", "month")` (`models.py:103`)
  - `StandingAdjustment.income_category_id` / `expense_category_id` (`models.py:79-80`) — `ondelete="CASCADE"`
- No `name` string is stored as a foreign key or duplicated as authoritative data anywhere in the schema — every `category_name` field seen in API responses is populated live from the ORM relationship at read time (e.g. `routers/rules.py:11`, `routers/budget.py:94`, `routers/transactions.py:34`).

### Existing category API (`backend/routers/categories.py`, 48 lines total)

- `GET /categories` (lines 11-21): returns all categories ordered by `sort_order` as `{id, name, type, sort_order}`.
- Inline `CategoryPatch` Pydantic model (lines 24-25): **only field is `type: Optional[str]`**.
- `PATCH /categories/{category_id}` (lines 28-47): validates `type` against `CategoryType`, 404 if category not found, 422 if invalid type. Does not touch `name` or `sort_order`.
- No `POST /categories` (create) and no `DELETE /categories/{id}` exist.
- `backend/schemas.py:106-112` defines `CategoryOut` (`id`, `name`, `type`, `sort_order`) — the only category-dedicated schema; there is no `CategoryCreate` or a `name`-aware patch schema in `schemas.py` (the router's `CategoryPatch` is defined locally, not there).

### Category creation today (`backend/seed.py`)

- Three hardcoded Python lists define all categories: `CATEGORIES` (lines 6-22, e.g. `"Food - Essential"` line 9, `"Fun Account"` line 21), `INCOME_CATEGORIES` (lines 25-29: Salary, Retained Salary, Refunds, Other Income), `EXCLUDE_CATEGORIES` (lines 32-33: Internal Transfer).
- `run_seed()`/`seed()` (lines 47-92) is **idempotent by exact name match**: `db.query(Category).filter_by(name=name).first()` and only inserts if absent (lines 50, 61, 67). This is the only code path that creates `Category` rows; there is no runtime create flow.
- Lines 78-90 additionally wire up two default `StandingAdjustment` rows by looking up categories via `filter_by(name="Retained Salary")` / `filter_by(name="Personal Allowance")` — a second hardcoded-name dependency, guarded by `if retained and allowance:` so it silently no-ops rather than erroring if those names are missing/renamed.

### Places that reference categories by **id** (rename-safe)

- `backend/categorizer/rules.py`: `apply_rules()` (16-23) and `_is_sign_compatible()` (5-13) operate on `rule.category` (FK) and `category.type`, never `category.name`.
- `backend/routers/budget.py`: `_auto_populate()` (20-42), `GET /budget` (45-101), and the patch endpoints all key off `category_id`; `category_name` in the response is read live from `row.category.name`.
- `backend/routers/rules.py`: create/update take `category_id`; `_to_out()` reads `rule.category.name` live for display only.
- `backend/routers/standing_adjustments.py`: `_validate_categories()` (17-27) fetches by id (`db.get(Category, ...)`) and checks `type`; `category.name` appears only inside error-message strings, not for lookup.
- `backend/adjustments.py`: `materialise_standing_adjustments()` (8-51) uses `sa.income_category_id`/`sa.expense_category_id` purely as FKs; the materialized transaction's `description` comes from the standing adjustment's own `name`, not the category's.
- `backend/aggregate.py`: `effective_parts()`/`is_spend_part()` (12-27) work entirely on `category_id`.
- `backend/routers/transactions.py`: `_require_category()` (49-53) and `_validate_refund()` (56-73) validate by FK/type.
- `backend/tests/test_models.py`: FK-relationship tests (`test_transaction_belongs_to_category`, `test_rule_belongs_to_category`, budget-linkage test) — all id-based, no name-uniqueness or rename tests exist.

### Places that reference categories by **name string** (rename-sensitive)

- `backend/seed.py` (see above) — idempotency check and two hardcoded standing-adjustment lookups.
- `backend/categorizer/ai.py`: `batch_categorise_with_ai()` builds `cat_by_name = {c.name: c for c in all_categories}` (line 49) from a **fresh query each call** (line 48), sends the current `category_names` to the Claude API prompt (lines 72, 81-87), then maps the AI's returned name string back to a `Category` via `cat_by_name.get(...)` (line 103). Because both the category list and the map are re-fetched live on every invocation, this is self-healing with respect to renames — no persisted/cached name anywhere in this module.
- `backend/tests/test_seed.py` and the `_cat(name)` helpers in `test_splits.py`, `test_manual_transactions.py`, `test_refunds.py`, `test_standing_adjustments.py`, `test_dashboard.py`, `test_budget.py` all fetch seeded fixture categories by hardcoded name string — these tests would need updating if `seed.py`'s hardcoded names ever changed.
- `frontend/src/components/CategorySelect.tsx`: `CATEGORY_ICONS` (lines 14-38) is a map keyed by **exact category name** (e.g. `'Fun Account'`, `'Retained Salary'`, `'Personal Allowance'`); an unmatched name falls back to a generic `HelpCircle` icon (line 39-40) rather than erroring. This is the one place a rename has an immediate, visible (but non-breaking) side effect in the UI.
- `frontend/src/components/AddTransactionModal.tsx`: lines 46-50 do `categories.find(c => c.name === 'Retained Salary')` / `'Personal Allowance'` to pre-fill default standing-adjustment legs — a rename of either category would make this lookup return `undefined`.

### Frontend category data flow

- `frontend/src/types.ts:39-44` — `Category { id, name, type, sort_order }`, mirroring `CategoryOut`. `category_id`/`category_name` pairs are threaded through `Transaction`, `TransactionSplit`, `BudgetRow`, `Rule`, `StandingAdjustment`, and `DashboardSummary` breakdown types — each a point-in-time snapshot from its own endpoint, not a live join.
- `frontend/src/api.ts:73-74` — `getCategories()` → `GET /categories`. `frontend/src/api.ts:85-89` — `patchCategory(id, {type})` → `PATCH /categories/:id`, matching the backend's type-only capability exactly. No `createCategory` or name-aware update function exists.
- No shared category store/Context: every page/component that needs categories calls its own `useQuery({ queryKey: ['categories'], queryFn: api.getCategories })` (TanStack Query dedupes the network call via cache key, but there's no single source of truth object).
- `frontend/src/components/CategorySelect.tsx` — shared searchable/grouped dropdown (grouped by `type`, `GROUP_ORDER` lines 43-51), used by `ReviewCard.tsx`, `SplitEditor.tsx`, `SplitModal.tsx`, `StandingAdjustments.tsx`, `AddTransactionModal.tsx`, `Rules.tsx`.
- `frontend/src/pages/Settings.tsx` — currently contains only a "Financial Month Start Day" input (lines 60-136) and renders `<StandingAdjustments />` (line 138). **No category management UI exists here today.**
- `frontend/src/pages/Budget.tsx` — `TypeCell` (lines 15-115, offset varies slightly between agent reports: 16-83 in one pass) is the only existing UI that mutates a category: a clickable type badge that calls `api.patchCategory(categoryId, { type: newType })` and invalidates `['categories']` + `['budget', month]` query caches. This is **type editing only**, not name editing, and it lives on the Budget page rather than Settings. `DrillDownRow`/`TransactionDrillRow` (lines ~134-237) implement the budget category drill-down (expand a category row to see/recategorize its transactions).

### Design precedent — this feature was already scoped and deferred twice

- `docs/superpowers/specs/2026-03-17-household-finance-design.md:152-155` — the *original* app spec planned a Settings page section to "Manage categories (name, type, sort order)". This was never built as originally scoped.
- `docs/superpowers/specs/2026-04-09-budget-category-drill-down-design.md:106` — explicitly states "Category management (add/edit/delete categories) is a separate feature," deferring it out of that spec's scope.
- `docs/superpowers/specs/2026-04-12-category-type-edit-design.md` — the spec for the currently-shipped type-only patch. Its "Out of Scope" section (lines 82-85) explicitly lists: "Editing category name," "Reordering categories," "Creating or deleting categories" — i.e., exactly the feature now being requested. This spec's Settings-page card design was never actually implemented in `Settings.tsx` (the shipped `TypeCell` UI ended up on the Budget page instead, diverging from this spec).

### Tests

- No `backend/tests/test_categories.py` exists — no backend test exercises category creation via API (doesn't exist) or a rename via `PATCH`.
- `frontend/src/tests/Settings.test.tsx` has zero category references, confirming no category UI exists there to test yet.
- `frontend/src/tests/ReviewCard.test.tsx` is a useful pattern reference for how category fixtures/mocks and `QueryClientProvider` wrapping are set up in existing frontend tests, though it doesn't test CRUD.

## 5. Code References

- `backend/models.py:6-32` — `CategoryType` enum and `Category` model definition, plus all FK columns/relationships to categories across `Transaction`, `TransactionSplit`, `Rule`, `Budget`, `StandingAdjustment`.
- `backend/schemas.py:106-112` — `CategoryOut` (the only dedicated category schema).
- `backend/routers/categories.py:1-48` — full existing category router (list + type-only patch, no create).
- `backend/seed.py:6-92` — hardcoded category lists and idempotent-by-name seeding logic, including the `"Retained Salary"`/`"Personal Allowance"` hardcoded lookups (lines 78-90).
- `backend/categorizer/ai.py:34-115` — live per-call `cat_by_name` mapping used for AI categorization (self-healing on rename).
- `backend/categorizer/rules.py:5-24` — id/type-based rule matching (unaffected by rename).
- `backend/routers/budget.py`, `backend/routers/rules.py`, `backend/routers/standing_adjustments.py`, `backend/adjustments.py`, `backend/aggregate.py` — all reference categories by `category_id`; `category_name` fields are read-only, live-joined display data.
- `backend/tests/test_models.py:5-53` — existing FK/creation-focused category tests.
- `frontend/src/types.ts:39-44` — `Category` interface.
- `frontend/src/api.ts:73-89` — `getCategories()` and `patchCategory()` client functions.
- `frontend/src/components/CategorySelect.tsx:14-51` — shared category dropdown; hardcoded name-keyed icon map (rename-sensitive).
- `frontend/src/components/AddTransactionModal.tsx:46-50` — hardcoded name lookups for standing-adjustment defaults (rename-sensitive).
- `frontend/src/pages/Settings.tsx:60-138` — current Settings page contents (no category UI).
- `frontend/src/pages/Budget.tsx` (`TypeCell` component, `DrillDownRow`/`TransactionDrillRow`) — existing type-edit and drill-down UI patterns to model a rename/create UI after.
- `docs/superpowers/specs/2026-03-17-household-finance-design.md:152-155` — original deferred "manage categories" Settings plan.
- `docs/superpowers/specs/2026-04-09-budget-category-drill-down-design.md:106` — explicit deferral of category add/edit/delete.
- `docs/superpowers/specs/2026-04-12-category-type-edit-design.md:82-85` — explicit "Out of Scope" listing of name-editing and category creation/deletion, the exact gap this research investigated.

## 6. Open Questions

- Should renaming go through the existing `PATCH /categories/{id}` endpoint (extending `CategoryPatch` with an optional `name` field) or a dedicated endpoint? The existing pattern (type-only patch) suggests extending the same endpoint is consistent with current conventions.
- Should a rename enforce the same `unique=True` constraint at the application/schema layer (returning a clean 409/422) rather than relying on the DB to raise an `IntegrityError`? No such application-level uniqueness check exists today for any category field.
- Should `backend/seed.py`'s idempotent-by-name matching be reconciled once renaming is possible (e.g. so re-seeding doesn't recreate a duplicate under the old hardcoded name)? This wasn't a problem before because names were immutable; it becomes one once rename ships.
- Should category creation (`POST /categories`) be added in the same effort, given the user's request explicitly asks for both "add new categories" and "rename existing ones"? No creation endpoint exists at all today.
- Should `sort_order` also become editable as part of this work, given it was explicitly named alongside `name` in the original (never-built) design spec?
- How should `CategorySelect.tsx`'s name-keyed icon map and `AddTransactionModal.tsx`'s hardcoded `"Retained Salary"`/`"Personal Allowance"` lookups be handled on rename — updated to something more resilient (e.g. icon by category type or a stored icon field), or left as-is with the understood tradeoff that icons/prefill silently degrade to a generic fallback?
- Should the Settings page (per the original spec's intent) or the Budget page (per where type-editing actually ended up shipping) be the home for add/rename UI, given the two design docs diverged from each other on this point?
