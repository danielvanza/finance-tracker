import { formatEuros } from '../../money'
import type { Goal } from './types'

/** "Jul 2027" for a financial month label such as "2027-07". */
export const monthLabel = (ym: string) =>
  new Date(`${ym}-15T12:00:00`).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })

const roundUp = (cents: number) => Math.ceil(cents / 100) * 100
const aMonth = (cents: number) => `${formatEuros(cents)} a month`
const NO_PACE = 'a pace shows after two months of saving'

function saving(g: Goal) {
  return g.pace_cents !== null && g.pace_cents > 0 ? `saving about ${aMonth(g.pace_cents)}` : null
}

/** The one sentence and the one line of facts under a goal's meter. Never guesses a pace it doesn't have. */
export function describeGoal(g: Goal): { says: string; facts: string } {
  const needs = g.needed_cents === null ? null : `Needs ${aMonth(roundUp(g.needed_cents))}`
  const pace = g.pace_cents === null ? NO_PACE : (saving(g) ?? 'nothing added lately')
  const by = g.by ? monthLabel(g.by) : ''

  switch (g.status) {
    case 'done':
      return { says: 'Target reached', facts: 'Nothing more to set aside' }
    case 'on_track':
      return { says: `On track for ${by}`, facts: `${needs} · ${pace}` }
    case 'short':
      return { says: `${aMonth(roundUp(g.short_cents ?? 0))} short of ${by}`, facts: `${needs} · ${pace}` }
    case 'unknown':
      return { says: "Can't tell yet", facts: `${needs} · ${NO_PACE}` }
    case 'late': {
      const togo = `${formatEuros(g.target_cents - g.saved_cents)} to go`
      const at = saving(g) && g.reach ? `${saving(g)}, so about ${monthLabel(g.reach)}` : pace
      return { says: `Was due ${by}`, facts: `${togo} · ${at}` }
    }
    case 'open': {
      const sentence = g.pace_cents === null
        ? 'A pace shows after two months of saving'
        : g.reach && saving(g)
          ? `Saving about ${aMonth(g.pace_cents!)}, so about ${monthLabel(g.reach)}`
          : 'Nothing added lately'
      return { says: 'No date set', facts: sentence }
    }
  }
}
