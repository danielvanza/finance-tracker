import { useState } from 'react'
import { Link } from 'react-router-dom'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { api } from '../api'
import { dayLabel } from '../dates'
import { formatCents, formatEuros } from '../money'
import type { FreeToSpend, Pace } from '../types'
import ImportLink from '../components/ImportLink'
import { aimsOf } from '../components/budget/plan'
import ErrorBanner, { describeApiError } from '../components/ErrorBanner'
import RecurringLink from '../components/recurring/RecurringLink'
import ReportLink from '../components/reports/ReportLink'
import PaceLine from './month/PaceLine'
import Categories from './month/Categories'
import { elapsedShare, paymentsByCategory, projectMonthEnd } from './month/projection'

const monthName = (label: string) =>
  new Date(`${label}-15T12:00:00`).toLocaleDateString('en-GB', { month: 'short' })

function shiftMonth(label: string, by: number) {
  const [y, m] = label.split('-').map(Number)
  const d = new Date(y, m - 1 + by, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

/** What can be spent a day, and how the month is going: where it ends when we can say, how far from plan it is otherwise. */
function paceSentence(p: Pace, left: number) {
  const parts: string[] = []
  const projection = projectMonthEnd(p)
  // Today can still be spent, so it counts. With fixed bills and set-asides allowed for, it is the free amount a day.
  const perDay = p.free
    ? (p.free.per_day_cents !== null ? formatEuros(p.free.per_day_cents) : null)
    : p.days_left !== null && left > 0 ? formatEuros(Math.floor(left / (p.days_left + 1))) : null
  if (projection) {
    const { ordinaryDayCents, gapCents } = projection
    const ordinary = formatEuros(ordinaryDayCents)
    parts.push(perDay
      ? `About ${perDay} a day ${p.free ? 'until payday' : 'keeps you in plan'}; ordinary days have cost about ${ordinary}.`
      : `Ordinary days have cost about ${ordinary}.`)
    parts.push(gapCents === 0
      ? 'At this pace you will finish right on plan.'
      : `At this pace you will finish about ${formatEuros(Math.abs(gapCents))} ${gapCents > 0 ? 'over' : 'under'}.`)
  } else {
    if (perDay) parts.push(p.free ? `About ${perDay} a day until payday.` : `About ${perDay} a day.`)
    const delta = p.pace_delta_cents ?? 0
    if (p.days_left === null) {
      parts.push(`${formatEuros(p.spendable_actual_cents)} spent of ${formatEuros(p.spendable_plan_cents)} planned.`)
    } else if (Math.abs(delta) < p.spendable_plan_cents / 100) {
      parts.push('Right on plan so far.')
    } else {
      parts.push(`Spent ${formatEuros(Math.abs(delta))} ${delta > 0 ? 'more' : 'less'} than planned by now.`)
    }
  }
  if (p.day_number !== null && p.daily.length < p.day_number - 1) {
    parts.push(`Bank files run to ${dayLabel(p.data_through!)}.`)
  }
  return parts.join(' ')
}

/** How the headline is worked out: what is left in the plan, the fixed bills still to come, and what is set aside. */
function FreeHow({ free, end }: { free: FreeToSpend; end: string }) {
  const qc = useQueryClient()
  const leaveOut = async (key: string) => {
    await api.ignoreBill(key)
    qc.invalidateQueries({ queryKey: ['pace'] })
    qc.invalidateQueries({ queryKey: ['recurring'] })
  }
  return (
    <details className="free-how">
      <summary>
        {formatEuros(free.left_in_plan_cents)} left in the plan
        {free.bills_cents > 0 && <>, less {formatEuros(free.bills_cents)} of fixed bills still to come</>}
        {free.set_aside_cents > 0 && <>, less {formatEuros(free.set_aside_cents)} set aside</>}
      </summary>
      {free.bills.length === 0 && free.set_asides.length === 0 && (
        <p className="muted">No fixed bills are still to come before {dayLabel(end)}, and nothing is set aside this month.</p>
      )}
      {free.bills.length > 0 && (
        <ul className="free-list" aria-label="Fixed bills still to come">
          {free.bills.map(bill => (
            <li key={bill.key}>
              <span>{bill.name}<small>{bill.next_date ? `due ${dayLabel(bill.next_date)}` : ''} · {bill.category_name}</small></span>
              <span className="num">{formatEuros(bill.amount_cents)}</span>
              <button type="button" className="btn btn-sm" onClick={() => leaveOut(bill.key)} aria-label={`${bill.name} is not a fixed bill`}>
                Not a fixed bill
              </button>
            </li>
          ))}
        </ul>
      )}
      {free.set_asides.length > 0 && (
        <ul className="free-list" aria-label="Set aside this month">
          {free.set_asides.map(bill => (
            <li key={bill.id}>
              <span>{bill.name}<small>set aside this month</small></span>
              <span className="num">{formatEuros(bill.monthly_cents)}</span>
            </li>
          ))}
        </ul>
      )}
    </details>
  )
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
  if (p.free) {
    const free = p.free.free_cents
    return (
      <div className="verdict">
        <h1>{free >= 0 ? `${formatEuros(free)} free to spend` : `${formatEuros(-free)} over`}</h1>
        <p className="verdict-sub">{free >= 0 ? `until payday, ${dayLabel(p.end_date)}` : 'what was free to spend this month'}</p>
        <p>{paceSentence(p, left)}</p>
        {p.to_review_in_month > 0 && (
          <p className="verdict-caveat">
            {p.to_review_in_month} payment{p.to_review_in_month === 1 ? '' : 's'} this month still wait{p.to_review_in_month === 1 ? 's' : ''} for an answer and {p.to_review_in_month === 1 ? 'is' : 'are'} not counted.{' '}
            <Link to="/transactions" className="verdict-go">Answer {p.to_review_in_month === 1 ? 'it' : 'them'}</Link>
          </p>
        )}
        <FreeHow free={p.free} end={p.end_date} />
      </div>
    )
  }
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
          <span>{b.source.toUpperCase()}</span>
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

  // Moving to another month keeps the one on screen, dimmed, until the next one has arrived.
  const paceQuery = useQuery({
    queryKey: ['pace', picked ?? 'current'], queryFn: () => api.getPace(picked), placeholderData: keepPreviousData,
  })
  const p = paceQuery.data
  const month = p?.month
  const budgetQuery = useQuery({
    queryKey: ['budget', month], queryFn: () => api.getBudget(month!), enabled: !!month, placeholderData: keepPreviousData,
  })
  const rows = budgetQuery.data ?? []
  const { data: categories = [] } = useQuery({ queryKey: ['categories'], queryFn: api.getCategories })
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: api.getSettings })
  const aims = aimsOf(settings?.target_split)
  const summaryQuery = useQuery({
    queryKey: ['dashboard', month], queryFn: () => api.getDashboard(month!), enabled: !!month, placeholderData: keepPreviousData,
  })
  const summary = summaryQuery.data
  const paymentsQuery = useQuery({
    queryKey: ['transactions', { month, confirmed: 'true' }],
    queryFn: () => api.getTransactions({ month: month!, confirmed: 'true' }),
    enabled: p?.status === 'ok',
    placeholderData: keepPreviousData,
  })
  const loadingMonth = paceQuery.isPlaceholderData || budgetQuery.isPlaceholderData
    || summaryQuery.isPlaceholderData || paymentsQuery.isPlaceholderData

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
  const payments = known && paymentsQuery.data ? paymentsByCategory(paymentsQuery.data) : null
  const elapsed = elapsedShare(p)
  const shownMonth = picked ?? month

  const kinds = (Object.keys(KIND_LABELS) as Array<keyof typeof KIND_LABELS>)
    .map(k => ({ key: k, actual: p.actual_cents[k], plan: p.plan_cents[k] }))
    .sort((a, b) => (b.plan ? b.actual / b.plan : 0) - (a.plan ? a.actual / a.plan : 0))

  return (
    <>
      {actionError && <ErrorBanner message={actionError} onDismiss={() => setActionError('')} />}

      <div className="month-bar">
        <span className="lab">{period}{p.day_number !== null && <span className="month-day"> · day {p.day_number} of {p.days_total}</span>}</span>
        <div className="month-nav">
          <ImportLink />
          <button type="button" className="btn" aria-label="Previous month" onClick={() => setPicked(shiftMonth(shownMonth, -1))}>
            <ChevronLeft size={16} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="btn"
            aria-label="Next month"
            disabled={shownMonth === p.current_month}
            onClick={() => setPicked(shiftMonth(shownMonth, 1))}
          >
            <ChevronRight size={16} aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className={`month-body${loadingMonth ? ' is-loading' : ''}`} aria-busy={loadingMonth}>
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
                    <small>
                      {formatEuros(k.actual)} of {formatEuros(k.plan)}
                      {summary && summary.total_income_cents > 0 && (
                        <span className="kind-share"> · {Math.round((k.actual / summary.total_income_cents) * 100)}% of income, aim {aims[k.key]}%</span>
                      )}
                    </small>
                    <span className="meter" aria-hidden="true">
                      <i style={{ width: `${k.plan > 0 ? Math.max(0, Math.min(100, (k.actual / k.plan) * 100)) : 0}%` }} />
                      {todayPct !== null && <b style={{ left: `${todayPct}%` }} />}
                    </span>
                  </div>
                ))}
              </div>
            )}
            <ReportLink month={month}>
              {p.to_review > 0 && (
                <Link to="/transactions" className="link-row">
                  <span>{p.to_review} transaction{p.to_review === 1 ? '' : 's'} to review</span>
                  <ChevronRight size={16} aria-hidden="true" />
                </Link>
              )}
              <RecurringLink month={month} />
            </ReportLink>
          </div>
        </div>

        {rows.length > 0 && (known ? (
          <section className="section">
            <h2>By category</h2>
            <Categories key={month} rows={rows} month={month} isCurrent={isCurrent} categories={categories} todayPct={todayPct} payments={payments} elapsed={elapsed} onError={setActionError} />
          </section>
        ) : (
          <details className="section plan-fold">
            <summary>The plan</summary>
            <Categories key={month} rows={rows} month={month} isCurrent={isCurrent} categories={categories} todayPct={null} payments={payments} elapsed={null} onError={setActionError} />
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
      </div>
    </>
  )
}
