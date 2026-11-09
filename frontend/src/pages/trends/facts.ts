import { formatEuros } from '../../money'
import type { TrendMonth } from '../../types'
import { monthName } from './months'

interface FactRow extends TrendMonth {
  hasData: boolean
  finished: boolean
}

export interface Fact {
  label: 'Kept' | 'Saved'
  text: string
}

// A figure that moved by 1% or less counts as the same.
const SAME_POINTS = 1

/** The 50/30/20 remainder as a share of income: what was left after needs and wants. Null without income. */
const keptCents = (r: TrendMonth) => r.total_income_cents - r.needs_cents - r.wants_cents
const keptShare = (r: TrendMonth) =>
  r.total_income_cents > 0 ? Math.round((keptCents(r) / r.total_income_cents) * 100) : null

function keptFact(last: FactRow, before: FactRow | undefined): Fact | null {
  const share = keptShare(last)
  if (share === null) return null
  const lastName = monthName(last.month, 'long')
  if (keptCents(last) < 0) {
    return { label: 'Kept', text: `Needs and wants came to ${formatEuros(-keptCents(last))} more than income in ${lastName}.` }
  }
  const was = before ? keptShare(before) : null
  const beforeName = before ? monthName(before.month, 'long') : ''
  let text = `After needs and wants, ${share}% of income was left in ${lastName}`
  if (was !== null && was >= 0) {
    if (Math.abs(share - was) <= SAME_POINTS) text += `, about the same as in ${beforeName}`
    else text += `, ${share > was ? 'up' : 'down'} from ${was}% in ${beforeName}`
  }
  return { label: 'Kept', text: `${text}.` }
}

function savedFact(last: FactRow, before: FactRow | undefined): Fact | null {
  const now = last.savings_cents
  const was = before?.savings_cents ?? 0
  if (now <= 0 && was <= 0) return null
  const lastName = monthName(last.month, 'long')
  const lead = now > 0 ? `${formatEuros(now)} went into savings` : 'Nothing went into savings'
  if (!before) return { label: 'Saved', text: `${lead} in ${lastName}.` }
  const beforeName = monthName(before.month, 'long')
  if (Math.abs(now - was) <= Math.abs(was) / 100) return { label: 'Saved', text: `${lead}, the same as in ${beforeName}.` }
  return { label: 'Saved', text: `${lead}, ${now > was ? 'up' : 'down'} from ${formatEuros(was)} in ${beforeName}.` }
}

/** What was kept and saved in the latest finished month, against the finished month before it. */
export function trendFacts(rows: FactRow[]): Fact[] {
  const finished = rows.filter(r => r.hasData && r.finished)
  const last = finished[finished.length - 1]
  if (!last) return []
  const before = finished[finished.length - 2]
  return [keptFact(last, before), savedFact(last, before)].filter((f): f is Fact => f !== null)
}
