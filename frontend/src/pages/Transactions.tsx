import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api'
import ReviewCard from '../components/ReviewCard'

export default function Transactions() {
  const qc = useQueryClient()
  const [showReview, setShowReview] = useState(false)

  const { data: transactions = [] } = useQuery({
    queryKey: ['transactions'],
    queryFn: () => api.getTransactions(),
  })
  const { data: categories = [] } = useQuery({
    queryKey: ['categories'],
    queryFn: () => api.getCategories(),
  })
  const { data: reviewTx } = useQuery({
    queryKey: ['review'],
    queryFn: () => api.getNextReview(),
    enabled: showReview,
  })

  const unconfirmedCount = transactions.filter(t => !t.confirmed).length

  const handleConfirm = async (id: number, categoryId: number) => {
    await api.patchTransaction(id, { category_id: categoryId, confirmed: true })
    qc.invalidateQueries({ queryKey: ['transactions'] })
    qc.invalidateQueries({ queryKey: ['review'] })
  }

  const handleCreateRule = async (id: number, categoryId: number) => {
    await api.patchTransaction(id, { category_id: categoryId })
    await api.createRuleFromTransaction(id)
    qc.invalidateQueries({ queryKey: ['transactions'] })
    qc.invalidateQueries({ queryKey: ['review'] })
    qc.invalidateQueries({ queryKey: ['rules'] })
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h1 style={{ margin: 0 }}>Transactions</h1>
        {unconfirmedCount > 0 && (
          <button
            onClick={() => setShowReview(!showReview)}
            style={{ background: '#f97316', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 16px', cursor: 'pointer', fontWeight: 'bold' }}
          >
            {unconfirmedCount} need review
          </button>
        )}
      </div>

      {showReview && reviewTx && (
        <div style={{ marginBottom: 32 }}>
          <h3 style={{ marginTop: 0 }}>Review Queue</h3>
          <ReviewCard
            transaction={reviewTx}
            categories={categories}
            onConfirm={handleConfirm}
            onSkip={() => qc.invalidateQueries({ queryKey: ['review'] })}
            onCreateRule={handleCreateRule}
          />
        </div>
      )}

      <div style={{ background: '#1a1f2e', borderRadius: 8, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: '#111', color: '#888' }}>
              <th style={{ padding: '10px 16px', textAlign: 'left' }}>Date</th>
              <th style={{ padding: '10px 16px', textAlign: 'left' }}>Description</th>
              <th style={{ padding: '10px 16px', textAlign: 'right' }}>Amount</th>
              <th style={{ padding: '10px 16px', textAlign: 'left' }}>Category</th>
              <th style={{ padding: '10px 16px', textAlign: 'left' }}>Source</th>
              <th style={{ padding: '10px 16px', textAlign: 'left' }}>Status</th>
            </tr>
          </thead>
          <tbody>
            {transactions.map(tx => (
              <tr key={tx.id} style={{ borderBottom: '1px solid #222', opacity: tx.confirmed ? 1 : 0.7 }}>
                <td style={{ padding: '8px 16px', color: '#888' }}>{tx.date}</td>
                <td style={{ padding: '8px 16px' }}>{tx.description}</td>
                <td style={{ padding: '8px 16px', textAlign: 'right', color: tx.amount < 0 ? '#f87171' : '#4ade80', fontWeight: 'bold' }}>
                  €{Math.abs(tx.amount).toFixed(2)}
                </td>
                <td style={{ padding: '8px 16px', color: '#aaa' }}>{tx.category_name ?? '—'}</td>
                <td style={{ padding: '8px 16px', color: '#666', textTransform: 'uppercase', fontSize: 11 }}>{tx.source}</td>
                <td style={{ padding: '8px 16px' }}>
                  <span style={{
                    padding: '2px 8px', borderRadius: 4, fontSize: 11,
                    background: tx.confirmed ? '#0f2d0f' : '#2d1b00',
                    color: tx.confirmed ? '#4ade80' : '#f97316',
                    border: `1px solid ${tx.confirmed ? '#4ade80' : '#f97316'}`,
                  }}>
                    {tx.confirmed ? `✓ ${tx.categorised_by ?? 'confirmed'}` : '? review'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
