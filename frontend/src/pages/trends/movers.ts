import type { DashboardSummary } from '../../types'

export interface Mover {
  id: number
  name: string
  now: number
  avg: number
  delta: number // cents against the average, negative when lower
  pct: number // whole percent of the average
}

interface MonthRow {
  month: string
  hasData: boolean
  finished: boolean
}

const EARLIER_MONTHS = 3
const SHOWN = 4
const MIN_AVERAGE_CENTS = 2000 // a category averaging under €20 is too small to call a mover
const MIN_SHARE = 0.15

/** Up to three finished months with spending before the picked one; none when the picked month is unfinished. */
export function earlierMonths(rows: MonthRow[], month: string): string[] {
  const picked = rows.find(r => r.month === month)
  if (!picked || !picked.hasData || !picked.finished) return []
  return rows
    .filter(r => r.month < month && r.hasData && r.finished)
    .slice(-EARLIER_MONTHS)
    .map(r => r.month)
}

/** The categories furthest from their own average of the earlier months, biggest euro change first. */
export function findMovers(current: DashboardSummary, earlier: DashboardSummary[]): Mover[] {
  if (earlier.length === 0) return []
  const names = new Map<number, string>()
  for (const s of [...earlier, current]) for (const c of s.category_breakdown) names.set(c.category_id, c.category_name)
  const actual = (s: DashboardSummary, id: number) => s.category_breakdown.find(c => c.category_id === id)?.actual_cents ?? 0

  const movers: Mover[] = []
  for (const [id, name] of names) {
    const avg = Math.round(earlier.reduce((sum, s) => sum + actual(s, id), 0) / earlier.length)
    const now = actual(current, id)
    const delta = now - avg
    if (avg < MIN_AVERAGE_CENTS || Math.abs(delta) / avg < MIN_SHARE) continue
    movers.push({ id, name, now, avg, delta, pct: Math.round((Math.abs(delta) / avg) * 100) })
  }
  return movers.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, SHOWN)
}

export function moversHeadline(movers: Mover[]) {
  const fell = movers.find(m => m.delta < 0)
  const rose = movers.find(m => m.delta > 0)
  if (fell && rose) return `${fell.name} fell the most, and ${rose.name} rose the most.`
  return fell ? `${fell.name} fell the most.` : rose ? `${rose.name} rose the most.` : ''
}
