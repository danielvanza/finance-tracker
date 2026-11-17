import type { BudgetRow, Category } from '../../types'

/** Categories that spent more than they planned this month, biggest overrun first. */
export function overCategories(rows: BudgetRow[], categories: Category[]) {
  const counted = new Set(categories.filter(c => c.type === 'needs' || c.type === 'wants').map(c => c.id))
  return rows
    .filter(r => counted.has(r.category_id) && r.planned_amount_cents > 0 && (r.actual_amount_cents ?? 0) > r.planned_amount_cents)
    .map(r => ({ row: r, over: (r.actual_amount_cents ?? 0) - r.planned_amount_cents }))
    .sort((a, b) => b.over - a.over)
}
