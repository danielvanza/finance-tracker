import type { DashboardSummary } from '../../types'
import { formatCents, formatEuros } from '../../money'
import { Amount } from '../overview/Amount'

/**
 * The month shown, whole: what came in, what went out, what was put aside and what is left. One sentence
 * and one ledger line, for the month the arrows above are on. `finished` is false while it is still running.
 */
export default function WholeMonth({ summary, finished }: { summary: DashboardSummary; finished: boolean }) {
  const income = summary.total_income_cents
  const spent = summary.total_expenses_cents
  const left = summary.left_over_cents
  const share = income > 0 ? Math.round((spent / income) * 100) : null

  const sentence = income === 0 && spent === 0
    ? 'Nothing came in or went out.'
    : finished
      ? `${formatEuros(income)} came in and ${formatEuros(spent)} went out.`
      : `So far ${formatEuros(income)} came in and ${formatEuros(spent)} went out.`

  return (
    <section className="panel trend-whole" aria-labelledby="trend-whole-title">
      <h2 id="trend-whole-title" className="sr-only">The whole month</h2>
      <p className="trend-whole-line">
        {sentence}
        {share != null && <span> That is {share}% of what came in.</span>}
      </p>
      <dl className="trend-whole-ledger">
        <div>
          <dt>In</dt>
          <dd><Amount cents={income} /></dd>
          {summary.income_breakdown.length > 1 && summary.income_breakdown.map(i => (
            <dd key={i.category_id} className="trend-whole-part">{i.category_name} · {formatCents(i.amount_cents)}</dd>
          ))}
        </div>
        <div><dt>Spent</dt><dd><Amount cents={spent} /></dd></div>
        <div><dt>Saved</dt><dd><Amount cents={summary.total_savings_cents} /></dd></div>
        <div className={left < 0 ? 'is-over' : undefined}>
          <dt>{left < 0 ? 'Short' : 'Left'}</dt>
          <dd><Amount cents={left} /></dd>
        </div>
      </dl>
    </section>
  )
}
