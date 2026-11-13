import { formatCents } from '../../money'
import type { Transaction } from '../../types'
import { SOURCE_FILTERS } from './sources'

export interface ListFilters {
  q: string
  needsReview: boolean
  thisMonth: boolean
  categoryId: number | null
  source: string
  over100: boolean
}

/** The current financial month's first and last day, from the pace endpoint (never the calendar). */
export interface MonthRange {
  start: string
  end: string
}

export const OVER_CENTS = 10000

/** Everything a search can match: description, categories (and split categories), the amount as shown and as typed. */
function haystack(tx: Transaction): string {
  const abs = Math.abs(tx.amount_cents)
  return [
    tx.description,
    tx.category_name ?? '',
    ...tx.splits.map(s => s.category_name ?? ''),
    formatCents(abs),
    (abs / 100).toFixed(2),
  ].join(' ').toLowerCase()
}

export function matchesQuery(tx: Transaction, q: string): boolean {
  const tokens = q.toLowerCase().split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return true
  const text = haystack(tx)
  return tokens.every(t => text.includes(t))
}

export function filterTransactions(list: Transaction[], f: ListFilters, month: MonthRange | null): Transaction[] {
  return list.filter(tx => {
    if (f.needsReview && tx.confirmed) return false
    if (f.thisMonth && month && (tx.date < month.start || tx.date > month.end)) return false
    if (f.categoryId != null && tx.category_id !== f.categoryId && !tx.splits.some(s => s.category_id === f.categoryId)) return false
    if (f.source !== 'all' && tx.source !== f.source) return false
    if (f.over100 && Math.abs(tx.amount_cents) <= OVER_CENTS) return false
    return matchesQuery(tx, f.q)
  })
}

export const hasFilters = (f: ListFilters) =>
  f.q.trim() !== '' || f.needsReview || f.thisMonth || f.categoryId != null || f.source !== 'all' || f.over100

export type Chips = Omit<ListFilters, 'q'>

export const NO_CHIPS: Chips = { needsReview: false, thisMonth: false, categoryId: null, source: 'all', over100: false }

/** The chips held in the address: review=1, month=1, category=<id>, source=ing, over=1. Anything else is ignored. */
export function chipsFromParams(params: URLSearchParams): Chips {
  const id = Number(params.get('category'))
  const source = params.get('source') ?? 'all'
  return {
    needsReview: params.get('review') === '1',
    thisMonth: params.get('month') === '1',
    categoryId: Number.isInteger(id) && id > 0 ? id : null,
    source: SOURCE_FILTERS.includes(source) ? source : 'all',
    over100: params.get('over') === '1',
  }
}

/** The address parameters for a change to some chips: a chip that is off leaves the address (null). */
export function paramsFromChips(patch: Partial<Chips>): Record<string, string | null> {
  const out: Record<string, string | null> = {}
  if ('needsReview' in patch) out.review = patch.needsReview ? '1' : null
  if ('thisMonth' in patch) out.month = patch.thisMonth ? '1' : null
  if ('categoryId' in patch) out.category = patch.categoryId != null ? String(patch.categoryId) : null
  if ('source' in patch) out.source = patch.source && patch.source !== 'all' ? patch.source : null
  if ('over100' in patch) out.over = patch.over100 ? '1' : null
  return out
}
