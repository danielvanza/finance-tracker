import { useEffect, useState } from 'react'
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api'
import { centsToInputString, formatEuros, parseToCents } from '../money'
import { dayLabel } from '../dates'
import ErrorBanner, { describeApiError } from './ErrorBanner'
import { KINDS, aimsOf, averageSpend, lastMonthFill, planRows, shiftMonth } from './budget/plan'

type Fill = 'last' | 'avg'

const SAVED_MS = 6000

const monthWord = (label: string) =>
  new Date(`${label}-15T12:00:00`).toLocaleDateString('en-GB', { month: 'long' })

/**
 * Setup > Budget: plan a month (this one or the next) in one list, with the balance against the target split
 * live as you type. While anything is changed, the count and Save plan stay in view at the foot of the panel.
 */
export default function BudgetPlanner() {
  const qc = useQueryClient()
  const [drafts, setDrafts] = useState<Record<number, string>>({})
  const [filled, setFilled] = useState<Fill | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState('')
  const [error, setError] = useState('')
  const [ahead, setAhead] = useState(false)

  const paceQuery = useQuery({ queryKey: ['pace', 'current'], queryFn: () => api.getPace() })
  const pace = paceQuery.data
  const current = pace?.current_month
  const month = current ? (ahead ? shiftMonth(current, 1) : current) : undefined
  // The next month's dates come from the same endpoint Month reads any month with.
  const aheadQuery = useQuery({
    queryKey: ['pace', month],
    queryFn: () => api.getPace(month),
    enabled: ahead && Boolean(month),
  })
  const period = ahead ? aheadQuery.data : pace
  const last = month ? shiftMonth(month, -1) : ''
  // The three months before this one; a month still being imported is not history yet.
  const history = month ? [-1, -2, -3].map(k => shiftMonth(month, k)) : []
  const finished = history.filter(m => !pace?.behind_months.includes(m))
  // Planning ahead, last month is the one still running: nothing to compare with yet.
  const lastFinished = !ahead && finished.includes(last)

  const { data: categories = [] } = useQuery({ queryKey: ['categories'], queryFn: api.getCategories })
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: api.getSettings })
  const aims = aimsOf(settings?.target_split)
  const budgets = useQueries({
    queries: (month ? [month, ...history] : []).map(m => ({
      queryKey: ['budget', m], queryFn: () => api.getBudget(m),
    })),
  })
  const incomeQuery = useQuery({
    queryKey: ['dashboard', last],
    queryFn: () => api.getDashboard(last),
    enabled: Boolean(month) && lastFinished,
  })

  useEffect(() => {
    if (!saved) return
    const timer = window.setTimeout(() => setSaved(''), SAVED_MS)
    return () => window.clearTimeout(timer)
  }, [saved])

  const failed = paceQuery.error ?? (ahead ? aheadQuery.error : null) ?? budgets.find(b => b.isError)?.error
  if (failed) return <Shell bare><ErrorBanner message={describeApiError(failed)} /></Shell>
  if (!pace || !month) {
    return <Shell bare><span className="skeleton setup-skeleton" aria-busy="true" aria-label="Loading the budget" /></Shell>
  }

  // Moving to the other month keeps the page (and the focus on the choice) while its rows arrive.
  const loaded = budgets.length > 0 && budgets.every(b => b.data) && Boolean(period)
  const [thisBudget = [], ...past] = loaded ? budgets.map(b => b.data!) : []
  const rows = planRows(thisBudget, categories)
  const lastBudget = past[0] ?? []
  const finishedBudgets = past.filter((_, i) => finished.includes(history[i]))
  const lastFill = lastMonthFill(rows, lastBudget)
  const averages = averageSpend(rows, finishedBudgets)
  const income = lastFinished ? incomeQuery.data?.total_income_cents ?? null : null

  const valueOf = (id: number, savedCents: number) => {
    const raw = drafts[id]
    if (raw === undefined) return savedCents
    const v = parseToCents(raw)
    return v === null || v < 0 ? null : v
  }
  const values = rows.map(r => ({ r, v: valueOf(r.id, r.savedCents) }))
  const invalid = values.some(x => x.v === null)
  const changed = values.filter(x => x.v !== null && x.v !== x.r.savedCents)
  const dirty = changed.length > 0
  const touched = dirty || invalid
  const net = changed.reduce((s, x) => s + x.v! - x.r.savedCents, 0)
  const kindTotal = (k: string) => values.filter(x => x.r.kind === k).reduce((s, x) => s + (x.v ?? x.r.savedCents), 0)
  const total = KINDS.reduce((s, k) => s + kindTotal(k.kind), 0)

  const edit = (id: number, raw: string) => {
    setDrafts(d => ({ ...d, [id]: raw }))
    setFilled(null)
    setSaved('')
  }
  const fill = (mode: Fill, source: Map<number, number>) => {
    // A fill only moves the fields; nothing is stored until Save plan.
    const next: Record<number, string> = {}
    for (const r of rows) {
      const v = source.get(r.id)
      if (v !== undefined && v !== r.savedCents) next[r.id] = centsToInputString(v)
    }
    setDrafts(next)
    setFilled(mode)
    setSaved('')
    setError('')
  }
  const undo = () => { setDrafts({}); setFilled(null); setError('') }
  const planFor = (toNext: boolean) => {
    if (toNext === ahead) return
    setAhead(toNext)
    setDrafts({})
    setFilled(null)
    setSaved('')
    setError('')
  }

  const save = async () => {
    setSaving(true)
    setError('')
    const results = await Promise.allSettled(changed.map(x => api.patchBudget(x.r.id, x.v!)))
    setSaving(false)
    const rejected = results.find(r => r.status === 'rejected') as PromiseRejectedResult | undefined
    qc.invalidateQueries({ queryKey: ['budget'] })
    qc.invalidateQueries({ queryKey: ['dashboard'] })
    qc.invalidateQueries({ queryKey: ['pace'] })
    if (rejected) { setError(describeApiError(rejected.reason)); return }
    // A change carries on into later months until one holds another amount; say how far it went.
    const months = results.reduce((most, r) => Math.max(most, r.status === 'fulfilled'
      ? (r.value as { months_changed?: number } | undefined)?.months_changed ?? 0 : 0), 0)
    setDrafts({})
    setFilled(null)
    setSaved(months > 1 ? `Saved for ${months} months` : months === 1 ? `Saved for ${monthWord(month)}` : 'Saved')
  }

  const diff = total - (income ?? 0)
  const avgMonths = finishedBudgets.filter(m => m.some(b => (b.actual_amount_cents ?? 0) !== 0)).length
  const hasIncome = income !== null && income > 0
  const invalidCount = values.filter(x => x.v === null).length
  const barred = touched || Boolean(saved)
  const gap = formatEuros(net) === '€0' ? 'no net change' : `${formatEuros(Math.abs(net))} ${net > 0 ? 'more' : 'less'}`

  return (
    <Shell>
      <p className="setup-note">
        {monthWord(month)} plan{period ? `, ${dayLabel(period.start_date)} to ${dayLabel(period.end_date)}` : ''}
        {ahead ? ', not started yet' : ''}. Fill from history, then change what you like.
        A changed amount stays for the months after {monthWord(month)} too; earlier months keep theirs.
      </p>

      {loaded && <div className="bud-balance">
        {hasIncome ? (
          <p className="bud-head">
            <strong className="num">{formatEuros(Math.abs(diff))}</strong>
            <span>{diff > 0 ? 'more planned than income' : 'left to plan'}</span>
            <span>Plan against {formatEuros(income)} income last month</span>
          </p>
        ) : (
          <p className="bud-head">
            <strong className="num">{formatEuros(total)}</strong>
            <span>planned</span>
            <span>
              {lastFinished
                ? "No income was recorded last month, so there's nothing to compare the plan with."
                : ahead
                  ? `${monthWord(last)} isn't finished yet, so there's no income to compare the plan with.`
                  : "Last month isn't fully imported yet, so there's no income to compare the plan with."}
            </span>
          </p>
        )}
        {hasIncome && (
          <>
            <ul className="bud-shares">
              {KINDS.map(k => {
                const pct = Math.round(kindTotal(k.kind) / income * 100)
                return (
                  <li key={k.kind}>
                    <span className="lab">{k.label}</span>
                    <span className="num">{pct}%<small> of income, aim {aims[k.kind]}%</small></span>
                    <span className="meter" aria-hidden="true">
                      <i style={{ width: `${Math.min(100, pct)}%` }} />
                      <b style={{ left: `${aims[k.kind]}%` }} />
                    </span>
                  </li>
                )
              })}
            </ul>
            <p className="bud-key">The tick marks your target split, {aims.needs}/{aims.wants}/{aims.savings}.</p>
          </>
        )}
      </div>}

      <div className="bud-options">
        <div className="bud-fill">
          <span className="lab" id="plan-for-label">Plan for</span>
          <div className="seg" role="group" aria-labelledby="plan-for-label">
            {[false, true].map(toNext => (
              <button key={String(toNext)} type="button" aria-pressed={ahead === toNext}
                disabled={ahead !== toNext && (touched || saving)} onClick={() => planFor(toNext)}>
                {monthWord(toNext ? shiftMonth(current!, 1) : current!)}
              </button>
            ))}
          </div>
        </div>
        {touched && <p className="bud-key">Save or undo to plan another month.</p>}
        <div className="bud-fill">
          <span className="lab" id="fill-from-label">Fill from</span>
          <div className="seg" role="group" aria-labelledby="fill-from-label">
            <button type="button" aria-pressed={filled === 'last'} disabled={lastFill.size === 0}
              onClick={() => fill('last', lastFill)}>
              {ahead ? `${monthWord(last)}'s plan` : "Last month's plan"}
            </button>
            <button type="button" aria-pressed={filled === 'avg'} disabled={avgMonths === 0}
              onClick={() => fill('avg', averages)}>
              {avgMonths > 0 ? `${avgMonths}-month average` : 'Average'}
            </button>
          </div>
        </div>
      </div>
      {loaded && avgMonths === 0 && <p className="bud-key">No finished month with spending to average yet.</p>}

      {!loaded && <span className="skeleton setup-skeleton" aria-busy="true" aria-label={`Loading the ${monthWord(month)} plan`} />}
      {loaded && rows.length === 0 && <p className="empty">No categories to plan yet.</p>}
      {loaded && KINDS.map(k => {
        const group = values.filter(x => x.r.kind === k.kind)
        if (group.length === 0) return null
        return (
          <div className="bud-group" key={k.kind}>
            <h3>{k.label}</h3>
            <ul>
              {group.map(({ r, v }) => {
                const avg = averages.get(r.id)
                const was = v !== null && v !== r.savedCents ? `was ${formatEuros(r.savedCents)}` : ''
                const note = avg !== undefined ? `averages ${formatEuros(avg)}` : ''
                return (
                  <li className="bud-row" key={r.id}>
                    <label className="bud-name" htmlFor={`plan-${r.id}`}>
                      {r.name}
                      {(was || note) && <small>{[was, note].filter(Boolean).join(' · ')}</small>}
                    </label>
                    <input
                      id={`plan-${r.id}`}
                      className="field field-num"
                      inputMode="decimal"
                      aria-label={`${r.name} planned amount`}
                      aria-invalid={v === null || undefined}
                      value={drafts[r.id] ?? centsToInputString(r.savedCents)}
                      onChange={e => edit(r.id, e.target.value)}
                    />
                  </li>
                )
              })}
            </ul>
          </div>
        )
      })}

      {error && <p role="alert" className="setup-error">{error}</p>}
      {loaded && (
        <div className={`bud-actions${barred ? ' is-bar' : ''}`}>
          {touched && (
            <p className="bud-sum">
              <b>{invalid
                ? `${invalidCount} amount${invalidCount === 1 ? '' : 's'} to fix`
                : `${changed.length} change${changed.length === 1 ? '' : 's'}`}</b>
              <small>{invalid ? `${monthWord(month)} plan` : `${gap}, ${monthWord(month)} plan`}</small>
            </p>
          )}
          <span className="setup-saved" role="status">{saved}</span>
          <button type="button" className={`btn${dirty ? ' btn-primary' : ''}`}
            disabled={!dirty || invalid || saving} onClick={save}>
            {saving ? 'Saving…' : 'Save plan'}
          </button>
          {touched && <button type="button" className="btn" onClick={undo} disabled={saving}>Undo</button>}
        </div>
      )}
    </Shell>
  )
}

function Shell({ children, bare }: { children: React.ReactNode; bare?: boolean }) {
  return (
    <section className="section">
      <h2>Budget</h2>
      {bare ? children : <div className="panel setup-panel">{children}</div>}
    </section>
  )
}
