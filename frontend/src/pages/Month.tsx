import { useState } from 'react'
import { Link } from 'react-router-dom'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { api } from '../api'
import { dayLabel } from '../dates'
import { formatEuros } from '../money'
import type { FreeToSpend, Pace } from '../types'
import { Amount } from './overview/Amount'
import NeedsYou from './overview/NeedsYou'
import StillToPay from './overview/StillToPay'
import Groups from './overview/Groups'
import { aimsOf } from '../components/budget/plan'
import ErrorBanner from '../components/ErrorBanner'
import { describeApiError } from '../components/apiError'
import RecurringLink from '../components/recurring/RecurringLink'
import ReportLink from '../components/reports/ReportLink'
import PaceLine from './month/PaceLine'
import Categories, { type KindFigures } from './month/Categories'
import { elapsedShare, paymentsByCategory } from './month/projection'

const monthName = (label: string) =>
  new Date(`${label}-15T12:00:00`).toLocaleDateString('en-GB', { month: 'short' })

function shiftMonth(label: string, by: number) {
  const [y, m] = label.split('-').map(Number)
  const d = new Date(y, m - 1 + by, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

const eurosOrShort = (cents: number) => (cents < 0 ? `${formatEuros(-cents)} short` : formatEuros(cents))

/** One sum per line, the last one the total. */
function Sum({ lines, total }: { lines: Array<[string, string, string?]>; total: [string, string] }) {
  return (
    <dl>
      {lines.map(([name, amount, note]) => (
        <div key={name}><dt>{name}{note && <small>{note}</small>}</dt><dd>{amount}</dd></div>
      ))}
      <div className="sum"><dt>{total[0]}</dt><dd>{total[1]}</dd></div>
    </dl>
  )
}

const nextDay = (iso: string) => {
  const d = new Date(`${iso}T12:00:00`)
  d.setDate(d.getDate() + 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** How the two headline figures are worked out, each as its own sum, with the bills and set-asides they allow for. */
function Ledger({ p, free, daysToPayday }: { p: Pace; free: FreeToSpend; daysToPayday: number }) {
  const qc = useQueryClient()
  const leaveOut = async (key: string) => {
    await api.ignoreBill(key)
    qc.invalidateQueries({ queryKey: ['pace'] })
    qc.invalidateQueries({ queryKey: ['recurring'] })
  }
  const e = formatEuros
  const end = p.end_date
  const planLines: Array<[string, string, string?]> = [
    ['Planned to spend this month', e(p.spendable_plan_cents)],
    ['Spent so far', `- ${e(free.spent_cents)}`],
    ['Fixed bills still to come', `- ${e(free.bills_cents)}`],
    ['Set aside this month', `- ${e(free.set_aside_cents)}`],
  ]
  const cashLines: Array<[string, string, string?]> = [
    ['Money in so far', e(free.money_in_cents)],
    ['Still expected in', `+ ${e(free.income_expected_cents)}`,
      free.income_expected.map(i => `${i.name}${i.next_date ? `, ${dayLabel(i.next_date)}` : ''}`).join(' · ') || undefined],
    ['Spent so far', `- ${e(free.spent_cents)}`],
  ]
  if (free.saved_cents > 0) cashLines.push(['Saved so far', `- ${e(free.saved_cents)}`])
  cashLines.push(
    ['Fixed bills still to come', `- ${e(free.bills_cents)}`],
    ['Set aside this month', `- ${e(free.set_aside_cents)}`],
    ['Still to save, as planned', `- ${e(free.to_save_cents)}`],
  )
  const gap = free.outside_plan_cents
  const days = free.days_ahead
  const from = p.data_through ? nextDay(p.data_through) : null
  return (
    <details className="ov-how">
      <summary>How this is worked out</summary>
      <div className="ledger">
        <h2>The plan</h2>
        <Sum lines={planLines} total={['Free in the plan', free.free_cents < 0 ? `${e(-free.free_cents)} over` : e(free.free_cents)]} />
        <p>
          {free.per_day_cents !== null
            ? <>{e(free.free_cents)} over {daysToPayday} days, today included = <b>{e(free.per_day_cents)}</b> a day.</>
            : <>The plan for this month is used up.</>}
        </p>
        {free.bills.length === 0 && free.set_asides.length === 0 && (
          <p className="muted">No fixed bills are still to come before {dayLabel(end)}, and nothing is set aside this month.</p>
        )}
        {free.bills.length > 0 && (
          <ul className="free-list" aria-label="Fixed bills still to come">
            {free.bills.map(bill => (
              <li key={bill.key}>
                <span>{bill.name}<small>{bill.next_date ? `due ${dayLabel(bill.next_date)}` : ''} · {bill.category_name}</small></span>
                <span className="num">{e(bill.amount_cents)}</span>
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
                <span className="num">{e(bill.monthly_cents)}</span>
              </li>
            ))}
          </ul>
        )}
        <h2>The account</h2>
        <Sum lines={cashLines} total={['Left in the account', eurosOrShort(free.cash_left_cents)]} />
        {gap !== 0 && (
          <p>{gap > 0
            ? <>That is {e(gap)} more than the plan: more money comes in this month than the plan spends and saves.</>
            : <>That is {e(-gap)} less than the plan: the plan spends and saves more than comes in this month.</>}</p>
        )}
        <h2>Average day</h2>
        {free.avg_day_cents !== null ? (
          <p>{e(free.avg_day_spent_cents!)} over {free.avg_day_days} ordinary days = <b>{e(free.avg_day_cents)}</b>. Only finished days count, and days with a payment of a tenth of the plan or more, like rent, are left out.</p>
        ) : (
          <p>Shows once five days of the month are over and have an ordinary day in them.</p>
        )}
        <h2>If it goes on</h2>
        {free.month_end_cents !== null && free.avg_day_cents !== null ? (
          <p>
            {eurosOrShort(free.cash_left_cents)} in the account, less {e(free.avg_day_cents)} for each of the {days} day{days === 1 ? '' : 's'}
            {from && days > 0 ? <> the bank files don't show yet ({from === end ? dayLabel(end) : `${dayLabel(from)} – ${dayLabel(end)}`})</> : null}
            {' '}= <b>{eurosOrShort(free.month_end_cents)}</b> left on {dayLabel(end)}.
          </p>
        ) : (
          <p>Needs the average day.</p>
        )}
      </div>
    </details>
  )
}

/** The headline: what is free until payday, or what the month came to, or why it can't be said yet. */
function Hero({ p }: { p: Pace }) {
  if (p.status === 'empty') {
    return (
      <div className="ov-hero-text">
        <h1 className="ov-unknown">No bank files yet</h1>
        <p className="ov-sub">Import a file from ING to see what is free to spend until payday.</p>
      </div>
    )
  }
  if (p.status === 'gap') {
    const last = p.last_import_by_bank.map(b => b.last_date).filter(Boolean).sort().pop()
    const current = p.month === p.current_month
    return (
      <div className="ov-hero-text">
        <h1 className="ov-unknown">Can't tell yet</h1>
        <p className="ov-sub">{current
          ? `The last bank file stops on ${dayLabel(last!)}, so this month has no payments in it yet.`
          : 'No bank files reach this month.'}</p>
      </div>
    )
  }
  if (p.spendable_plan_cents === 0) {
    return (
      <div className="ov-hero-text">
        <p className="ov-label">Spent this month</p>
        <h1 className="ov-figure"><Amount cents={p.spendable_actual_cents} count /></h1>
        <p className="ov-sub">No budget is set for this month yet. <Link to="/setup#budget">Set one in Plan</Link></p>
      </div>
    )
  }
  if (p.free) {
    const f = p.free
    const days = p.days_left! + 1
    const over = f.free_cents < 0
    const short = f.cash_left_cents < 0
    return (
      <div className="ov-hero-text">
        <div className="ov-pair">
          <div>
            <p className="ov-label">{over ? 'Over the plan' : 'Free in the plan'}</p>
            <h1 className={`ov-figure${over ? ' is-over' : ''}`}><Amount cents={f.free_cents} count /></h1>
            <p className="ov-sub">
              {over || f.per_day_cents === null ? 'The plan is used up' : `About ${formatEuros(f.per_day_cents)} a day`}
            </p>
          </div>
          <div>
            <p className="ov-label">{short ? 'Short in the account' : 'Left in the account'}</p>
            <p className={`ov-figure${short ? ' is-over' : ''}`}><Amount cents={f.cash_left_cents} count /></p>
            <p className="ov-sub">After bills and saving</p>
          </div>
        </div>
        <p className="ov-note">{days} day{days === 1 ? '' : 's'} to payday, today included.</p>
      </div>
    )
  }
  const over = p.spendable_actual_cents - p.spendable_plan_cents
  return (
    <div className="ov-hero-text">
      <p className="ov-label">{over > 0 ? 'Over the plan' : 'Under the plan'}</p>
      <h1 className={`ov-figure${over > 0 ? ' is-over' : ''}`}><Amount cents={over} count /></h1>
      <p className="ov-sub">Spent {formatEuros(p.spendable_actual_cents)} of {formatEuros(p.spendable_plan_cents)} planned.</p>
    </div>
  )
}

function GapToFill({ p }: { p: Pace }) {
  const { behind_months: behind } = p
  const range = behind.length > 1
    ? `${monthName(behind[0])} – ${monthName(behind[behind.length - 1])}`
    : behind.length === 1 ? monthName(behind[0]) : null
  return (
    <div className="ov-card gap-list">
      <h2>{range ? 'Gap to fill' : 'Bank data'}</h2>
      {range && <div><span>{range}</span><small>{behind.length} month{behind.length === 1 ? '' : 's'}</small></div>}
      {p.last_import_by_bank.map(b => (
        <div key={b.source}>
          <span>{b.source.toUpperCase()} bank data</span>
          <small>{b.last_date ? dayLabel(b.last_date) : 'no file yet'}</small>
        </div>
      ))}
    </div>
  )
}

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

  const income = summary?.total_income_cents ?? 0
  const kinds: KindFigures = {
    needs: { actual: p.actual_cents.needs, plan: p.plan_cents.needs, incomePct: income > 0 ? Math.round((p.actual_cents.needs / income) * 100) : null, aim: aims.needs },
    wants: { actual: p.actual_cents.wants, plan: p.plan_cents.wants, incomePct: income > 0 ? Math.round((p.actual_cents.wants / income) * 100) : null, aim: aims.wants },
    savings: { actual: p.actual_cents.savings, plan: p.plan_cents.savings, incomePct: income > 0 ? Math.round((p.actual_cents.savings / income) * 100) : null, aim: aims.savings },
  }

  const free = known && isCurrent ? p.free : null

  return (
    <>
      {actionError && <ErrorBanner message={actionError} onDismiss={() => setActionError('')} />}

      <div className="ov-bar">
        <span className="ov-period">{period}{p.day_number !== null && <span className="ov-day"> · day {p.day_number} of {p.days_total}</span>}</span>
        <div className="ov-nav">
          <button type="button" className="btn btn-icon" aria-label="Previous month" onClick={() => setPicked(shiftMonth(shownMonth, -1))}>
            <ChevronLeft size={18} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="btn btn-icon"
            aria-label="Next month"
            disabled={shownMonth === p.current_month}
            onClick={() => setPicked(shiftMonth(shownMonth, 1))}
          >
            <ChevronRight size={18} aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className={`ov${loadingMonth ? ' is-loading' : ''}`} aria-busy={loadingMonth}>
        <section className={`ov-hero${known ? '' : ' is-open'}`} aria-label="This month">
          <Hero p={p} />
          {known && p.day_number !== null && p.daily.length < p.day_number - 1 && p.data_through && (
            <p className="ov-note">Bank data runs to {dayLabel(p.data_through)}.</p>
          )}
          {known && <PaceLine key={month} pace={p} />}
          {!known && <Link to="/import" className="btn btn-primary ov-cta">Import a bank file</Link>}
          {free && <Ledger p={p} free={free} daysToPayday={p.days_left! + 1} />}
        </section>

        <div className="ov-side">
          {!known && isCurrent && <GapToFill p={p} />}
          {known && <NeedsYou pace={p} rows={rows} categories={categories} />}
          {free && <StillToPay free={free} />}
        </div>

        {known && rows.length > 0 && (
          <div className="ov-main">
            <Groups pace={p} rows={rows} categories={categories} payments={payments} elapsed={elapsed} />
          </div>
        )}

        <div className="ov-more">
          {rows.length > 0 && (
            <details className="ov-fold">
              <summary>Every category</summary>
              <Categories key={month} rows={rows} month={month} isCurrent={isCurrent} categories={categories} todayPct={known ? todayPct : null} kinds={known ? kinds : null} payments={payments} elapsed={known ? elapsed : null} onError={setActionError} />
            </details>
          )}
          <ReportLink month={month}>
            <RecurringLink month={month} />
          </ReportLink>
        </div>
      </div>
    </>
  )
}
