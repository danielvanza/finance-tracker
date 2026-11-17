import { Link } from 'react-router-dom'
import { formatEuros } from '../../money'
import type { BudgetRow, Category, Pace } from '../../types'
import { categoryStatus } from '../month/projection'

const KINDS = [
  { type: 'needs', label: 'Needs' },
  { type: 'wants', label: 'Wants' },
  { type: 'savings', label: 'Savings' },
] as const

type Tone = 'ok' | 'watch' | 'over'

/** On track, running ahead of the share of the month gone, or over plan. Savings is never "over". */
function toneOf(actual: number, plan: number, elapsed: number | null, saving: boolean): Tone {
  if (plan <= 0) return 'ok'
  if (!saving && actual > plan) return 'over'
  if (!saving && elapsed !== null && actual / plan > elapsed + 0.1) return 'watch'
  return 'ok'
}

function Bar({ actual, plan, tone, today }: { actual: number; plan: number; tone: Tone; today: number | null }) {
  const pct = plan > 0 ? Math.min(100, (actual / plan) * 100) : actual > 0 ? 100 : 0
  return (
    <span className={`ov-meter is-${tone}`} aria-hidden="true">
      <i style={{ width: `${pct}%` }} />
      {today !== null && <b style={{ left: `${today * 100}%` }} />}
    </span>
  )
}

/**
 * Needs, wants and savings against their plans, each with only the categories heading over:
 * well ahead of the month and on course to finish above plan (already over is in Needs you).
 */
export default function Groups({ pace, rows, categories, payments, elapsed }: {
  pace: Pace
  rows: BudgetRow[]
  categories: Category[]
  payments: Record<number, number> | null
  elapsed: number | null
}) {
  const typeOf = new Map(categories.map(c => [c.id, c.type]))
  const today = pace.month === pace.current_month && pace.day_number !== null ? (pace.day_number - 0.5) / pace.days_total : null
  // Up to three categories heading over, across the groups, in group order.
  const heading = KINDS.flatMap(({ type }) => type === 'savings' ? [] : rows
    .filter(r => typeOf.get(r.category_id) === type && r.planned_amount_cents > 0)
    .map(r => {
      const status = payments ? categoryStatus(r.actual_amount_cents ?? 0, r.planned_amount_cents, payments[r.category_id] ?? 0, elapsed) : null
      return status?.kind === 'ahead' ? { r, type, note: `heading for ${formatEuros(status.endCents)}` } : null
    })
    .filter(x => x !== null))
    .slice(0, 3)

  return (
    <section className="ov-card ov-groups" aria-labelledby="groups">
      <h2 id="groups">Needs, wants and savings</h2>
      <ul className="ov-group-list">
        {KINDS.map(({ type, label }) => {
          const actual = pace.actual_cents[type]
          const plan = pace.plan_cents[type]
          const saving = type === 'savings'
          const tone = toneOf(actual, plan, elapsed, saving)
          const left = plan - actual
          const words = saving
            ? left > 0 ? `${formatEuros(left)} to go` : 'All saved'
            : left >= 0 ? `${formatEuros(left)} left` : `${formatEuros(-left)} over`
          const looks = heading.filter(h => h.type === type)
          return (
            <li key={type} className="ov-group">
              <div className="ov-group-head">
                <span className="ov-group-name">{label}</span>
                <span className={`ov-group-left is-${tone}`}>{words}</span>
              </div>
              <Bar actual={actual} plan={plan} tone={tone} today={today} />
              <small className="ov-group-of num">{formatEuros(actual)} of {formatEuros(plan)}</small>
              {looks.length > 0 && (
                <ul className="ov-looks">
                  {looks.map(({ r, note }) => (
                    <li key={r.category_id}>
                      <Link to={`/transactions?category=${r.category_id}&month=1`}>
                        <span>{r.category_name}</span>
                        <span className="ov-look-note is-watch">{note}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
