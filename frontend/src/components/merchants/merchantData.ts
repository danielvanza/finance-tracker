import type { Category, CategoryType, Rule, Transaction } from '../../types'
import { merchantFor } from './merchantKey'
import type { MerchantModel, MerchantMonth, MerchantScope, RankedMerchant } from './types'

export const DEFAULT_START_DAY = 24
export const WINDOW = 6

const pad = (n: number) => String(n).padStart(2, '0')
const isoDate = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`

/** The financial month ("2026-11") a date falls in: with start day 24, 24 Oct to 23 Nov is November. */
export function labelForDate(iso: string, startDay: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  if (startDay > 1 && d >= startDay) return m === 12 ? `${y + 1}-01` : `${y}-${pad(m + 1)}`
  return `${y}-${pad(m)}`
}

/** First and last day (inclusive) of a financial month. */
export function monthRange(label: string, startDay: number): { from: string; to: string } {
  const [y, m] = label.split('-').map(Number)
  if (startDay <= 1) return { from: isoDate(y, m, 1), to: isoDate(y, m, new Date(y, m, 0).getDate()) }
  const [py, pm] = m === 1 ? [y - 1, 12] : [y, m - 1]
  return { from: isoDate(py, pm, startDay), to: isoDate(y, m, startDay - 1) }
}

export function shiftLabel(label: string, by: number): string {
  const [y, m] = label.split('-').map(Number)
  const index = y * 12 + (m - 1) + by
  return `${Math.floor(index / 12)}-${pad((index % 12) + 1)}`
}

export const monthName = (label: string, long = true, withYear = false) =>
  new Date(`${label}-15T12:00:00`).toLocaleDateString('en-GB', {
    month: long ? 'long' : 'short',
    ...(withYear ? { year: 'numeric' } : {}),
  })

interface Part {
  categoryId: number | null
  categoryName: string | null
  /** Signed, as the bank wrote it. */
  cents: number
  refund: boolean
}

function partsOf(tx: Transaction): Part[] {
  if (tx.splits.length > 0) {
    return tx.splits.map(s => ({ categoryId: s.category_id, categoryName: s.category_name, cents: s.amount_cents, refund: s.is_refund }))
  }
  return [{ categoryId: tx.category_id, categoryName: tx.category_name, cents: tx.amount_cents, refund: tx.is_refund }]
}

const typeOf = (categories: Category[]) => {
  const byId = new Map(categories.map(c => [c.id, c.type] as const))
  return (id: number | null): CategoryType | null => (id == null ? null : byId.get(id) ?? null)
}

/** What a part adds to the merchant's spend: an expense adds, a refund takes off. Null = not spend here. */
function spendOf(part: Part, type: CategoryType | null, kinds: readonly CategoryType[], uncategorised: boolean): number | null {
  if (part.categoryId == null) return uncategorised && part.cents < 0 && !part.refund ? -part.cents : null
  if (type === null || !kinds.includes(type)) return null
  if (part.cents >= 0 && !part.refund) return null
  return part.refund ? -Math.abs(part.cents) : -part.cents
}

const SHEET_KINDS: readonly CategoryType[] = ['needs', 'wants', 'savings']
const VIEW_KINDS: readonly CategoryType[] = ['needs', 'wants']

const newestFirst = (a: Transaction, b: Transaction) => b.date.localeCompare(a.date) || b.id - a.id

export function transactionsOf(key: string, transactions: Transaction[]): Transaction[] {
  return transactions.filter(tx => merchantFor(tx.description).key === key).sort(newestFirst)
}

/** Unconfirmed purchases of this merchant that a rule would settle: whole, not split, not a refund. */
export function waitingFor(key: string, transactions: Transaction[]): Transaction[] {
  return transactionsOf(key, transactions).filter(
    tx => !tx.confirmed && tx.splits.length === 0 && !tx.is_refund && tx.amount_cents < 0,
  )
}

/** The rule that already sorts this merchant: its pattern sits inside the key, so it catches every purchase. */
export function coveringRule(key: string, rules: Rule[]): Rule | null {
  return [...rules]
    .sort((a, b) => b.priority - a.priority || a.id - b.id)
    .find(r => r.pattern.trim() !== '' && key.includes(r.pattern.trim().toLowerCase())) ?? null
}

interface ModelInput {
  key: string
  transactions: Transaction[]
  categories: Category[]
  currentMonth: string
  behindMonths: string[]
  startDay: number
}

export function buildMerchantModel({ key, transactions, categories, currentMonth, behindMonths, startDay }: ModelInput): MerchantModel {
  const history = transactionsOf(key, transactions)
  const type = typeOf(categories)

  const byMonth: MerchantModel['byMonth'] = {}
  const counts = new Map<number, { name: string; count: number }>()
  let unsorted = 0
  for (const tx of history) {
    const label = labelForDate(tx.date, startDay)
    let spent = 0
    let counted = false
    for (const part of partsOf(tx)) {
      const s = spendOf(part, type(part.categoryId), SHEET_KINDS, true)
      if (s === null) continue
      spent += s
      if (!part.refund) counted = true
    }
    const entry = (byMonth[label] ??= { cents: 0, purchases: 0 })
    entry.cents += spent
    if (counted) entry.purchases += 1

    for (const part of partsOf(tx)) {
      if (part.cents >= 0 || part.refund) continue
      if (part.categoryId == null) unsorted += 1
      else {
        const c = counts.get(part.categoryId) ?? { name: part.categoryName ?? '', count: 0 }
        c.count += 1
        counts.set(part.categoryId, c)
      }
    }
  }
  const categoriesUsed = [...counts].map(([id, c]) => ({ id, ...c })).sort((a, b) => b.count - a.count)

  const rawCount = new Map<string, number>()
  for (const tx of history) rawCount.set(tx.description, (rawCount.get(tx.description) ?? 0) + 1)
  const raws = [...rawCount].sort((a, b) => b[1] - a[1]).map(([raw]) => raw)

  const months: MerchantMonth[] = Array.from({ length: WINDOW }, (_, i) => {
    const label = shiftLabel(currentMonth, i - (WINDOW - 1))
    const { cents = 0, purchases = 0 } = byMonth[label] ?? {}
    const behind = behindMonths.includes(label)
    const net = Math.max(cents, 0)
    return {
      label, short: monthName(label, false), cents: net, purchases,
      partial: label === currentMonth || (behind && purchases > 0),
      noData: behind && purchases === 0 && net === 0,
    }
  })

  return {
    key,
    name: history[0] ? merchantFor(history[0].description).name : key,
    history,
    raws,
    months,
    windowCents: months.reduce((a, m) => a + m.cents, 0),
    windowPurchases: months.reduce((a, m) => a + m.purchases, 0),
    categories: categoriesUsed,
    unsorted,
    topCategoryId: categoriesUsed[0]?.id ?? null,
    waiting: waitingFor(key, transactions),
    byMonth,
  }
}

export function scopeRange(scope: MerchantScope, currentMonth: string, startDay: number): { from: string; to: string } | null {
  if (scope === 'all') return null
  const to = monthRange(currentMonth, startDay).to
  const from = monthRange(scope === 'month' ? currentMonth : shiftLabel(currentMonth, -(WINDOW - 1)), startDay).from
  return { from, to }
}

/** Where the money went: merchants by net spend in needs and wants, biggest first. */
export function rankMerchants(
  transactions: Transaction[],
  categories: Category[],
  range: { from: string; to: string } | null,
): RankedMerchant[] {
  const type = typeOf(categories)
  const groups = new Map<string, RankedMerchant & { latest: string }>()
  for (const tx of transactions) {
    if (range && (tx.date < range.from || tx.date > range.to)) continue
    let spent = 0
    let counted = false
    for (const part of partsOf(tx)) {
      const s = spendOf(part, type(part.categoryId), VIEW_KINDS, false)
      if (s === null) continue
      spent += s
      if (!part.refund) counted = true
    }
    if (spent === 0 && !counted) continue
    const m = merchantFor(tx.description)
    const g = groups.get(m.key) ?? { key: m.key, name: m.name, sample: tx.description, cents: 0, purchases: 0, latest: '' }
    g.cents += spent
    if (counted) g.purchases += 1
    if (tx.date >= g.latest) Object.assign(g, { latest: tx.date, name: m.name, sample: tx.description })
    groups.set(m.key, g)
  }
  return [...groups.values()]
    .filter(g => g.cents > 0)
    .sort((a, b) => b.cents - a.cents || a.name.localeCompare(b.name))
    .map(({ key, name, sample, cents, purchases }) => ({ key, name, sample, cents, purchases }))
}
