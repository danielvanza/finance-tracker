# Category Type Editing — Design Spec

**Date:** 2026-04-12  
**Status:** Approved

## Overview

Allow users to change a category's type (needs / wants / savings / income / exclude) directly from the Settings page. Currently categories are static at runtime; this feature makes them editable without touching the database directly.

## Backend

### New schema: `CategoryPatch` (`schemas.py`)

```python
class CategoryPatch(BaseModel):
    type: str  # validated against CategoryType enum values
```

### New endpoint: `PATCH /api/categories/{id}` (`routers/categories.py`)

- Accepts `CategoryPatch` body
- Validates `type` is one of: `needs`, `wants`, `savings`, `income`, `exclude`
- Returns 404 if category not found
- Returns 400 if `type` value is invalid
- Updates `Category.type` in DB
- Returns updated `CategoryOut` (id, name, type, sort_order)

No other fields (name, sort_order) are editable in this iteration.

## Frontend

### New API function (`api.ts`)

```ts
patchCategory(id: number, type: string): Promise<Category>
```

Calls `PATCH /api/categories/:id` with `{ type }` body.

### Settings page additions (`pages/Settings.tsx`)

A second card is added below the existing "Financial Month Start Day" card. It matches the existing card style exactly: `var(--bg-card)`, `var(--border)`, `var(--radius-lg)`, same box-shadow.

**Card contents:**
- Heading: "Categories"
- Subtext: "Adjust whether each category counts as needs, wants, or savings."
- A table with rows grouped by current type, with section headers (`NEEDS`, `WANTS`, `SAVINGS`, `INCOME`, `EXCLUDE`)

**Table columns:**
| Column | Details |
|--------|---------|
| Name | `var(--text-h)`, plain text |
| Type | `<select>` with options: needs, wants, savings, income, exclude |

**Interaction flow:**
1. User changes a `<select>` dropdown
2. `PATCH /api/categories/:id` fires immediately (no Save button)
3. On success: brief "Saved" confirmation next to the row for 2 seconds; invalidate `['categories']`, `['budget']`, `['dashboard']` queries
4. On error: revert dropdown to previous value

**Query:**
- Uses `useQuery(['categories'], api.getCategories)` (already exists in app)
- Uses a single `useMutation` with a `savingId: number | null` state to track which row is in-flight (avoids creating N mutation instances)

## Data Flow

```
User changes <select>
  → useMutation fires PATCH /api/categories/:id
  → Backend validates type, updates DB
  → Returns updated CategoryOut
  → onSuccess: invalidate ['categories'], ['budget'], ['dashboard']
  → Row shows "Saved" flash for 2s
```

## Error Handling

- Network/API error: revert `<select>` to previous value, no crash
- Invalid type (shouldn't happen via UI): backend returns 400

## Out of Scope

- Editing category name
- Reordering categories
- Creating or deleting categories
- Budget amount editing (already handled on Budget page)
