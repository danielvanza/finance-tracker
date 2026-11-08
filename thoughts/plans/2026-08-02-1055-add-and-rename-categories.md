Add, Rename, Reorder, and Delete Categories — Implementation Plan

## Overview

Today categories can only be created via a hardcoded list in `backend/seed.py`, and the only edit possible is changing a category's `type` (via `PATCH /categories/{id}` from the Budget page). This plan adds full category management — create, rename, drag-and-drop reorder, and delete — via a new "Manage Categories" section on the Settings page, fixes a startup bug that would silently duplicate a renamed category, and hardens two frontend spots that currently key off category name strings.

## Current State Analysis

- **Data model is rename-safe**: every table (`Transaction`, `TransactionSplit`, `Rule`, `Budget`, `StandingAdjustment`) references `Category` by `category_id` FK; `category_name` fields in API responses are read live off the joined row, never persisted. A rename is structurally a one-row `UPDATE` (`backend/models.py:24-32`).
- **No create/delete/reorder API exists.** `backend/routers/categories.py` only has `GET /categories` (list) and `PATCH /categories/{id}` with a `type`-only body (`CategoryPatch`, line 24-25). No `POST`, no `DELETE`, no `sort_order` or `name` patching. No `backend/tests/test_categories.py` exists.
- **No app-level uniqueness check** for `Category.name` exists anywhere — a duplicate today would surface as a raw `IntegrityError` (500).
- **`frontend/src/api.ts`** has `getCategories()` and `patchCategory(id, {type})` only — no `createCategory`, `deleteCategory`, or reorder call.

### Key Discoveries

- **Confirmed startup bug**: `run_seed()` runs unconditionally on every app startup with no guard (`backend/main.py:40`), and is idempotent by matching `Category.name` exactly (`backend/seed.py:50,61,67`). Renaming "Fun Account" → "Dog savings" today, then restarting the app, will insert a *duplicate* "Fun Account" row, since the seed loop won't find a category by that name anymore. This must be fixed as part of this work, not left as a known issue.
- **SQLite foreign-key enforcement is off** (`backend/db.py` never sets `PRAGMA foreign_keys=ON`), and `Category`'s relationships (`transactions`, `rules`, `budgets`) have no explicit ORM `cascade` configured. This means the `ondelete="CASCADE"` / `ondelete="SET NULL"` annotations in `models.py` are **not actually enforced** — `Transaction.category_id`/`TransactionSplit.category_id` (nullable) get nullified by SQLAlchemy's default one-to-many dependency handling on delete, but `Rule.category_id` and `Budget.category_id` (both `nullable=False`) would raise a `NOT NULL constraint failed` `IntegrityError` if a category with existing rules/budget rows were deleted without explicit handling. The DELETE endpoint must handle this itself (see Phase 1).
- **`Budget` rows always exist for expense-type categories** — every `needs`/`wants`/`savings` category gets a `month=None` default budget row from seeding, and `_auto_populate()` (`backend/routers/budget.py:20-42`) needs that default row to ever show a category on the Budget page. New categories created via the API must get this default row too (planned_amount=0), and it must NOT block deletion (it's just config, not user financial history) — it should be deleted along with the category.
- **`sort_order` is already effectively grouped by type** in the seed data (needs: 1-6, wants: 7-13, savings: 14-16, income: 17-20, exclude: 21 — `backend/seed.py:6-34`), matching how `CategorySelect.tsx` groups the dropdown by type (`GROUP_ORDER`, lines 43-51). Reordering only needs to work *within* a type group, not globally.
- **No drag-and-drop library exists** in `frontend/package.json` (React 19.2.4, only `@tanstack/react-query`, `lucide-react`, `react-router-dom`, `recharts` as runtime deps). `CategorySelect.tsx` is a fully hand-rolled combobox — the codebase prefers native implementations over adding UI dependencies. This plan uses native HTML5 drag events (`draggable`, `onDragStart`/`onDragOver`/`onDrop`) rather than pulling in `@dnd-kit` or similar, to match convention.
- **`frontend/src/components/StandingAdjustments.tsx`** is the closest existing precedent for a Settings-page CRUD section and is the pattern this plan's new `CategoryManager.tsx` follows closely: plain `api.*` calls in async handlers (no `useMutation`), an `invalidate()` helper called after every mutation, `window.confirm(...)` for delete confirmation (no custom modal component exists), a single `error` string in local state rendered inline, and a `Record<id, string>` shadow-state pattern for inline editing (`editedAmounts`) that this plan reuses for inline category rename.
- **Existing frontend error convention**: no `fetch` call in `api.ts` checks `response.ok` — errors are detected by inspecting `.detail` on the parsed JSON body, matching FastAPI's error shape. New `api.ts` functions must follow this same pattern.
- **`frontend/src/tests/Settings.test.tsx`** mocks `'../api'` with only `getSettings`/`patchSetting`, meaning `getCategories`/`getStandingAdjustments` are currently `undefined` when `Settings.tsx` renders (since it always renders `<StandingAdjustments />`). This is a pre-existing gap this plan must fix, since adding `<CategoryManager />` to the same page will make it worse if left alone.

## Desired End State

- Users can create a new category (name + type) from Settings, which appears immediately in every category dropdown across the app.
- Users can rename any category inline from Settings; the new name propagates everywhere on the next data refresh (no other code changes needed, since nothing else persists the name).
- Users can reorder categories within their type group via drag-and-drop from Settings.
- Users can delete a category from Settings, but only if it's not referenced by any transaction, split, rule, or standing adjustment — attempting otherwise shows a clear inline error listing what's blocking it.
- Renaming a category and then restarting the app does not create a duplicate.
- `CategorySelect`'s icon lookup and `AddTransactionModal`'s adjustment-pair defaults degrade gracefully (by category type / by actual standing-adjustment data) instead of silently breaking on rename.

**Verification**: `cd backend && pytest`, `cd frontend && npx vitest run`, plus the manual walkthrough in each phase's Success Criteria.

## What We're NOT Doing

- Not changing where category `type` is edited — that stays on the Budget page (`TypeCell`), unchanged. `CategoryManager` handles name, sort order, create, delete only.
- Not building a generic "reassign all transactions from category A to B" flow. Deletion is blocked (not auto-reassigned) when a category is in use; the user recategorizes affected transactions manually first (e.g. via the existing Budget drill-down or Review flow) before deleting.
- Not adding a drag-and-drop library dependency — using native HTML5 drag events instead.
- Not touching `backend/categorizer/ai.py`'s category handling — it already re-queries categories by name fresh on every call, so it's self-healing on rename with no changes needed.

## Implementation Approach

Backend first (schema/endpoints), then fix the seed bug, then wire the frontend API client, then build the UI, then harden the two rename-fragile display spots last (since they're cosmetic and independent of the CRUD work).

---

## Phase 1: Backend — Category create/rename/delete/reorder API

### Overview
Add `POST /categories`, extend `PATCH /categories/{id}` to accept `name`, add `DELETE /categories/{id}` with an in-use guard, and add a reorder endpoint.

### Changes Required

#### 1. `backend/schemas.py`
Add a `CategoryCreate` schema near the existing `CategoryOut` (line 106):

    class CategoryCreate(BaseModel):
        name: str
        type: str
        sort_order: Optional[int] = None

    class CategoryReorder(BaseModel):
        category_ids: list[int]

#### 2. `backend/routers/categories.py`
Move `CategoryPatch` to accept `name` too (keep it local to the router, matching existing style, just add the field):

    class CategoryPatch(BaseModel):
        type: Optional[str] = None
        name: Optional[str] = None

Add helper `_out(cat)` to replace the duplicated dict-building in `list_categories`/`patch_category`.

Add `POST /categories`:
- Validate `type` against `CategoryType` (422 on invalid).
- Strip and validate `name` is non-empty (422 if blank).
- Check `db.query(Category).filter_by(name=body.name).first()` — 422 `"'{name}' already exists"` if found (matches the existing precedent in `backend/routers/standing_adjustments.py:39-40`).
- If `sort_order` not given, default to `(max existing sort_order or 0) + 1`.
- Create and flush the `Category`.
- If `type` is `needs`/`wants`/`savings`, also create a default `Budget(category_id=cat.id, month=None, planned_amount=Decimal("0"))` row (mirrors `seed.py`'s behavior so the category shows up on the Budget page immediately).
- Commit, return 201 with the category dict.

Extend `PATCH /categories/{category_id}`:
- When `body.name is not None`: strip it, 422 if empty, 422 if another category already has that name (`filter(Category.name == body.name, Category.id != category_id)`), else set `cat.name = body.name`.
- Keep existing `type` handling unchanged.

Add `DELETE /categories/{category_id}`:
- 404 if not found.
- Count references: `Transaction.category_id`, `TransactionSplit.category_id`, `Rule.category_id`, and `StandingAdjustment` where `income_category_id` or `expense_category_id` matches.
- If any count > 0, raise 422 with a message built from the non-zero parts, e.g. `"Cannot delete 'Fun Account': in use by 12 transaction(s), 2 rule(s). Reassign or remove them first."`
- Otherwise: `db.query(Budget).filter_by(category_id=category_id).delete()` (removes the default template row and any per-month rows — see "SQLite foreign-key enforcement is off" discovery above for why this must be explicit), then `db.delete(cat)`, commit, return `{"deleted": category_id}`.

Add `PATCH /categories/reorder`:
- Body: `CategoryReorder` (`category_ids: list[int]`, in the desired new order — the frontend always passes the ids of one type-group's visible list).
- 422 if fewer than 2 ids, or if any id doesn't exist.
- Fetch the categories for those ids, take their **current** `sort_order` values sorted ascending, and zip that sorted list of values against `category_ids` in the given order — i.e. the lowest existing sort_order goes to whichever id is now first, etc. This reassigns order within the group without needing to know about other groups' numbering.
- Commit, return the updated `[{id, sort_order}, ...]` list.

### Success Criteria

**Automated Verification:**
- [ ] `cd backend && pytest tests/test_categories.py -v` passes (new file — see below)
- [ ] `cd backend && pytest` passes in full (no regressions)

**New tests — `backend/tests/test_categories.py`:**
- create: succeeds with valid name/type, returns 201, appears in `GET /categories`
- create: 422 on duplicate name, 422 on invalid type, 422 on blank name
- create: a `needs`/`wants`/`savings` category gets a default `Budget` row; an `income`/`exclude` category does not
- rename via `PATCH`: name changes, propagates to `GET /categories`; 422 on duplicate name against another category; unaffected `type` when only `name` given
- delete: succeeds for an unused category (including cleaning up its default `Budget` row)
- delete: 422 when a transaction/rule/standing-adjustment references it (one test per reference type), and the category still exists afterward
- delete: 404 for a nonexistent id
- reorder: swapping two ids' order updates their `sort_order` correctly and leaves other categories' `sort_order` untouched; 422 for an unknown id

**Manual Verification:**
- [ ] Not applicable yet — covered end-to-end in Phase 4.

> **Implementation Note:** After completing this phase and automated verification passes, pause for manual confirmation before proceeding to the next phase.

---

## Phase 2: Backend — fix seed.py rename-duplication bug

### Overview
Stop `run_seed()` from re-inserting a category under its old hardcoded name after a user has renamed it.

### Changes Required

#### 1. `backend/seed.py`
Add a single guard at the top of `run_seed()`, before the `CATEGORIES` loop:

    def run_seed(db: Session) -> None:
        if db.query(Category).count() > 0:
            return
        ...

This replaces the need for per-row name matching to stay correct after renames — on a genuinely fresh database everything seeds exactly as before; on every subsequent startup (including after a rename), seeding is skipped entirely in one shot. The existing per-row `filter_by(name=...)` checks inside the loops can stay as-is (they're now only ever exercised on an empty table, where they're harmless no-ops before insert) — no need to remove them, just add the top-level short-circuit.

### Success Criteria

**Automated Verification:**
- [ ] `cd backend && pytest tests/test_seed.py -v` passes, including the new test below
- [ ] `cd backend && pytest` passes in full

**New test — `backend/tests/test_seed.py`:**
- `test_seed_does_not_duplicate_renamed_category`: `run_seed(db)`, rename "Fun Account" → "Dog savings" directly on the model, call `run_seed(db)` again, assert only one category named "Dog savings" exists, no category named "Fun Account" exists, and total category count is still 21.

**Manual Verification:**
- [ ] Rename a category via the API (or once Phase 4 ships, via the UI), restart the backend (`./dev.sh`), confirm no duplicate appears in `GET /categories`.

> **Implementation Note:** After completing this phase and automated verification passes, pause for manual confirmation before proceeding to the next phase.

---

## Phase 3: Frontend — API client + types

### Overview
Wire the new backend endpoints into `api.ts`.

### Changes Required

#### 1. `frontend/src/api.ts`
Widen `patchCategory`'s body type and add three new functions, following the existing no-`response.ok`-check, `.then(r => r.json())` convention used throughout this file:

    patchCategory: (id: number, body: { type?: string; name?: string }) =>
      fetch(`${BASE}/categories/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }).then(r => r.json()),

    createCategory: (body: { name: string; type: string; sort_order?: number }) =>
      fetch(`${BASE}/categories`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }).then(r => r.json()),

    deleteCategory: (id: number) =>
      fetch(`${BASE}/categories/${id}`, { method: 'DELETE' }).then(r => r.json()),

    reorderCategories: (categoryIds: number[]) =>
      fetch(`${BASE}/categories/reorder`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category_ids: categoryIds }),
      }).then(r => r.json()),

#### 2. `frontend/src/types.ts`
No changes needed — `Category` already has `{id, name, type, sort_order}`, matching every request/response shape above.

### Success Criteria

**Automated Verification:**
- [ ] `cd frontend && npx tsc -b --noEmit` (or `npm run build`) compiles with no type errors

**Manual Verification:**
- [ ] None — no UI wired up yet.

> **Implementation Note:** After completing this phase, proceed directly to Phase 4 (small, low-risk change).

---

## Phase 4: Frontend — "Manage Categories" section on Settings

### Overview
Build `CategoryManager.tsx` and mount it on the Settings page, following `StandingAdjustments.tsx`'s established conventions.

### Changes Required

#### 1. `frontend/src/components/CategorySelect.tsx`
Export `TYPE_META` and `GROUP_ORDER` (currently module-private, lines 43-51) so `CategoryManager` can reuse the same type labels/colors/grouping instead of duplicating them:

    export const TYPE_META: Record<string, ...> = { ... }
    export const GROUP_ORDER = [...]

#### 2. `frontend/src/components/CategoryManager.tsx` (new)
Structure, modeled directly on `StandingAdjustments.tsx`:
- `useQuery(['categories'], api.getCategories)`.
- Group categories by `type` using `GROUP_ORDER`/`TYPE_META` imported from `CategorySelect.tsx`, sorted within each group by `sort_order` (matches how `CategorySelect` itself groups).
- `invalidate()` helper: invalidates `['categories']`, `['budget']`, `['dashboard']`, `['transactions']`, `['rules']`, `['standing-adjustments']` (categories are denormalized broadly; matches `StandingAdjustments.tsx`'s broad-invalidation convention).
- **Inline rename**: `editedNames: Record<number, string>` state, same shadow-value pattern as `StandingAdjustments`' `editedAmounts` — input value is `editedNames[cat.id] ?? cat.name`, save on blur/Enter via `api.patchCategory(id, {name})`, clear that row's key from the map, `invalidate()`. Show inline error (from `res.detail`) in the shared `error` state on failure (e.g. duplicate name).
- **Add category**: collapsed-by-default form (`showAdd` boolean, "+ Add category" dashed button), with a name `<input>` and a plain `<select>` of the 5 `CategoryType` values, `Add`/`Cancel` buttons — same validation-then-`api.createCategory`-then-`invalidate()` pattern as `StandingAdjustments.add()`.
- **Delete**: `window.confirm(`Delete category "${cat.name}"?`)`, then `api.deleteCategory(id)`; if the response has `.detail` (the 422 in-use message), show it in the `error` state instead of silently failing; otherwise `invalidate()`.
- **Reorder (drag-and-drop, native HTML5 events, within a type group only)**: each row gets `draggable`, `onDragStart` (store dragged id), `onDragOver` (preventDefault, track hover index), `onDrop` (compute the new id order for that group, call `api.reorderCategories(newOrderIds)`, `invalidate()`). Use a `GripVertical` icon (from `lucide-react`, already a project dependency) as the drag handle.
- Visual conventions: reuse the exact card wrapper style block, `labelStyle`/`inputStyle` consts, gradient "Add" button, ghost "Cancel" button, and small bordered `×` delete button styles from `StandingAdjustments.tsx`, so it looks native to the page.

#### 3. `frontend/src/pages/Settings.tsx`
Mount the new component as a sibling after `<StandingAdjustments />`:

    <StandingAdjustments />
    <CategoryManager />

### Success Criteria

**Automated Verification:**
- [ ] `cd frontend && npx vitest run` passes, including new `CategoryManager.test.tsx` and the updated `Settings.test.tsx`
- [ ] `cd frontend && npx tsc -b --noEmit` compiles with no type errors
- [ ] `cd frontend && npm run lint` passes

**Test changes — `frontend/src/tests/Settings.test.tsx`:**
- Extend the `vi.mock('../api', ...)` block to include `getCategories`, `getStandingAdjustments`, `createCategory`, `deleteCategory`, `reorderCategories` (fixing the pre-existing gap where these were `undefined`), so `<StandingAdjustments />` and `<CategoryManager />` both resolve real (empty-array) data instead of erroring silently.

**New tests — `frontend/src/tests/CategoryManager.test.tsx`** (mirroring `Settings.test.tsx`'s `vi.mock('../api')` + `QueryClientProvider` wrapper pattern):
- renders categories grouped by type with correct labels
- adds a category: fills form, submits, asserts `api.createCategory` called with expected body, form collapses/resets
- shows an inline error and does not call the API when the add form is submitted with a blank name
- renames a category: edits the name input, blurs, asserts `api.patchCategory` called with `{name}`
- shows the server's duplicate-name error inline when `patchCategory`/`createCategory` resolves with `.detail`
- deletes a category: mocks `window.confirm` to return `true`, asserts `api.deleteCategory` called
- does not call `deleteCategory` when `window.confirm` returns `false`
- shows the server's "in use" error inline when `deleteCategory` resolves with `.detail`
- reorder: simulate `dragStart`/`dragOver`/`drop` with a minimal mock `dataTransfer`, assert `api.reorderCategories` called with the expected id order

**Manual Verification:**
- [ ] Start the app (`./dev.sh`), go to Settings, add a new category, confirm it appears immediately in `CategorySelect` dropdowns elsewhere (e.g. Review page) without a page reload
- [ ] Rename a category (e.g. "Fun Account" → "Dog savings"), confirm the new name shows up on the Budget page, Rules page, and any existing transactions using it
- [ ] Drag-reorder two categories within the same type group, confirm the new order persists after a page refresh
- [ ] Attempt to delete a category that has transactions — confirm a clear error appears and nothing is deleted
- [ ] Delete an unused category — confirm it disappears everywhere

> **Implementation Note:** After completing this phase and automated verification passes, pause for manual confirmation before proceeding to the next phase.

---

## Phase 5: Frontend — harden rename-fragile display spots

### Overview
Make `CategorySelect`'s icon lookup and `AddTransactionModal`'s adjustment-pair defaults resilient to renames, per the earlier decision to fix these now rather than leave them as a known degradation.

### Changes Required

#### 1. `frontend/src/components/CategorySelect.tsx`
Add a type-keyed fallback icon map alongside the existing name-keyed one:

    const TYPE_FALLBACK_ICONS: Record<string, LucideIcon> = {
      needs: Home, wants: Gamepad2, savings: PiggyBank, income: Wallet, exclude: ArrowLeftRight,
    }

    function getCategoryIcon(name: string, type: string): LucideIcon {
      return CATEGORY_ICONS[name] ?? TYPE_FALLBACK_ICONS[type] ?? HelpCircle
    }

Update both call sites to pass `type`:
- Line ~194: `getCategoryIcon(selected.name)` → `getCategoryIcon(selected.name, selected.type)`
- Line ~361: `getCategoryIcon(cat.name)` → `getCategoryIcon(cat.name, cat.type)`

This keeps the nicer specific icons for un-renamed seeded categories (since the name map is checked first) while giving renamed or newly-created categories a sensible icon by type instead of the generic `HelpCircle`.

#### 2. `frontend/src/components/AddTransactionModal.tsx`
Replace the hardcoded name lookups (lines 46-50) with a live lookup against actual `StandingAdjustment` data:

    const { data: standingAdjustments = [] } = useQuery({
      queryKey: ['standing-adjustments'],
      queryFn: api.getStandingAdjustments,
    })
    const defaultPair = standingAdjustments.find(sa => sa.active) ?? standingAdjustments[0]

    const [incomeCategoryId, setIncomeCategoryId] = useState<number | null>(null)
    const [expenseCategoryId, setExpenseCategoryId] = useState<number | null>(null)

    useEffect(() => {
      if (!defaultPair) return
      setIncomeCategoryId(prev => prev ?? defaultPair.income_category_id)
      setExpenseCategoryId(prev => prev ?? defaultPair.expense_category_id)
    }, [defaultPair])

This defaults the adjustment-pair form to whatever the first active standing adjustment's categories actually are, regardless of their names — so it keeps working after a rename, and even after the categories used by standing adjustments change entirely. If no standing adjustment exists, both fields simply stay unselected (placeholder shown), same as today's behavior when the hardcoded names don't match.

### Success Criteria

**Automated Verification:**
- [ ] `cd frontend && npx vitest run` passes (existing `AddTransactionModal`/`CategorySelect` tests, if any, still pass — check for and update any test asserting the old hardcoded-name default behavior)
- [ ] `cd frontend && npx tsc -b --noEmit` compiles with no type errors

**Manual Verification:**
- [ ] Rename "Retained Salary" or "Personal Allowance", open "Add transaction" → "Adjustment pair" mode, confirm the income/expense legs still default to the (renamed) correct categories
- [ ] With a renamed category (not matching any hardcoded icon name), confirm `CategorySelect` shows a type-appropriate icon instead of the generic question-mark icon

> **Implementation Note:** This is the final phase. After automated verification passes, do a full manual pass through Settings, Budget, Review, and Rules pages to confirm no regressions from the category rename/reorder/delete work.

---

## Testing Strategy

### Unit Tests
- Backend: `backend/tests/test_categories.py` (new) covers create/rename/delete/reorder validation and success paths in isolation via `TestClient`, following `test_standing_adjustments.py`'s fixture/assertion style.
- Backend: `backend/tests/test_seed.py` gets one new regression test proving rename-then-reseed doesn't duplicate.
- Frontend: `frontend/src/tests/CategoryManager.test.tsx` (new) covers the UI in isolation with a mocked `api` module.

### Integration Tests
- Manual verification steps in each phase cover the true end-to-end paths (category changes propagating live across Budget, Review, Rules, and the Add Transaction modal) that are impractical to fully automate given this codebase's existing test conventions (no e2e/Playwright setup exists).
