import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { X } from 'lucide-react'
import { api } from '../../api'
import { dayLabel } from '../../dates'
import { formatCents, formatEuros } from '../../money'
import type { Transaction } from '../../types'
import CategorySelect from '../CategorySelect'
import ErrorBanner, { describeApiError } from '../ErrorBanner'
import { createMerchantRule } from './api'
import { buildMerchantModel, coveringRule, DEFAULT_START_DAY, labelForDate, monthName } from './merchantData'
import { ruleKeyOk } from './merchantKey'
import '../../styles/merchants.css'

const FIRST = 6
const STEP = 20

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
const money = (tx: Transaction) => `${tx.amount_cents > 0 ? '+' : ''}${formatCents(Math.abs(tx.amount_cents))}`

/** What this shop costs and a single rule for it. Open it through MerchantSheetProvider. */
export default function MerchantSheet({ merchantKey, name, onClose }: { merchantKey: string; name?: string; onClose: () => void }) {
  const qc = useQueryClient()
  const sheetRef = useRef<HTMLDivElement>(null)
  const transactions = useQuery({ queryKey: ['transactions', 'all'], queryFn: () => api.getTransactions() })
  const categories = useQuery({ queryKey: ['categories'], queryFn: api.getCategories })
  const pace = useQuery({ queryKey: ['pace', 'current'], queryFn: () => api.getPace() })
  const settings = useQuery({ queryKey: ['settings'], queryFn: api.getSettings })
  const rules = useQuery({ queryKey: ['rules'], queryFn: api.getRules })

  const [picked, setPicked] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState('')
  const [shown, setShown] = useState(FIRST)

  // Modal for real: the page behind can neither take focus nor scroll, Tab wraps inside the sheet,
  // and on close everything is put back before focus returns to the row that opened it.
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null
    const sheet = sheetRef.current
    const root = document.getElementById('root')
    const html = document.documentElement
    const wasInert = root?.hasAttribute('inert') ?? false
    const overflow = html.style.overflow
    sheet?.focus()
    root?.setAttribute('inert', '')
    html.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) onClose()
      if (e.key !== 'Tab' || !sheet) return
      const active = document.activeElement
      if (active !== sheet && !sheet.contains(active)) return // a picker open beside the sheet
      const stops = [...sheet.querySelectorAll<HTMLElement>('a[href], button:not(:disabled), select, input:not(:disabled), [tabindex]:not([tabindex="-1"])')]
      const wrapTo = e.shiftKey
        ? (active === sheet || active === stops[0] ? stops[stops.length - 1] : null)
        : (active === stops[stops.length - 1] ? stops[0] : null)
      if (wrapTo) {
        e.preventDefault()
        wrapTo.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      if (root && !wasInert) root.removeAttribute('inert')
      html.style.overflow = overflow
      before?.focus?.()
    }
  }, [onClose])

  const failed = [transactions, categories, pace, settings, rules].find(q => q.error)
  const ready = transactions.data && categories.data && pace.data && settings.data && rules.data

  const startDay = Number(settings.data?.financial_month_start_day)
    || Number(pace.data?.start_date.slice(8)) || DEFAULT_START_DAY
  const model = ready
    ? buildMerchantModel({
        key: merchantKey,
        transactions: transactions.data!,
        categories: categories.data!,
        currentMonth: pace.data!.current_month,
        behindMonths: pace.data!.behind_months,
        startDay,
      })
    : null

  const head = (title: string) => (
    <div className="tx-sheet-head">
      <h2 id="mer-title">{title}</h2>
      <button type="button" className="tx-close" aria-label="Close" onClick={onClose}><X size={18} aria-hidden="true" /></button>
    </div>
  )

  const body = () => {
    if (failed) return <ErrorBanner title="The shop didn't load" message={describeApiError(failed.error)} />
    if (!model) return <span className="skeleton mer-skel" aria-busy="true" aria-label="Loading" />
    if (model.history.length === 0) return <p className="mer-sentence">No purchases found under this name.</p>

    const rule = coveringRule(model.key, rules.data!)
    const chosen = picked ?? model.topCategoryId
    const mixed = model.categories.length > 1
    const maxCents = Math.max(...model.months.map(m => m.cents), 1)
    const one = model.history.length === 1
    const raws = model.raws
    const waiting = model.waiting.length
    const waitingText = waiting > 0 ? ` ${plural(waiting, 'purchase')} waiting for review settles now.` : ''
    const top = model.categories[0]
    const choices = categories.data!.filter(c => c.type !== 'income')
    const tooShort = !ruleKeyOk(model.key)

    const setRule = async () => {
      if (chosen === null || saving) return
      setSaving(true)
      setError('')
      setSaved('')
      try {
        const result = await createMerchantRule(model.key, chosen, transactions.data!)
        setSaved(
          result.failed > 0
            ? `Rule saved. ${plural(result.failed, 'waiting purchase')} could not be settled; they are still in review.`
            : result.settled > 0 ? `Rule saved. ${plural(result.settled, 'waiting purchase')} settled.` : 'Rule saved.',
        )
      } catch (e) {
        setError(describeApiError(e))
      } finally {
        setSaving(false)
        for (const k of ['transactions', 'review', 'rules', 'pace', 'budget', 'dashboard']) qc.invalidateQueries({ queryKey: [k] })
      }
    }

    const monthRow = (label: string) => {
      const m = model.byMonth[label] ?? { cents: 0, purchases: 0 }
      return (
        <div className="mer-month" key={`m-${label}`}>
          <h3 className="lab">{monthName(label, true, !model.months.some(w => w.label === label))}</h3>
          <span className="lab num">{plural(m.purchases, 'purchase')} · {formatEuros(Math.max(m.cents, 0))}</span>
        </div>
      )
    }

    const list = model.history.slice(0, shown)
    let current = ''
    const history = list.flatMap(tx => {
      const label = labelForDate(tx.date, startDay)
      const out = []
      if (label !== current) {
        current = label
        out.push(monthRow(label))
      }
      out.push(
        <div className="mer-tx" key={tx.id}>
          <time dateTime={tx.date}>{dayLabel(tx.date)}</time>
          <div>
            <span className="mer-tx-raw">{tx.description}</span>
            {(mixed || !tx.category_name) && tx.splits.length === 0 && (
              <span className="mer-tx-cat">{tx.category_name ?? (tx.amount_cents < 0 ? 'Not sorted yet' : '')}</span>
            )}
            {tx.splits.length > 0 && <span className="mer-tx-cat">Split: {tx.splits.map(s => s.category_name ?? '—').join(', ')}</span>}
          </div>
          <span className="num">{money(tx)}</span>
        </div>,
      )
      return out
    })

    return (
      <>
        <p className="mer-seen">
          Bank writes it as <span>{raws[0]}</span>
          {raws.length > 1 && <> and {raws.length - 1} other {raws.length === 2 ? 'way' : 'ways'}</>}
        </p>

        {one ? (
          <div className="mer-figures">
            <strong className="num">{formatCents(Math.abs(model.history[0].amount_cents))}</strong>
            <span>One {model.history[0].amount_cents > 0 ? 'payment' : 'purchase'}, {dayLabel(model.history[0].date)}</span>
          </div>
        ) : model.windowPurchases === 0 ? (
          <div className="mer-figures">
            <span>Nothing spent in the last 6 months. {plural(model.history.length, 'earlier payment')}.</span>
          </div>
        ) : (
          <div className="mer-figures">
            <strong className="num">{formatEuros(model.windowCents)}</strong>
            <span>
              over 6 months, {plural(model.windowPurchases, 'purchase')}.
              {model.months.some(m => m.partial) && ' Dashed months are not complete yet.'}
            </span>
          </div>
        )}

        {!one && (
          <div className="mer-bars" role="group" aria-label="Spend by financial month">
            {model.months.map(m => (
              <div className={`mer-col${m.partial ? ' is-partial' : ''}`} key={m.label}>
                <span className="mer-amt num">{m.cents > 0 ? formatEuros(m.cents) : '–'}</span>
                <span className="mer-track">
                  {m.cents > 0 && !m.noData && <i style={{ height: `${Math.max(4, Math.round((m.cents / maxCents) * 100))}%` }} />}
                </span>
                <span className="lab">{m.short}</span>
                {m.cents === 0 && <span className="mer-sr">{m.noData ? 'no bank data yet' : 'nothing spent'}</span>}
              </div>
            ))}
          </div>
        )}

        {mixed && (
          <div className="mer-cats">
            <span className="lab">Sorted as</span>
            <div className="tx-splits">
              {model.categories.map(c => <span className="tx-chip" key={c.id}>{c.name} <span className="num">{c.count}</span></span>)}
            </div>
          </div>
        )}

        {rule ? (
          <div className="well mer-rule" role="group" aria-label="Rule">
            <span className="lab">Rule</span>
            <p className="mer-rule-text">Anything with “{rule.pattern}” goes to <strong>{rule.category_name}</strong>.</p>
            {saved && <p className="tx-hint" role="status">{saved}</p>}
            <div className="mer-rule-row"><Link className="btn" to="/setup" onClick={onClose}>Change in Setup</Link></div>
          </div>
        ) : (
          <div className="well mer-rule" role="group" aria-label="Rule">
            <span className="lab">Always categorise as</span>
            <div className="mer-rule-row">
              <CategorySelect categories={choices} value={chosen} onChange={setPicked} compact />
              <button
                type="button"
                className={`btn${mixed || tooShort ? '' : ' btn-primary'}`}
                disabled={chosen === null || tooShort || saving}
                onClick={setRule}
              >
                {saving ? 'Saving…' : 'Set rule'}
              </button>
            </div>
            <p className="tx-hint">
              {tooShort
                ? `“${model.key}” is too short to match safely: it would catch other shops.`
                : mixed
                  ? `Sorted ${model.categories.length} ways so far, most often ${top.name} (${top.count} of ${model.categories.reduce((a, c) => a + c.count, 0) + model.unsorted}). A rule sorts new ${model.name} purchases there; past ones stay.${waitingText}`
                  : `Matches “${model.key}” in any description. ${one ? 'Next time it shows up it sorts itself.' : 'Past purchases stay as they are; new ones sort themselves.'}${waitingText}`}
            </p>
            {saved && <p className="tx-hint" role="status">{saved}</p>}
            {error && <p role="alert" className="mer-error">{error}</p>}
          </div>
        )}

        <section className="mer-hist" aria-label="History">
          {history}
          {model.history.length > shown && (
            <button type="button" className="btn btn-wide tx-more" onClick={() => setShown(n => n + STEP)}>
              Show {Math.min(STEP, model.history.length - shown)} more of {model.history.length - shown}
            </button>
          )}
        </section>
      </>
    )
  }

  return createPortal(
    <div className="scrim" onClick={onClose}>
      <div
        ref={sheetRef}
        className="sheet mer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="mer-title"
        tabIndex={-1}
        onClick={e => e.stopPropagation()}
      >
        {head(model?.name ?? name ?? merchantKey)}
        {body()}
      </div>
    </div>,
    document.body,
  )
}
