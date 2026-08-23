import { useQuery } from '@tanstack/react-query'
import { api } from '../../api'
import { formatCents } from '../../money'
import type { Category, Transaction } from '../../types'
import CategorySelect from '../../components/CategorySelect'
import { LoadingSkeleton } from './BudgetSkeleton'

// ── Single transaction drill row ──────────────────────────────────────────────
interface TransactionDrillRowProps {
  tx: Transaction
  categories: Category[]
  onRecategorise: (txId: number, newCategoryId: number) => void
}

function TransactionDrillRow({ tx, categories, onRecategorise }: TransactionDrillRowProps) {
  const filteredCategories = categories.filter(c => {
    if (c.type === 'exclude') return true
    return c.type !== 'income'
  })

  return (
    <tr style={{ borderBottom: '1px solid rgba(148,163,184,0.07)' }}>
      <td style={{ padding: '5px 8px', color: 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums' }}>
        {tx.date}
      </td>
      <td style={{ padding: '5px 8px', color: 'var(--text-h)', maxWidth: 340, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {tx.description}
      </td>
      <td style={{ padding: '5px 8px', textAlign: 'right', color: tx.amount_cents < 0 ? 'var(--red)' : 'var(--green)', fontVariantNumeric: 'tabular-nums', fontFamily: 'var(--mono)' }}>
        {tx.amount_cents < 0 ? '-' : '+'}{formatCents(Math.abs(tx.amount_cents))}
      </td>
      <td style={{ padding: '5px 8px', minWidth: 200 }} onClick={e => e.stopPropagation()}>
        <CategorySelect
          categories={filteredCategories}
          value={tx.category_id}
          onChange={(newId) => onRecategorise(tx.id, newId)}
          compact
        />
      </td>
    </tr>
  )
}

// ── Expanded drill-down sub-row ───────────────────────────────────────────────
interface DrillDownRowProps {
  categoryId: number
  categoryName: string
  month: string
  categories: Category[]
  onRecategorise: (txId: number, newCategoryId: number) => void
}

export function DrillDownRow({ categoryId, categoryName, month, categories, onRecategorise }: DrillDownRowProps) {
  const { data: txs = [], isLoading } = useQuery({
    queryKey: ['transactions', { category_id: categoryId, month }],
    queryFn: () => api.getTransactions({
      category_id: String(categoryId),
      month,
      confirmed: 'true',
    }),
  })

  return (
    <tr>
      <td colSpan={5} style={{
        padding: 0,
        background: 'rgba(99,102,241,0.03)',
        borderBottom: '2px solid var(--accent)',
      }}>
        <div style={{ padding: '12px 20px 16px' }}>
          <div style={{
            fontSize: 11.5, fontWeight: 700, textTransform: 'uppercase',
            letterSpacing: '0.08em', color: 'var(--text-label)', marginBottom: 10,
          }}>
            {categoryName} — {month}
          </div>

          {isLoading && <LoadingSkeleton />}

          {!isLoading && txs.length === 0 && (
            <div style={{ color: 'var(--text-muted)', fontSize: 12.5, padding: '8px 0' }}>
              No confirmed transactions this month.
            </div>
          )}

          {!isLoading && txs.length > 0 && (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  <th style={{ textAlign: 'left', padding: '4px 8px', color: 'var(--text-label)', fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Date</th>
                  <th style={{ textAlign: 'left', padding: '4px 8px', color: 'var(--text-label)', fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Description</th>
                  <th style={{ textAlign: 'right', padding: '4px 8px', color: 'var(--text-label)', fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Amount</th>
                  <th style={{ textAlign: 'left', padding: '4px 8px', color: 'var(--text-label)', fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', minWidth: 200 }}>Category</th>
                </tr>
              </thead>
              <tbody>
                {txs.map(tx => (
                  <TransactionDrillRow
                    key={tx.id}
                    tx={tx}
                    categories={categories}
                    onRecategorise={onRecategorise}
                  />
                ))}
              </tbody>
            </table>
          )}
        </div>
      </td>
    </tr>
  )
}
