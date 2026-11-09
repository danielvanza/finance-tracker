import { dayLabel } from '../../dates'
import type { Pace } from '../../types'
import { BANKS, SOURCES } from './bank'

const DAY = 86_400_000
const noon = (iso: string) => Date.parse(`${iso}T12:00:00Z`)

/** Each bank's last row date, by source; null when the bank has no file yet. */
export const lastDates = (pace?: Pace | null): Record<string, string | null> =>
  Object.fromEntries((pace?.last_import_by_bank ?? []).map(b => [b.source, b.last_date]))

export const daysBefore = (iso: string, today: string) => Math.round((noon(today) - noon(iso)) / DAY)

export const agoLabel = (days: number) => (days <= 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`)

/** The bank with the oldest last row among those that have a file. A bank with none is never suggested. */
export function stalestBank(pace?: Pace | null): string | null {
  const last = lastDates(pace)
  let best: string | null = null
  for (const s of SOURCES) {
    const d = last[s]
    if (d && (best === null || d < (last[best] as string))) best = s
  }
  return best
}

/** Banks whose last row is later than it was when the page opened. */
export function movedBanks(pace?: Pace | null, snapshot?: Pace | null): string[] {
  const now = lastDates(pace)
  const was = lastDates(snapshot)
  return SOURCES.filter(s => now[s] && (!was[s] || (now[s] as string) > (was[s] as string)))
}

/** The line under the bank choice: what changed this visit, then where the chosen bank stands. */
export function bankHint(source: string, pace: Pace, snapshot: Pace | null): string {
  const now = lastDates(pace)
  const was = lastDates(snapshot)
  const moved = snapshot ? movedBanks(pace, snapshot) : []
  const bank = BANKS[source]
  const parts = moved.map(
    s => `${BANKS[s]} now runs to ${dayLabel(now[s] as string)}${was[s] ? `, up from ${dayLabel(was[s] as string)}` : ''}.`,
  )
  if (moved.includes(source)) return parts.join(' ')
  const last = now[source]
  if (!last) return [...parts, `No ${bank} file yet.`].join(' ')
  const when = `${dayLabel(last)}, ${agoLabel(daysBefore(last, pace.today))}`
  if (moved.length && source === stalestBank(pace)) return [...parts, `${bank} is next: its last row is ${when}.`].join(' ')
  return [...parts, `Last ${bank} row: ${when}. Export from ${dayLabel(last)} to today; rows already in are skipped.`].join(' ')
}
