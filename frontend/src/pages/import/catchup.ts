import type { Pace } from '../../types'
import { SOURCES } from './bank'
import { daysBefore, lastDates } from './freshness'

/** A bank whose last row is this many days before today counts as behind. */
export const CATCHUP_DAYS = 7

export interface CatchupPath {
  /** Banks that were behind when the page opened, oldest last row first. */
  banks: string[]
  /** The oldest last row among them, or null when no bank has a file. */
  from: string | null
  /** Whether the month has no bank data at all yet. */
  empty: boolean
}

/** The picking-up path, or null when every bank is within a week and the month has data. Read from the page-open snapshot. */
export function catchupPath(snapshot: Pace): CatchupPath | null {
  const last = lastDates(snapshot)
  const banks = SOURCES.filter(s => last[s] && daysBefore(last[s] as string, snapshot.today) >= CATCHUP_DAYS).sort((a, b) =>
    (last[a] as string).localeCompare(last[b] as string),
  )
  if (!banks.length && snapshot.status === 'ok') return null
  return { banks, from: banks.length ? (last[banks[0]] as string) : null, empty: snapshot.status === 'empty' }
}

export interface CatchupProgress {
  /** One per bank in the path (one in all when there are no bank files yet): no longer behind, or imported on this visit. */
  done: boolean[]
  /** Index of the current step: the banks, then Review, then The month. */
  current: number
  /** The next bank still behind, if any. */
  next: string | null
}

export function catchupProgress(path: CatchupPath, pace: Pace | null, imported: string[]): CatchupProgress {
  const last = lastDates(pace)
  const done = path.empty
    ? [imported.length > 0 || (pace != null && pace.status !== 'empty')]
    : path.banks.map(
        s => imported.includes(s) || (pace != null && last[s] != null && daysBefore(last[s] as string, pace.today) < CATCHUP_DAYS),
      )
  const open = done.indexOf(false)
  if (open !== -1) return { done, current: open, next: path.empty ? null : path.banks[open] }
  return { done, current: done.length + (pace && pace.to_review === 0 ? 1 : 0), next: null }
}
