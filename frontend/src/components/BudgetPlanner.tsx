import { useState } from 'react'
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api'
import { centsToInputString, formatEuros, parseToCents } from '../money'
import { dayLabel } from '../dates'
import ErrorBanner, { describeApiError } from './ErrorBanner'
import { KINDS, averageSpend, lastMonthFill, planRows, shiftMonth } from './budget/plan'

type Fill = 'last' | 'avg'

const monthWord = (label: string) =>
  new Date(`${label}-15T12:00:00`).toLocaleDateString('en-GB', { month: 'long' })

/** Setup > Budget: plan the whole month in one list, with the 50/30/20 balance live as you type. */
export default function BudgetPlanner() {
  const qc = useQueryClient()
  const [drafts, setDrafts] = useState<Record<number, string>>({})
  const [filled, setFilled] = useState<Fill | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  const paceQuery = useQuery({ queryKey: ['pace', 'current'], queryFn: () => api.getPace() })
  const pace = paceQuery.data
  const month = pace?.current_month
  const last = month ? shiftMonth(month, -1) : ''
  // The three months before this one; a month still being imported is not history yet.
  const history = month ? [-1, -2, -3].map(k => shiftMonth(month, k)) : []
  const finished = history.filter(m => !pace?.behind_months.includes(m))
  const lastFinished = finished.includes(last)

  const { data: categories = [] } = useQuery({ queryKey: ['categories'], queryFn: api.getCategories })
  const { data: adjustments = [] } = useQuery({ queryKey: ['standing-adjustments'], queryFn: api.getStandingAdjustments })
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

  const failed = paceQuery.error ?? budgets.find(b => b.isError)?.error
  if (failed) return <Shell bare><ErrorBanner message={describeApiError(failed)} /></Shell>
  if (!pace || !month || budgets.length === 0 || budgets.some(b => !b.data)) {
    return <Shell bare><span className="skeleton setup-skeleton" aria-busy="true" aria-label="Loading the budget" /></Shell>
  }

  const [thisBudget, ...past] = budgets.map(b => b.data!)
  const rows = planRows(thisBudget, categories)
  const lastBudget = past[0]
  const finishedBudgets = past.filter((_, i) => finished.includes(history[i]))
  const skip = new Set(adjustments.map(a => a.expense_category_id))
  const lastFill = lastMonthFill(rows, lastBudget)
  const averages = averageSpend(rows, finishedBudgets, skip)
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
  const kindTotal = (k: string) => values.filter(x => x.r.kind === k).reduce((s, x) => s + (x.v ?? x.r.savedCents), 0)
  const total = KINDS.reduce((s, k) => s + kindTotal(k.kind), 0)

  const edit = (id: number, raw: string) => {
    setDrafts(d => ({ ...d, [id]: raw }))
    setFilled(null)
    setSaved(false)
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
    setSaved(false)
    setError('')
  }
  const undo = () => { setDrafts({}); setFilled(null); setError('') }

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
    setDrafts({})
    setFilled(null)
    setSaved(true)
  }

  const diff = total - (income ?? 0)
  const avgMonths = finishedBudgets.filter(m => m.some(b => (b.actual_amount_cents ?? 0) !== 0)).length
  const hasIncome = income !== null && income > 0

  return (
    <Shell>
      <p className="setup-note">
        {monthWord(month)} plan, {dayLabel(pace.start_date)} to {dayLabel(pace.end_date)}. Fill from history, then change what you like.
      </p>

      <div className="bud-balance">
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
                    <span className="num">{pct}%<small> of income, aim {k.aim}%</small></span>
                    <span className="meter" aria-hidden="true">
                      <i style={{ width: `${Math.min(100, pct)}%` }} />
                      <b style={{ left: `${k.aim}%` }} />
                    </span>
                  </li>
                )
              })}
            </ul>
            <p className="bud-key">The tick marks the 50/30/20 aim.</p>
          </>
        )}
      </div>

      <div className="bud-fill">
        <span className="lab">Fill from</span>
        <div className="seg">
          <button type="button" aria-pressed={filled === 'last'} disabled={lastFill.size === 0}
            onClick={() => fill('last', lastFill)}>
            Last month's plan
          </button>
          <button type="button" aria-pressed={filled === 'avg'} disabled={avgMonths === 0}
            onClick={() => fill('avg', averages)}>
            {avgMonths > 0 ? `${avgMonths}-month average` : 'Average'}
          </button>
        </div>
      </div>
      {avgMonths === 0 && <p className="bud-key">No finished month with spending to average yet.</p>}

      {rows.length === 0 && <p className="empty">No categories to plan yet.</p>}
      {KINDS.map(k => {
        const group = values.filter(x => x.r.kind === k.kind)
        if (group.length === 0) return null
        return (
          <div className="bud-group" key={k.kind}>
            <h3>{k.label}</h3>
            <ul>
              {group.map(({ r, v }) => {
                const avg = averages.get(r.id)
                const was = v !== null && v !== r.savedCents ? `was ${formatEuros(r.savedCents)}` : ''
                const note = skip.has(r.categoryId) && avgMonths > 0
                  ? 'standing adjustment, not averaged'
                  : avg !== undefined ? `averages ${formatEuros(avg)}` : ''
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
      <div className="bud-actions">
        <button type="button" className={`btn${dirty ? ' btn-primary' : ''}`}
          disabled={!dirty || invalid || saving} onClick={save}>
          {saving ? 'Saving…' : 'Save plan'}
        </button>
        {(dirty || invalid) && <button type="button" className="btn" onClick={undo} disabled={saving}>Undo</button>}
        {saved && <span className="setup-saved" role="status">Saved</span>}
      </div>
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
