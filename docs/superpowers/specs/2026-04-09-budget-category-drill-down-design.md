# Design: Budget Category Drill-Down with Inline Recategorisation

**Date:** 2026-04-09  
**Status:** Approved  
**Scope:** Frontend-only (no backend changes required)

---

## Problem

The Budget page shows planned vs actual amounts per category, but there is no way to see *which transactions* make up that actual amount. When a category is unexpectedly high or low, the user cannot investigate or fix categorisation mistakes without leaving the Budget page and manually searching the Transactions page.

---

## Goal

Allow the user to click any budget category row to expand a sub-table of its transactions for the current financial month, and to reassign any transaction to a different category directly from that view.

---

## User Interaction Flow

1. Every category row on the Budget page displays a **chevron icon** (right-aligned). The entire row is clickable (`cursor-pointer`, min 44px height for touch targets).
2. Clicking the row **toggles an expanded sub-table** below it. Only one category can be expanded at a time — clicking an already-open row closes it; clicking a different row closes the current one and opens the new one. A smooth 200ms height transition opens/closes the sub-table.
3. The sub-table shows all **confirmed transactions** for that category in the currently-selected financial month, sorted by date descending.
4. Each transaction row shows: **date**, **description** (truncated ~40 chars), **amount**, and a **category dropdown** (`CategorySelect` component).
5. Changing the dropdown fires `PATCH /transactions/{id}` immediately (no submit button). A green left-border flash (1.5s) on the row confirms the save.
6. After a successful reassignment, the transaction **disappears from the sub-table** (it now belongs to a different category). Both the source and destination category rows' **actual amounts update automatically** via TanStack Query cache invalidation.
7. An **empty state** ("No transactions this month") is shown if the category has no confirmed transactions.
8. A **"View all in Transactions →"** link at the bottom of the sub-table navigates to the Transactions page pre-filtered to that category and month.

---

## Backend

No new endpoints required. Existing endpoints cover all needs:

| Action | Endpoint |
|--------|----------|
| Load transactions for a category | `GET /transactions?category_id=<id>&month=YYYY-MM&confirmed=true` |
| Save recategorisation | `PATCH /transactions/{id}` with `{ category_id: <new_id>, confirmed: true }` |

After each successful patch, invalidate TanStack Query keys:
- `['budget', month]` — triggers budget row actual amounts to refetch
- `['transactions', categoryId, month]` — triggers sub-table to refetch (transaction disappears)

---

## Visual Design

Consistent with the existing dark theme (inline styles, no CSS framework):

| Element | Style |
|---------|-------|
| Chevron icon | Heroicons `ChevronDownIcon` SVG, `transform: rotate(180deg)` when expanded, `transition: transform 200ms ease` |
| Expanded sub-table background | `#1E293B` (one shade lighter than `#0F172A` parent row, to visually nest it) |
| Transaction row hover | `rgba(255, 255, 255, 0.04)` |
| Success flash | `border-left: 3px solid #22C55E` pulse for 1.5s |
| Empty state | Centred muted text: `color: #64748B` |
| "View all" link | Muted text + right-arrow icon, bottom-right of sub-table |

Accessibility requirements:
- Chevron button has `aria-label="Expand [category name] transactions"` and `aria-expanded` attribute.
- `cursor-pointer` on all clickable elements.
- Focus ring visible on chevron/row for keyboard navigation.
- `prefers-reduced-motion`: skip height animation, show/hide instantly.

---

## Components

### New: `CategoryTransactionList`

**File:** `frontend/src/components/CategoryTransactionList.tsx`

**Props:**
```ts
interface CategoryTransactionListProps {
  categoryId: number;
  categoryName: string;
  month: string; // "YYYY-MM"
}
```

**Responsibilities:**
- Fetch transactions via TanStack Query: key `['transactions', categoryId, month]`
- Render sub-table (date, description, amount, category dropdown)
- On dropdown change: call `patchTransaction`, then `invalidateQueries(['budget', month])` and `invalidateQueries(['transactions', categoryId, month])`
- Show loading skeleton, empty state, and error state
- Render "View all in Transactions →" link

### Modified: `Budget.tsx`

**Changes:**
- Add local state: `const [expandedCategoryId, setExpandedCategoryId] = useState<number | null>(null)`
- Each category row: add chevron, `onClick` to toggle `expandedCategoryId`
- Render `<CategoryTransactionList>` below the row when `expandedCategoryId === category.id`

---

## Out of Scope

- Unconfirmed (AI-suggested) transactions are not shown in the drill-down. They are handled in the existing Review Queue on the Transactions page.
- Pagination within the sub-table is not included. The "View all" link handles the overflow case.
- Drag-and-drop recategorisation is not included.
- Category management (add/edit/delete categories) is a separate feature.

---

## Testing

- Unit test `CategoryTransactionList`: verify it renders the correct transactions, calls `patchTransaction` on dropdown change, and shows the empty state.
- Unit test `Budget.tsx`: verify clicking a row expands/collapses the sub-table, and only one row is expanded at a time.
- Existing backend tests are unaffected (no backend changes).
