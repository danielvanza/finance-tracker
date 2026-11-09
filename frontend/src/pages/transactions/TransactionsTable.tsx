import { useState } from 'react'
import { dayLabel } from '../../dates'
import { Check, CircleAlert } from 'lucide-react'
import { formatCents } from '../../money'
import type { Transaction } from '../../types'

interface TransactionsTableProps {
  transactions: Transaction[]
  setSplitTx: (tx: Transaction) => void
  handleDelete: (tx: Transaction) => void
  filtered: boolean
}

// Phone cards in transactions.css place these columns by position: keep the two in step.
const COLUMNS = ['Date', 'Description', 'Amount', 'Category', 'Source', 'AI conf.', 'Status', '']

const confidenceClass = (c: number) => (c >= 0.8 ? 'tx-conf-high' : c >= 0.5 ? '' : 'tx-conf-low')

const PAGE = 60

export default function TransactionsTable({ transactions, setSplitTx, handleDelete, filtered }: TransactionsTableProps) {
  const [shown, setShown] = useState(PAGE)
  const hidden = transactions.length - shown

  return (
    <div className="panel tx-panel">
      <table className="table card-table tx-table">
        <thead>
          <tr>
            {COLUMNS.map((h, i) => (
              <th key={h || 'actions'} className={i === 2 ? 'right' : undefined}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {transactions.slice(0, shown).map(tx => (
            <tr key={tx.id}>
              <td className="num tx-date"><time dateTime={tx.date}>{dayLabel(tx.date)}</time></td>
              <td className={`tx-desc${tx.confirmed ? ' strong' : ''}`} title={tx.description}>
                {tx.description}
                {tx.standing_adjustment_id != null && (
                  <span className="tx-tag" title="Created automatically by a standing adjustment">auto</span>
                )}
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
                ) : tx.category_name ? (
                  tx.category_name
                ) : (
                  <span className="muted">—</span>
                )}
              </td>
              <td><span className="lab">{tx.source}</span></td>
              <td>
                {tx.categorised_by === 'ai' && tx.ai_confidence != null ? (
                  <span className={`num ${confidenceClass(tx.ai_confidence)}`}>
                    {Math.round(tx.ai_confidence * 100)}%
                  </span>
                ) : (
                  <span className="muted">—</span>
                )}
              </td>
              <td>
                {tx.confirmed ? (
                  <span className="tx-status is-done">
                    <Check size={12} aria-hidden="true" />
                    {tx.categorised_by ?? 'confirmed'}
                  </span>
                ) : (
                  <span className="tx-status is-review">
                    <CircleAlert size={12} aria-hidden="true" />
                    review
                  </span>
                )}
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
              <td colSpan={8} className="empty">
                {filtered ? 'No transactions from this source.' : 'No transactions yet. Bring in a bank file or add one by hand.'}
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
