import { useMemo, useState } from 'react'
import { dayLabel } from '../dates'
import { Sparkles } from 'lucide-react'
import type { Transaction, Category, SplitInput } from '../types'
import { formatCents, parseToCents, centsToInputString } from '../money'
import CategorySelect from './CategorySelect'
import SplitEditor, { splitRowsValid, type SplitRow } from './SplitEditor'

export interface ReviewDecision {
  category_id?: number
  is_refund: boolean
  splits?: SplitInput[]
  remember?: boolean
}

type PositiveKind = 'income' | 'refund' | 'transfer'

interface Props {
  transaction: Transaction
  categories: Category[]
  onConfirm: (id: number, decision: ReviewDecision) => void
  onSkip: () => void
}

const KIND_META: Record<PositiveKind, { label: string; hint: string }> = {
  income:   { label: 'Income',   hint: 'Salary, interest, gifts: money the household gained.' },
  refund:   { label: 'Refund',   hint: 'Money back on an earlier expense: reduces that category.' },
  transfer: { label: 'Transfer', hint: "Between the household's own accounts: left out of totals." },
}

export default function ReviewCard({ transaction: tx, categories, onConfirm, onSkip }: Props) {
  const isPositive = tx.amount_cents > 0

  const initialKind: PositiveKind = useMemo(() => {
    if (tx.is_refund) return 'refund'
    const cat = categories.find(c => c.id === tx.category_id)
    if (cat?.type === 'exclude') return 'transfer'
    if (cat && cat.type !== 'income') return 'refund'
    return 'income'
  }, [tx, categories])

  const [kind, setKind] = useState<PositiveKind>(initialKind)

  const filteredCategories = useMemo(() => {
    if (!isPositive) {
      return categories.filter(c => c.type === 'exclude' || c.type !== 'income')
    }
    if (kind === 'income') return categories.filter(c => c.type === 'income')
    if (kind === 'transfer') return categories.filter(c => c.type === 'exclude')
    return categories.filter(c => ['needs', 'wants', 'savings'].includes(c.type))
  }, [categories, isPositive, kind])

  const [selectedCategory, setSelectedCategory] = useState<number | null>(tx.category_id ?? (isPositive ? filteredCategories[0]?.id ?? null : null))
  const [splitMode, setSplitMode] = useState(tx.splits.length > 0)
  const [remember, setRemember] = useState(false)
  const [splitRows, setSplitRows] = useState<SplitRow[]>(() =>
    tx.splits.length > 0
      ? tx.splits.map(s => ({ category_id: s.category_id, amount: centsToInputString(Math.abs(s.amount_cents)) }))
      : [{ category_id: null, amount: '' }, { category_id: null, amount: '' }]
  )

  const changeKind = (k: PositiveKind) => {
    if (k === kind) return
    setKind(k)
    const next = isPositive
      ? (k === 'income' ? categories.filter(c => c.type === 'income')
        : k === 'transfer' ? categories.filter(c => c.type === 'exclude')
        : categories.filter(c => ['needs', 'wants', 'savings'].includes(c.type)))
      : filteredCategories
    setSelectedCategory(next[0]?.id ?? null)
  }

  const isRefund = isPositive && kind === 'refund'
  const sign = isPositive ? 1 : -1
  const splitsPayload: SplitInput[] = splitRows.map(r => ({
    category_id: r.category_id!,
    amount_cents: parseToCents(r.amount)! * sign,
  }))
  const canConfirm = splitMode
    ? splitRowsValid(splitRows, tx.amount_cents)
    : selectedCategory != null

  const handleConfirm = () => {
    if (!canConfirm) return
    if (splitMode) {
      onConfirm(tx.id, { is_refund: isRefund, splits: splitsPayload })
    } else {
      onConfirm(tx.id, { category_id: selectedCategory ?? undefined, is_refund: isRefund, ...(remember && !isRefund ? { remember: true } : {}) })
    }
  }

  const isExpense = tx.amount_cents < 0

  return (
    <div className="panel rev">
      <div className="rev-facts">
        <div className="rev-head">
          <div className="rev-title">
            <p className="rev-desc">{tx.description}</p>
            <p className="rev-meta">
              <span className="num">{dayLabel(tx.date)}</span>
              <span className="lab">{tx.source}</span>
            </p>
          </div>
          <p className={`rev-amount num${isExpense ? '' : ' is-in'}`}>
            {isExpense ? '-' : '+'}{formatCents(Math.abs(tx.amount_cents))}
          </p>
        </div>

        {tx.categorised_by === 'ai' && tx.category_name && (
          <div className="well rev-guess">
            <Sparkles size={14} aria-hidden="true" />
            <span className="rev-guess-text">Claude was not sure. Its guess: <strong>{tx.category_name}</strong></span>
          </div>
        )}
      </div>

      <div className="rev-decide">
        {/* Incoming money: income vs refund vs transfer */}
        {isPositive && (
          <div className="form-row">
            <span className="lab">What is this money?</span>
            <div role="radiogroup" aria-label="Incoming money kind" className="seg seg-fill">
              {(Object.keys(KIND_META) as PositiveKind[]).map(k => (
                <button
                  key={k}
                  type="button"
                  role="radio"
                  aria-checked={kind === k}
                  onClick={() => changeKind(k)}
                >
                  {KIND_META[k].label}
                </button>
              ))}
            </div>
            <p className="tx-hint">{KIND_META[kind].hint}</p>
          </div>
        )}

        <div className="form-row">
          <div className="rev-field-head">
            <span className="lab">{splitMode ? 'Split into parts' : 'Category'}</span>
            {(!isPositive || kind !== 'transfer') && (
              <button type="button" className="btn btn-sm" onClick={() => setSplitMode(m => !m)}>
                {splitMode ? 'Single category' : 'Split…'}
              </button>
            )}
          </div>
          {splitMode ? (
            <SplitEditor
              totalAmount={tx.amount_cents}
              categories={filteredCategories}
              rows={splitRows}
              onChange={setSplitRows}
              seededRefunds={tx.splits.map(s => s.is_refund)}
            />
          ) : (
            <CategorySelect
              categories={filteredCategories}
              value={selectedCategory}
              onChange={setSelectedCategory}
            />
          )}
        </div>

        <div className="rev-actions">
          <button type="button" className="btn btn-primary" onClick={handleConfirm} disabled={!canConfirm}>
            {splitMode ? 'Confirm split' : isRefund ? 'Confirm refund' : 'Confirm category'}
          </button>
          <button type="button" className="btn" onClick={onSkip}>Skip</button>
        </div>

        {!splitMode && !isRefund && (
          <>
            <label className="rev-remember">
              <input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)} />
              <span>Remember this shop for next time</span>
            </label>
            <p className="tx-hint">This shop's other waiting payments follow your answer either way.</p>
          </>
        )}
      </div>
    </div>
  )
}
