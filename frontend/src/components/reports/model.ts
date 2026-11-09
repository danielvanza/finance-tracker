import { dayLabel } from '../../dates'
import { formatCents, formatEuros } from '../../money'
import type { BudgetRow, DashboardSummary, Pace, Transaction } from '../../types'
import type { Report, ReportGroup, ReportKind, ReportMove, ReportRow } from './types'

const KINDS: ReportKind[] = ['needs', 'wants', 'savings']
const LABELS: Record<ReportKind, string> = { needs: 'Needs', wants: 'Wants', savings: 'Savings' }

/** Under half a euro is not worth a line: it would read "€0 more". */
const NEGLIGIBLE = 50

const MONTHS = (label: string, style: 'short' | 'long') =>
  new Date(`${label}-15T12:00:00`).toLocaleDateString('en-GB', { month: style })

export function shiftMonth(label: string, by: number) {
  const [y, m] = label.split('-').map(Number)
  const d = new Date(y, m - 1 + by, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export const isKind = (t: string | undefined): t is ReportKind => t === 'needs' || t === 'wants' || t === 'savings'

export interface ReportInput {
  pace: Pace
  /** The month's plan rows (`getBudget`). */
  budget: BudgetRow[]
  summary: DashboardSummary | undefined
  /** The month before: its summary and pace, once both loaded. Without it nothing is compared. */
  previous: { summary: DashboardSummary; pace: Pace } | undefined
  transactions: Transaction[] | undefined
}

function headline(p: Pace): { headline: string; sentence: string } {
  if (p.status === 'empty') {
    return { headline: 'No bank files yet', sentence: 'Bring in a file from a bank to see how the month is going.' }
  }
  if (p.status === 'gap') {
    return { headline: "Can't tell yet", sentence: 'No bank files reach this month.' }
  }
  if (p.spendable_plan_cents === 0) {
    return { headline: `${formatEuros(p.spendable_actual_cents)} spent`, sentence: 'No budget is set for this month yet.' }
  }
  const left = p.spendable_plan_cents - p.spendable_actual_cents
  const saved = p.plan_cents.savings > 0
    ? ` Saved ${formatEuros(p.actual_cents.savings)} of ${formatEuros(p.plan_cents.savings)}.`
    : ''
  return {
    headline: left >= 0 ? `${formatEuros(left)} left` : `${formatEuros(-left)} over`,
    sentence: `${formatEuros(p.spendable_actual_cents)} spent of ${formatEuros(p.spendable_plan_cents)} planned.${saved}`,
  }
}

/** Plan by category: this month's plan rows, plus any category that has spending but no plan row. */
function rowsFor(input: ReportInput, comparing: boolean) {
  const prevSpent = new Map<number, number>()
  const prevNames = new Map<number, { name: string; kind: ReportKind }>()
  for (const c of input.previous?.summary.category_breakdown ?? []) {
    prevSpent.set(c.category_id, c.actual_cents)
    if (isKind(c.type)) prevNames.set(c.category_id, { name: c.category_name, kind: c.type })
  }

  const rows = new Map<number, ReportRow>()
  const make = (id: number, name: string, kind: ReportKind, spent: number, plan: number): ReportRow => ({
    id, name, kind, spent, plan, before: comparing ? (prevSpent.get(id) ?? 0) : null,
  })
  for (const b of input.budget) {
    if (isKind(b.category_type)) {
      rows.set(b.category_id, make(b.category_id, b.category_name, b.category_type, b.actual_amount_cents ?? 0, b.planned_amount_cents))
    }
  }
  for (const c of input.summary?.category_breakdown ?? []) {
    if (!rows.has(c.category_id) && isKind(c.type)) {
      rows.set(c.category_id, make(c.category_id, c.category_name, c.type, c.actual_cents, c.planned_cents))
    }
  }
  // Spent last month and nothing this month: only "what moved" needs it.
  const gone: ReportRow[] = []
  if (comparing) {
    for (const [id, info] of prevNames) {
      if (!rows.has(id)) gone.push(make(id, info.name, info.kind, 0, 0))
    }
  }
  return { rows: [...rows.values()], gone }
}

const moves = (rows: ReportRow[], sign: 1 | -1): ReportMove[] =>
  rows
    .filter(r => r.before !== null)
    .map(r => ({ name: r.name, diff: r.spent - (r.before ?? 0), before: r.before ?? 0, spent: r.spent }))
    .filter(m => m.diff * sign >= NEGLIGIBLE)
    .sort((a, b) => (b.diff - a.diff) * sign)
    .slice(0, 3)

export function buildReport(input: ReportInput): Report {
  const { pace: p, summary } = input
  const known = p.status === 'ok'
  const comparing = known && input.previous?.pace.status === 'ok'
  const { rows, gone } = rowsFor(input, comparing)

  const groups: ReportGroup[] = KINDS.map(kind => {
    const mine = rows.filter(r => r.kind === kind && (r.plan > 0 || r.spent !== 0)).sort((a, b) => b.spent - a.spent)
    return {
      kind, label: LABELS[kind], rows: mine,
      spent: mine.reduce((n, r) => n + r.spent, 0), plan: mine.reduce((n, r) => n + r.plan, 0),
    }
  }).filter(g => g.rows.length > 0)

  const prevLabel = shiftMonth(p.month, -1)
  const all = [...rows, ...gone]
  const { headline: h, sentence } = headline(p)

  return {
    month: p.month,
    period: `${dayLabel(p.start_date)} – ${dayLabel(p.end_date)} ${p.end_date.slice(0, 4)}`,
    dayNote: p.day_number !== null ? `day ${p.day_number} of ${p.days_total}` : null,
    status: p.status,
    headline: h,
    sentence,
    kinds: known ? KINDS.map(kind => ({ kind, label: LABELS[kind], spent: p.actual_cents[kind], plan: p.plan_cents[kind] })) : [],
    groups: known ? groups : [],
    compare: comparing ? { short: MONTHS(prevLabel, 'short'), long: MONTHS(prevLabel, 'long') } : null,
    more: comparing ? moves(all, 1) : [],
    less: comparing ? moves(all, -1) : [],
    whole: known && summary ? {
      income: summary.total_income_cents,
      incomeLines: summary.income_breakdown.map(i => ({ name: i.category_name, cents: i.amount_cents })),
      spent: summary.total_expenses_cents,
      saved: summary.total_savings_cents,
      net: summary.left_over_cents,
    } : null,
    counts: input.transactions
      ? { confirmed: input.transactions.filter(t => t.confirmed).length, toReview: input.transactions.filter(t => !t.confirmed).length }
      : null,
  }
}

// What a row says, in whole euros, the same way on the page and in the copied text.

const OVER = (r: ReportRow) => r.plan > 0 && r.spent - r.plan >= NEGLIGIBLE

export const spentText = (r: ReportRow) => (OVER(r) ? `${formatEuros(r.spent - r.plan)} over` : formatEuros(r.spent))

export const planText = (r: ReportRow) => {
  if (r.plan === 0) return 'no plan'
  return OVER(r) ? `${formatEuros(r.spent)} of ${formatEuros(r.plan)}` : `of ${formatEuros(r.plan)}`
}

export function sinceText(r: ReportRow, short: string) {
  if (r.before === null) return ''
  const diff = r.spent - r.before
  if (Math.abs(diff) < NEGLIGIBLE) return `same as ${short}`
  return `${formatEuros(Math.abs(diff))} ${diff > 0 ? 'more' : 'less'}`
}

export const moveText = (m: ReportMove) => `${formatEuros(Math.abs(m.diff))} ${m.diff > 0 ? 'more' : 'less'}`

export const moveRange = (m: ReportMove) => `${formatEuros(m.before)} to ${formatEuros(m.spent)}`

export const meterPct = (spent: number, plan: number) => (plan > 0 ? Math.max(0, Math.min(100, (spent / plan) * 100)) : 0)

export const longDate = (d: Date) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })

export function footerText(r: Report, today: Date) {
  const made = `Made on ${longDate(today)}`
  if (!r.counts) return `${made}.`
  const { confirmed, toReview } = r.counts
  const from = `${made} from ${confirmed} confirmed transaction${confirmed === 1 ? '' : 's'}.`
  return toReview > 0
    ? `${from} ${toReview} transaction${toReview === 1 ? '' : 's'} still to review ${toReview === 1 ? 'is' : 'are'} not counted.`
    : `${from} Nothing is waiting for review.`
}

/** The report as plain lines, to paste into a chat or a note. */
export function reportText(r: Report, today: Date): string {
  const out = [`Finances, ${r.period}`, r.headline, r.sentence]
  if (r.groups.length > 0) {
    out.push('')
    for (const g of r.groups) {
      out.push(`${g.label}: ${formatEuros(g.spent)} of ${formatEuros(g.plan)}`)
      for (const row of g.rows) {
        const since = r.compare ? `, ${sinceText(row, r.compare.short)}` : ''
        out.push(`- ${row.name}: ${spentText(row)} (${planText(row)}${since})`)
      }
    }
  }
  if (r.compare && (r.more.length > 0 || r.less.length > 0)) {
    out.push('')
    if (r.more.length > 0) out.push(`More than ${r.compare.long}: ${r.more.map(m => `${m.name} ${moveText(m)}`).join(', ')}`)
    if (r.less.length > 0) out.push(`Less than ${r.compare.long}: ${r.less.map(m => `${m.name} ${moveText(m)}`).join(', ')}`)
  }
  if (r.whole) {
    out.push('')
    out.push(`Income ${formatCents(r.whole.income)}, spent ${formatCents(r.whole.spent)}, saved ${formatCents(r.whole.saved)}, net ${formatCents(r.whole.net)}`)
  }
  out.push('', footerText(r, today))
  return out.join('\n')
}
