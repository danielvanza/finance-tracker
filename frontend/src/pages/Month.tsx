import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { api } from '../api'
import { dayLabel } from '../dates'
import { formatCents, formatEuros } from '../money'
import type { Pace } from '../types'
import ErrorBanner, { describeApiError } from '../components/ErrorBanner'
import PaceLine from './month/PaceLine'
import Categories from './month/Categories'

const monthName = (label: string) =>
  new Date(`${label}-15T12:00:00`).toLocaleDateString('en-GB', { month: 'short' })

function shiftMonth(label: string, by: number) {
  const [y, m] = label.split('-').map(Number)
  const d = new Date(y, m - 1 + by, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

const BANKS: Record<string, string> = { ing: 'ING', revolut: 'Revolut', degiro: 'DEGIRO' }

/** One plain sentence on how the month is going. */
function paceSentence(p: Pace, left: number) {
  const parts: string[] = []
  if (p.days_left !== null && left > 0) {
    // Today can still be spent, so it counts.
    parts.push(`About ${formatEuros(Math.floor(left / (p.days_left + 1)))} a day.`)
  }
  const delta = p.pace_delta_cents ?? 0
  const nearPlan = Math.abs(delta) < p.spendable_plan_cents / 100
  if (p.days_left === null) {
    parts.push(`${formatEuros(p.spendable_actual_cents)} spent of ${formatEuros(p.spendable_plan_cents)} planned.`)
  } else if (nearPlan) {
    parts.push('Right on plan so far.')
  } else {
    parts.push(`Spent ${formatEuros(Math.abs(delta))} ${delta > 0 ? 'more' : 'less'} than planned by now.`)
  }
  if (p.day_number !== null && p.daily.length < p.day_number - 1) {
    parts.push(`Bank files run to ${dayLabel(p.data_through!)}.`)
  }
  return parts.join(' ')
}

function Verdict({ p }: { p: Pace }) {
  if (p.status === 'empty') {
    return (
      <div className="verdict">
        <h1 className="is-unknown">No bank files yet</h1>
        <p>Bring in a file from a bank to see how the month is going.</p>
      </div>
    )
  }
  if (p.status === 'gap') {
    const last = p.last_import_by_bank.map(b => b.last_date).filter(Boolean).sort().pop()
    return (
      <div className="verdict">
        <h1 className="is-unknown">Can't tell yet</h1>
        <p>{p.month === p.current_month
          ? `The last bank file stops on ${dayLabel(last!)}, so this month has no bank transactions in it.`
          : 'No bank files reach this month.'}</p>
      </div>
    )
  }
  if (p.spendable_plan_cents === 0) {
    return (
      <div className="verdict">
        <h1>{formatEuros(p.spendable_actual_cents)} spent</h1>
        <p>No budget is set for this month yet.</p>
      </div>
    )
  }
  const left = p.spendable_plan_cents - p.spendable_actual_cents
  return (
    <div className="verdict">
      <h1>{left >= 0 ? `${formatEuros(left)} left` : `${formatEuros(-left)} over`}</h1>
      <p>{paceSentence(p, left)}</p>
    </div>
  )
}

function GapToFill({ p }: { p: Pace }) {
  const { behind_months: behind } = p
  const range = behind.length > 1
    ? `${monthName(behind[0])} – ${monthName(behind[behind.length - 1])}`
    : behind.length === 1 ? monthName(behind[0]) : null
  return (
    <div className="panel gap-list">
      <h3>{range ? 'Gap to fill' : 'Banks'}</h3>
      {range && <div><span>{range}</span><small>{behind.length} month{behind.length === 1 ? '' : 's'}</small></div>}
      {p.last_import_by_bank.map(b => (
        <div key={b.source}>
          <span>{BANKS[b.source] ?? b.source}</span>
          <small>{b.last_date ? dayLabel(b.last_date) : 'no file yet'}</small>
        </div>
      ))}
    </div>
  )
}

const KIND_LABELS = { needs: 'Needs', wants: 'Wants', savings: 'Savings' } as const

export default function Month() {
  const [picked, setPicked] = useState<string | undefined>()
  const [actionError, setActionError] = useState('')

  const paceQuery = useQuery({ queryKey: ['pace', picked ?? 'current'], queryFn: () => api.getPace(picked) })
  const p = paceQuery.data
  const month = p?.month
  const { data: rows = [] } = useQuery({ queryKey: ['budget', month], queryFn: () => api.getBudget(month!), enabled: !!month })
  const { data: categories = [] } = useQuery({ queryKey: ['categories'], queryFn: api.getCategories })
  const { data: summary } = useQuery({ queryKey: ['dashboard', month], queryFn: () => api.getDashboard(month!), enabled: !!month })

  if (paceQuery.isError) return <ErrorBanner message={describeApiError(paceQuery.error)} />
  if (!p || !month) {
    return (
      <div aria-busy="true" aria-label="Loading the month">
        <span className="skeleton month-skel-head" />
        <span className="skeleton month-skel-plot" />
      </div>
    )
  }

  const known = p.status === 'ok'
  const isCurrent = month === p.current_month
  const period = `${dayLabel(p.start_date)} – ${dayLabel(p.end_date)}`
  const todayPct = p.day_number === null || !known ? null : (p.day_number / p.days_total) * 100

  const kinds = (Object.keys(KIND_LABELS) as Array<keyof typeof KIND_LABELS>)
    .map(k => ({ key: k, actual: p.actual_cents[k], plan: p.plan_cents[k] }))
    .sort((a, b) => (b.plan ? b.actual / b.plan : 0) - (a.plan ? a.actual / a.plan : 0))

  return (
    <>
      {actionError && <ErrorBanner message={actionError} onDismiss={() => setActionError('')} />}

      <div className="month-bar">
        <span className="lab">{period}{p.day_number !== null && <span className="month-day"> · day {p.day_number} of {p.days_total}</span>}</span>
        <div className="month-nav">
          <button type="button" className="btn" aria-label="Previous month" onClick={() => setPicked(shiftMonth(month, -1))}>
            <ChevronLeft size={16} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="btn"
            aria-label="Next month"
            disabled={isCurrent}
            onClick={() => setPicked(shiftMonth(month, 1))}
          >
            <ChevronRight size={16} aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className={`month-top${known ? '' : ' is-open'}`}>
        <Verdict p={p} />
        <PaceLine pace={p} />
        {!known && <Link to="/import" className="btn btn-primary btn-wide month-cta">Bring in bank files</Link>}

        <div className="side-stack">
          {!known && isCurrent && <GapToFill p={p} />}
          {known && (
            <div className="panel kinds">
              {kinds.map(k => (
                <div className="kind" key={k.key}>
                  <span>{KIND_LABELS[k.key]}</span>
                  <small>{formatEuros(k.actual)} of {formatEuros(k.plan)}</small>
                  <span className="meter" aria-hidden="true">
                    <i style={{ width: `${k.plan > 0 ? Math.max(0, Math.min(100, (k.actual / k.plan) * 100)) : 0}%` }} />
                    {todayPct !== null && <b style={{ left: `${todayPct}%` }} />}
                  </span>
                </div>
              ))}
            </div>
          )}
          {p.to_review > 0 && (
            <Link to="/transactions" className="link-row">
              <span>{p.to_review} transaction{p.to_review === 1 ? '' : 's'} to review</span>
              <ChevronRight size={16} aria-hidden="true" />
            </Link>
          )}
        </div>
      </div>

      {rows.length > 0 && (known ? (
        <section className="section">
          <h2>By category</h2>
          <Categories rows={rows} month={month} categories={categories} todayPct={todayPct} onError={setActionError} />
        </section>
      ) : (
        <details className="section plan-fold">
          <summary>The plan</summary>
          <Categories rows={rows} month={month} categories={categories} todayPct={null} onError={setActionError} />
        </details>
      ))}

      {summary && known && (
        <section className="section">
          <h2>The whole month</h2>
          <dl className="panel whole">
            <div>
              <dt className="lab">Income</dt>
              <dd>
                {formatCents(summary.total_income_cents)}
                {summary.income_breakdown.map(i => (
                  <small key={i.category_id}>{i.category_name} · {formatCents(i.amount_cents)}</small>
                ))}
              </dd>
            </div>
            <div>
              <dt className="lab">Spent</dt>
              <dd>
                {formatCents(summary.total_expenses_cents)}
                {summary.total_income_cents > 0 && (
                  <small>{Math.round((summary.total_expenses_cents / summary.total_income_cents) * 100)}% of income</small>
                )}
              </dd>
            </div>
            <div><dt className="lab">Saved</dt><dd>{formatCents(summary.total_savings_cents)}</dd></div>
            <div><dt className="lab">Net</dt><dd>{formatCents(summary.left_over_cents)}</dd></div>
          </dl>
        </section>
      )}
    </>
  )
}
