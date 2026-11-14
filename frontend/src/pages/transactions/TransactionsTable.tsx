import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { dayLabel } from '../../dates'
import { Check, ChevronDown, CircleAlert } from 'lucide-react'
import { formatCents } from '../../money'
import type { Category, Transaction } from '../../types'
import CategorySelect from '../../components/CategorySelect'
import { MerchantName, useMerchantSheet } from '../../components/merchants'

interface TransactionsTableProps {
  transactions: Transaction[]
  categories: Category[]
  /** A person picked a category for this row: on a waiting row that also confirms it. */
  onCategory: (tx: Transaction, categoryId: number) => void
  setSplitTx: (tx: Transaction) => void
  handleDelete: (tx: Transaction) => void
  /** Some filter or search is narrowing the list. */
  filtered: boolean
  /** Select mode: a tick column leads each row. */
  selecting: boolean
  picked: ReadonlySet<number>
  onPick: (id: number) => void
  onClear: () => void
}

// Phone cards in transactions.css place these columns by position: keep the two in step. Select
// mode puts a tick column first, which moves every other column up by one (the .has-pick rules).
const COLUMNS = ['Date', 'Description', 'Amount', 'Category', 'Sorted', '']

const confidenceClass = (c: number) => (c >= 0.8 ? 'tx-conf-high' : c >= 0.5 ? '' : 'tx-conf-low')

const PAGE = 60

/** The shop's clean name over the bank's own text (two lines at most); a tap opens the merchant sheet, which holds the whole bank text. */
function MerchantDescription({ text, tag }: { text: string; tag: ReactNode }) {
  return (
    <div className="tx-desc-merchant">
      <MerchantName description={text} />
      {tag}
    </div>
  )
}

/** Two lines of the description; when there is more, tapping or pressing Enter on it opens all of it, and again closes it. */
function Description({ text, tag }: { text: string; tag: ReactNode }) {
  const [open, setOpen] = useState(false)
  const [el, setEl] = useState<HTMLElement | null>(null)
  const [clipped, setClipped] = useState(false)

  const measure = useCallback(() => {
    if (el) setClipped(el.scrollHeight > el.clientHeight + 1)
  }, [el])

  // The observer reports once when it starts watching, then whenever the width changes.
  useEffect(() => {
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [el, measure])

  const content = <>{text}{tag}</>
  if (!clipped && !open) return <span ref={setEl} className="tx-desc-text">{content}</span>
  return (
    <button
      ref={setEl}
      type="button"
      className="tx-desc-text is-button"
      aria-expanded={open}
      onClick={() => setOpen(o => !o)}
    >
      {content}
    </button>
  )
}

/** The merchant name where a merchant sheet is available, the plain two-line description where it is not. */
function DescriptionCell({ text, tag }: { text: string; tag: ReactNode }) {
  const { available } = useMerchantSheet()
  return available ? <MerchantDescription text={text} tag={tag} /> : <Description text={text} tag={tag} />
}

export default function TransactionsTable({ transactions, categories, onCategory, setSplitTx, handleDelete, filtered, selecting, picked, onPick, onClear }: TransactionsTableProps) {
  const [shown, setShown] = useState(PAGE)
  const hidden = transactions.length - shown

  return (
    <div className="panel tx-panel">
      <table className={`table card-table tx-table${selecting ? ' has-pick' : ''}`}>
        <thead>
          <tr>
            {selecting && <th className="tx-pick-cell" aria-label="Select" />}
            {COLUMNS.map((h, i) => (
              <th key={i} className={i === 2 ? 'right' : undefined}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {transactions.slice(0, shown).map(tx => (
            <tr key={tx.id} className={picked.has(tx.id) ? 'is-picked' : undefined}>
              {selecting && (
                <td className="tx-pick-cell">
                  <label className="tx-pick">
                    <input
                      type="checkbox"
                      checked={picked.has(tx.id)}
                      onChange={() => onPick(tx.id)}
                      aria-label={`Select ${tx.description}`}
                    />
                    <span className="tx-box"><Check size={13} aria-hidden="true" /></span>
                  </label>
                </td>
              )}
              <td className="num tx-date"><time dateTime={tx.date}>{dayLabel(tx.date)}</time></td>
              <td className={`tx-desc${tx.confirmed ? ' strong' : ''}`}>
                <DescriptionCell
                  text={tx.description}
                  tag={tx.set_aside_name != null ? (
                    <span className="tx-tag" title={`Paid from the set-aside "${tx.set_aside_name}": counts in no month's spending`}>set aside</span>
                  ) : tx.confirmed && tx.categorised_by === 'ai' && (
                    <span className="tx-tag" title="Sorted automatically: Claude was sure. Click the category to change it if it is wrong.">auto</span>
                  )}
                />
              </td>
              <td className={`right num tx-amount${tx.amount_cents < 0 ? '' : ' is-in'}`}>
                {tx.is_refund && (
                  <span className="tx-tag" title="Refund: reduces the category's spend instead of counting as income">refund</span>
                )}
                {tx.amount_cents < 0 ? '-' : '+'}{formatCents(Math.abs(tx.amount_cents))}
              </td>
              <td className="tx-cat">
                {tx.splits.length > 0 ? (
                  <div className="tx-splits">
                    {tx.splits.map(s => (
                      <span key={s.id} className="tx-chip">
                        {s.is_refund && (
                          <span className="tx-tag" title="Refund part: nets against its category">R</span>
                        )}
                        {s.category_name ?? '—'} <span className="num">{formatCents(Math.abs(s.amount_cents))}</span>
                      </span>
                    ))}
                  </div>
                ) : (
                  <CategorySelect
                    categories={categories}
                    value={tx.category_id}
                    onChange={id => id !== tx.category_id && onCategory(tx, id)}
                    renderTrigger={({ open, toggle }) => (
                      <button type="button" className="tx-cat-btn" aria-haspopup="listbox" aria-expanded={open} onClick={toggle}
                        aria-label={`Change the category of ${tx.description} (now ${tx.category_name ?? 'none'})`}>
                        {tx.category_name ?? <span className="tx-cat-empty">Pick…</span>}
                        <ChevronDown size={13} aria-hidden="true" />
                      </button>
                    )}
                  />
                )}
              </td>
              <td>
                <span className="tx-sorted">
                  {tx.confirmed ? (
                    <span className="tx-status is-done">
                      <Check size={12} aria-hidden="true" />
                      {tx.categorised_by ?? 'confirmed'}
                      {tx.categorised_by === 'ai' && tx.ai_confidence != null && (
                        <span className={`num tx-conf ${confidenceClass(tx.ai_confidence)}`}> {Math.round(tx.ai_confidence * 100)}%</span>
                      )}
                    </span>
                  ) : (
                    <span className="tx-status is-review">
                      <CircleAlert size={12} aria-hidden="true" />
                      review
                    </span>
                  )}
                  {/* The source, unless it only repeats "manual". */}
                  {!(tx.source === 'manual' && tx.categorised_by === 'manual') && <span className="tx-src lab">{tx.source}</span>}
                </span>
              </td>
              <td className="right tx-row-actions">
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => setSplitTx(tx)}
                  title={tx.splits.length > 0 ? 'Edit split' : 'Split into multiple categories'}
                  aria-label={`Split transaction ${tx.description}`}
                >
                  {tx.splits.length > 0 ? `Split (${tx.splits.length})` : 'Split'}
                </button>
                {tx.source === 'manual' && (
                  <button
                    type="button"
                    className="btn btn-sm btn-danger"
                    onClick={() => handleDelete(tx)}
                    title="Delete this manual transaction"
                    aria-label={`Delete transaction ${tx.description}`}
                  >
                    Delete
                  </button>
                )}
              </td>
            </tr>
          ))}
          {transactions.length === 0 && (
            <tr>
              <td colSpan={selecting ? 7 : 6} className="empty">
                {filtered ? (
                  <>
                    No transactions match these filters.
                    <span className="tx-empty-action"><button type="button" className="btn" onClick={onClear}>Clear filters</button></span>
                  </>
                ) : 'No transactions yet. Bring in a bank file or add one by hand.'}
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {hidden > 0 && (
        <button type="button" className="btn btn-wide tx-more" onClick={() => setShown(n => n + PAGE)}>
          Show {Math.min(PAGE, hidden)} more of {hidden}
        </button>
      )}
    </div>
  )
}
