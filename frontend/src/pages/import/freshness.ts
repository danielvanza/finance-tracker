import type { Pace } from '../../types'

const DAY = 86_400_000
const noon = (iso: string) => Date.parse(`${iso}T12:00:00Z`)

/** Each bank's last row date, by source; null when the bank has no file yet. */
export const lastDates = (pace?: Pace | null): Record<string, string | null> =>
  Object.fromEntries((pace?.last_import_by_bank ?? []).map(b => [b.source, b.last_date]))

export const daysBefore = (iso: string, today: string) => Math.round((noon(today) - noon(iso)) / DAY)
