import { useState } from 'react'
import type { Transaction, Category } from '../types'

interface Props {
  transaction: Transaction
  categories: Category[]
  onConfirm: (id: number, categoryId: number) => void
  onSkip: () => void
  onCreateRule: (id: number, categoryId: number) => void
}

export default function ReviewCard({ transaction: tx, categories, onConfirm, onSkip, onCreateRule }: Props) {
  const [selectedCategory, setSelectedCategory] = useState<number>(tx.category_id ?? categories[0]?.id)

  return (
    <div style={{ background: '#1a1f2e', border: '1px solid #333', borderRadius: 10, padding: 24, maxWidth: 480 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 'bold' }}>{tx.description}</div>
          <div style={{ fontSize: 12, color: '#888', marginTop: 4 }}>
            {tx.date} · {tx.source.toUpperCase()}
          </div>
        </div>
        <div style={{ fontSize: 22, fontWeight: 'bold', color: tx.amount < 0 ? '#f87171' : '#4ade80' }}>
          €{Math.abs(tx.amount).toFixed(2)}
        </div>
      </div>

      {tx.categorised_by === 'ai' && tx.category_name && (
        <div style={{ marginBottom: 16, padding: '8px 12px', background: '#111', borderRadius: 6, fontSize: 13, color: '#888' }}>
          AI suggests: <span style={{ color: '#facc15' }}>{tx.category_name}</span>
          {tx.ai_confidence && <span style={{ marginLeft: 8, color: '#555' }}>{Math.round(tx.ai_confidence * 100)}% confident</span>}
        </div>
      )}

      <div style={{ marginBottom: 16 }}>
        <label style={{ display: 'block', marginBottom: 6, fontSize: 12, color: '#888' }}>Category</label>
        <select
          value={selectedCategory}
          onChange={e => setSelectedCategory(Number(e.target.value))}
          style={{ width: '100%', background: '#111', color: '#e0e0e0', border: '1px solid #444', borderRadius: 6, padding: '8px 12px' }}
        >
          {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>

      <div style={{ display: 'flex', gap: 10, marginBottom: 10 }}>
        <button
          onClick={() => onConfirm(tx.id, selectedCategory)}
          style={{ flex: 1, background: '#1d4ed8', color: '#fff', border: 'none', borderRadius: 6, padding: '10px', cursor: 'pointer', fontWeight: 'bold' }}
        >
          Confirm
        </button>
        <button
          onClick={onSkip}
          style={{ background: '#374151', color: '#e0e0e0', border: 'none', borderRadius: 6, padding: '10px 16px', cursor: 'pointer' }}
        >
          Skip
        </button>
      </div>
      <button
        onClick={() => onCreateRule(tx.id, selectedCategory)}
        style={{ width: '100%', background: 'transparent', color: '#888', border: '1px solid #444', borderRadius: 6, padding: '8px', cursor: 'pointer', fontSize: 12 }}
      >
        Always categorise "{tx.description}" as this category
      </button>
    </div>
  )
}
