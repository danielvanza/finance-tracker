import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronLeft } from 'lucide-react'
import { dayLabel } from '../dates'
import type { Category, ReviewOption, ReviewTransaction, SplitInput } from '../types'
import { parseToCents, centsToInputString } from '../money'
import { Amount } from '../pages/overview/Amount'
import { merchantFor } from './merchants/merchantKey'
import CategorySelect from './CategorySelect'
import SplitEditor from './SplitEditor'
import { splitRowsValid, type SplitRow } from './splitRows'

export interface ReviewDecision {
  category_id?: number
  is_refund: boolean
  splits?: SplitInput[]
  remember?: boolean
}

type PositiveKind = 'income' | 'refund' | 'transfer'
/** Pick: the likely answers as one tap each. Other: any category. Split: parts. */
type Mode = 'pick' | 'other' | 'split'

interface Props {
  transaction: ReviewTransaction
  categories: Category[]
  /** Resolves once the answer is saved (or refused); the card stays until then. */
  onConfirm: (id: number, decision: ReviewDecision) => unknown
  onSkip: () => void
  /** Put focus on the first answer when the card appears (after the last one was answered). */
  focusFirst?: boolean
}

const KIND_META: Record<PositiveKind, { label: string; hint: string }> = {
  income:   { label: 'Income',   hint: 'Salary, interest, gifts: money the household gained.' },
  refund:   { label: 'Refund',   hint: 'Money back on an earlier expense: reduces that category.' },
  transfer: { label: 'Transfer', hint: "Between the household's own accounts: left out of totals." },
}

const KEYS = ['1', '2', '3']

/** Keys belong to the card only while nothing else is taking typing or holding focus in a dialog. */
function keyIsFree(e: KeyboardEvent) {
  if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return false
  const t = e.target as HTMLElement | null
  if (t?.closest('input, textarea, select, [contenteditable="true"], [role="listbox"], [role="combobox"]')) return false
  return !document.querySelector('[aria-modal="true"]')
}

/** The likely answers: what the server offers, or Claude's single guess when it offers none. */
function optionsOf(tx: ReviewTransaction): ReviewOption[] {
  if (tx.options && tx.options.length > 0) return tx.options
  if (tx.category_id != null && tx.category_name) {
    return [{ category_id: tx.category_id, label: tx.category_name, refund: tx.is_refund }]
  }
  return []
}

export default function ReviewCard({ transaction: tx, categories, onConfirm, onSkip, focusFirst = false }: Props) {
  const options = useMemo(() => optionsOf(tx), [tx])
  const [mode, setMode] = useState<Mode>(tx.splits.length > 0 ? 'split' : options.length > 0 ? 'pick' : 'other')
  const [chosen, setChosen] = useState<number | null>(null) // the option being saved
  const [busy, setBusy] = useState(false)
  const [remember, setRemember] = useState(false)
  const cardRef = useRef<HTMLDivElement>(null)
  const alive = useRef(true)
  useEffect(() => () => { alive.current = false }, [])

  useEffect(() => {
    if (!focusFirst) return
    cardRef.current?.querySelector<HTMLElement>('.rev-choice, .cs-trigger')?.focus({ preventScroll: true })
  }, [focusFirst])

  const isPositive = tx.amount_cents > 0
  const isAi = tx.categorised_by === 'ai'
  const shop = merchantFor(tx.description).name

  const initialKind: PositiveKind = useMemo(() => {
    if (tx.is_refund) return 'refund'
    const cat = categories.find(c => c.id === tx.category_id)
    if (cat?.type === 'exclude') return 'transfer'
    if (cat && cat.type !== 'income') return 'refund'
    return 'income'
  }, [tx, categories])
  const [kind, setKind] = useState<PositiveKind>(initialKind)

  const forKind = (k: PositiveKind) =>
    k === 'income' ? categories.filter(c => c.type === 'income')
      : k === 'transfer' ? categories.filter(c => c.type === 'exclude')
      : categories.filter(c => ['needs', 'wants', 'savings'].includes(c.type))
  const filteredCategories = useMemo(
    () => (isPositive ? forKind(kind) : categories.filter(c => c.type !== 'income')),
    [categories, isPositive, kind], // eslint-disable-line react-hooks/exhaustive-deps
  )

  const [selectedCategory, setSelectedCategory] = useState<number | null>(tx.category_id ?? (isPositive ? filteredCategories[0]?.id ?? null : null))
  const [splitRows, setSplitRows] = useState<SplitRow[]>(() =>
    tx.splits.length > 0
      ? tx.splits.map(s => ({ category_id: s.category_id, amount: centsToInputString(Math.abs(s.amount_cents)) }))
      : [{ category_id: null, amount: '' }, { category_id: null, amount: '' }]
  )

  const changeKind = (k: PositiveKind) => {
    if (k === kind) return
    setKind(k)
    setSelectedCategory(forKind(k)[0]?.id ?? null)
  }

  const answer = async (decision: ReviewDecision, option: number | null = null) => {
    if (busy) return
    setBusy(true)
    setChosen(option)
    try {
      await onConfirm(tx.id, decision)
    } catch {
      // The page says what went wrong; the card only has to be answerable again.
    } finally {
      // Saved: the next card replaces this one. Refused: the card is answerable again.
      if (alive.current) {
        setBusy(false)
        setChosen(null)
      }
    }
  }

  const pick = (i: number) => {
    const o = options[i]
    if (!o) return
    answer({ category_id: o.category_id, is_refund: o.refund, ...(remember && !o.refund ? { remember: true } : {}) }, i)
  }

  const isRefund = isPositive && kind === 'refund'
  const sign = isPositive ? 1 : -1
  const canConfirm = mode === 'split' ? splitRowsValid(splitRows, tx.amount_cents) : selectedCategory != null
  const confirmOther = () => {
    if (!canConfirm) return
    if (mode === 'split') {
      answer({ is_refund: isRefund, splits: splitRows.map(r => ({ category_id: r.category_id!, amount_cents: parseToCents(r.amount)! * sign })) })
    } else {
      answer({ category_id: selectedCategory ?? undefined, is_refund: isRefund, ...(remember && !isRefund ? { remember: true } : {}) })
    }
  }

  // 1–3 answer, S skips, while the choices are showing.
  const keys = useRef({ pick, onSkip, mode, busy })
  keys.current = { pick, onSkip, mode, busy }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = keys.current
      if (k.mode !== 'pick' || k.busy || !keyIsFree(e)) return
      const n = KEYS.indexOf(e.key)
      if (n >= 0 && n < options.length) {
        e.preventDefault()
        k.pick(n)
      } else if (e.key === 's' || e.key === 'S') {
        e.preventDefault()
        k.onSkip()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [options.length])

  const showRemember = mode !== 'split' && !(mode === 'other' && isRefund)

  return (
    <div className={`panel rev${busy ? ' is-saving' : ''}`} ref={cardRef}>
      <div className="rev-pay">
        <p className="rev-desc">{tx.description}</p>
        <p className={`rev-amount${isPositive ? ' is-in' : ''}`}>
          <span aria-hidden="true">{isPositive ? '+' : '−'}</span>
          <Amount cents={tx.amount_cents} />
        </p>
        <p className="rev-meta">
          <span className="num">{dayLabel(tx.date)}</span>
          <span>{tx.source.toUpperCase()}</span>
        </p>
      </div>

      {mode === 'pick' && (
        <>
          <p className="rev-ask" id={`rev-ask-${tx.id}`}>{isAi ? 'Claude wasn’t sure. Which is it?' : 'Which is it?'}</p>
          <div className="rev-choices" role="group" aria-labelledby={`rev-ask-${tx.id}`}>
            {options.map((o, i) => (
              <button
                key={`${o.category_id}-${o.refund}`}
                type="button"
                className={`rev-choice${i === 0 && isAi ? ' is-guess' : ''}${chosen === i ? ' is-chosen' : ''}`}
                aria-keyshortcuts={KEYS[i]}
                disabled={busy}
                onClick={() => pick(i)}
              >
                <span className="rev-choice-name">{o.label}</span>
                {i === 0 && isAi && <span className="rev-choice-note">Claude’s guess</span>}
                {chosen === i
                  ? <Check className="rev-choice-tick" size={18} aria-hidden="true" />
                  : <kbd className="rev-key" aria-hidden="true">{KEYS[i]}</kbd>}
              </button>
            ))}
          </div>
          <div className="rev-more">
            <button type="button" className="btn btn-sm" disabled={busy} onClick={() => setMode('other')}>Something else…</button>
            <button type="button" className="btn btn-sm" disabled={busy} onClick={() => setMode('split')}>Split</button>
            <button type="button" className="btn btn-sm" disabled={busy} onClick={onSkip} aria-keyshortcuts="S">Skip</button>
          </div>
        </>
      )}

      {mode !== 'pick' && (
        <div className="rev-decide">
          {mode === 'other' && isPositive && (
            <div className="form-row">
              <span className="lab">What is this money?</span>
              <div role="radiogroup" aria-label="Incoming money kind" className="seg seg-fill">
                {(Object.keys(KIND_META) as PositiveKind[]).map(k => (
                  <button key={k} type="button" role="radio" aria-checked={kind === k} onClick={() => changeKind(k)}>
                    {KIND_META[k].label}
                  </button>
                ))}
              </div>
              <p className="tx-hint">{KIND_META[kind].hint}</p>
            </div>
          )}

          <div className="form-row">
            <span className="lab">{mode === 'split' ? 'Split into parts' : 'Category'}</span>
            {mode === 'split' ? (
              <SplitEditor
                totalAmount={tx.amount_cents}
                categories={filteredCategories}
                rows={splitRows}
                onChange={setSplitRows}
                seededRefunds={tx.splits.map(s => s.is_refund)}
              />
            ) : (
              <CategorySelect categories={filteredCategories} value={selectedCategory} onChange={setSelectedCategory} />
            )}
          </div>

          <div className="rev-actions">
            <button type="button" className="btn btn-primary" onClick={confirmOther} disabled={!canConfirm || busy}>
              {mode === 'split' ? 'Confirm split' : isRefund ? 'Confirm refund' : 'Confirm category'}
            </button>
            {options.length > 0
              ? <button type="button" className="btn" onClick={() => setMode('pick')} disabled={busy}><ChevronLeft size={15} aria-hidden="true" />Back</button>
              : <button type="button" className="btn" onClick={onSkip} disabled={busy}>Skip</button>}
          </div>
        </div>
      )}

      {showRemember && (
        <label className="rev-remember">
          <input type="checkbox" role="switch" checked={remember} onChange={e => setRemember(e.target.checked)} />
          <span>Remember {shop} for next time</span>
        </label>
      )}
    </div>
  )
}
