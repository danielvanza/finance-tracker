import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api'

function currentMonth() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export default function Budget() {
  const [month, setMonth] = useState(currentMonth)
  const [editing, setEditing] = useState<Record<number, string>>({})
  const qc = useQueryClient()

  const { data: rows = [] } = useQuery({
    queryKey: ['budget', month],
    queryFn: () => api.getBudget(month),
  })

  const handleSave = async (id: number) => {
    const val = parseFloat(editing[id])
    if (!isNaN(val)) {
      await api.patchBudget(id, val)
      qc.invalidateQueries({ queryKey: ['budget', month] })
    }
    setEditing(e => { const n = { ...e }; delete n[id]; return n })
  }

  const pct = (actual: number | null, planned: number) =>
    planned > 0 && actual != null ? Math.round((actual / planned) * 100) : 0

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h1 style={{ margin: 0 }}>Budget</h1>
        <input type="month" value={month} onChange={e => setMonth(e.target.value)}
          style={{ background: '#1a1f2e', color: '#e0e0e0', border: '1px solid #333', borderRadius: 6, padding: '6px 12px' }} />
      </div>

      <div style={{ background: '#1a1f2e', borderRadius: 8, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: '#111', color: '#888' }}>
              <th style={{ padding: '10px 16px', textAlign: 'left' }}>Category</th>
              <th style={{ padding: '10px 16px', textAlign: 'right' }}>Planned</th>
              <th style={{ padding: '10px 16px', textAlign: 'right' }}>Actual</th>
              <th style={{ padding: '10px 16px', textAlign: 'left', width: 160 }}>Progress</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(row => {
              const p = pct(row.actual_amount, row.planned_amount)
              const over = p > 100
              return (
                <tr key={row.id} style={{ borderBottom: '1px solid #222' }}>
                  <td style={{ padding: '10px 16px' }}>{row.category_name}</td>
                  <td style={{ padding: '10px 16px', textAlign: 'right' }}>
                    {row.id in editing ? (
                      <input
                        type="number"
                        value={editing[row.id] ?? row.planned_amount}
                        onChange={e => setEditing(prev => ({ ...prev, [row.id]: e.target.value }))}
                        onBlur={() => handleSave(row.id)}
                        autoFocus
                        style={{ width: 80, background: '#111', color: '#e0e0e0', border: '1px solid #60a5fa', borderRadius: 4, padding: '4px 8px', textAlign: 'right' }}
                      />
                    ) : (
                      <span
                        onClick={() => setEditing(prev => ({ ...prev, [row.id]: String(row.planned_amount) }))}
                        style={{ cursor: 'pointer', color: '#aaa' }}
                        title="Click to edit"
                      >
                        €{Number(row.planned_amount).toFixed(2)}
                      </span>
                    )}
                  </td>
                  <td style={{ padding: '10px 16px', textAlign: 'right', color: over ? '#f87171' : '#4ade80' }}>
                    €{(row.actual_amount ?? 0).toFixed(2)}
                  </td>
                  <td style={{ padding: '10px 16px' }}>
                    <div style={{ background: '#333', borderRadius: 4, height: 8, overflow: 'hidden' }}>
                      <div style={{
                        height: '100%', borderRadius: 4,
                        width: `${Math.min(p, 100)}%`,
                        background: over ? '#f87171' : p > 80 ? '#facc15' : '#4ade80',
                      }} />
                    </div>
                    <span style={{ fontSize: 11, color: '#666', marginTop: 2, display: 'block' }}>{p}%</span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p style={{ color: '#555', fontSize: 12, marginTop: 8 }}>Click any planned amount to edit. Changes apply to this month only.</p>
    </div>
  )
}
