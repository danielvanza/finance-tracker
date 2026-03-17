import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api'

export default function Rules() {
  const qc = useQueryClient()
  const [newPattern, setNewPattern] = useState('')
  const [newCategory, setNewCategory] = useState<number | null>(null)
  const [editing, setEditing] = useState<Record<number, { pattern: string; category_id: number }>>({})

  const { data: rules = [] } = useQuery({ queryKey: ['rules'], queryFn: api.getRules })
  const { data: categories = [] } = useQuery({ queryKey: ['categories'], queryFn: api.getCategories })

  const handleCreate = async () => {
    if (!newPattern || !newCategory) return
    await api.createRule({ pattern: newPattern, category_id: newCategory, priority: 0 })
    qc.invalidateQueries({ queryKey: ['rules'] })
    setNewPattern('')
  }

  const handleDelete = async (id: number) => {
    await api.deleteRule(id)
    qc.invalidateQueries({ queryKey: ['rules'] })
  }

  const handleSaveEdit = async (id: number) => {
    const e = editing[id]
    if (!e) return
    await fetch(`/api/rules/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pattern: e.pattern, category_id: e.category_id, priority: 0 }),
    })
    qc.invalidateQueries({ queryKey: ['rules'] })
    setEditing(prev => { const n = { ...prev }; delete n[id]; return n })
  }

  return (
    <div>
      <h1>Categorisation Rules</h1>

      <div style={{ background: '#1a1f2e', borderRadius: 8, padding: 20, marginBottom: 24, maxWidth: 600 }}>
        <h3 style={{ marginTop: 0 }}>Add Rule</h3>
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: 12, color: '#888', display: 'block', marginBottom: 4 }}>Pattern (substring match)</label>
            <input
              value={newPattern}
              onChange={e => setNewPattern(e.target.value)}
              placeholder="e.g. albert heijn"
              style={{ width: '100%', background: '#111', color: '#e0e0e0', border: '1px solid #333', borderRadius: 6, padding: '8px 12px', boxSizing: 'border-box' }}
            />
          </div>
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: 12, color: '#888', display: 'block', marginBottom: 4 }}>Category</label>
            <select
              value={newCategory ?? ''}
              onChange={e => setNewCategory(Number(e.target.value))}
              style={{ width: '100%', background: '#111', color: '#e0e0e0', border: '1px solid #333', borderRadius: 6, padding: '8px 12px' }}
            >
              <option value="">Select...</option>
              {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <button
            onClick={handleCreate}
            disabled={!newPattern || !newCategory}
            style={{ background: '#1d4ed8', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 16px', cursor: 'pointer', whiteSpace: 'nowrap' }}
          >
            Add Rule
          </button>
        </div>
      </div>

      <div style={{ background: '#1a1f2e', borderRadius: 8, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: '#111', color: '#888' }}>
              <th style={{ padding: '10px 16px', textAlign: 'left' }}>Pattern</th>
              <th style={{ padding: '10px 16px', textAlign: 'left' }}>Category</th>
              <th style={{ padding: '10px 16px', textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rules.map(rule => {
              const e = editing[rule.id]
              return (
                <tr key={rule.id} style={{ borderBottom: '1px solid #222' }}>
                  <td style={{ padding: '10px 16px' }}>
                    {e ? (
                      <input value={e.pattern} onChange={ev => setEditing(prev => ({ ...prev, [rule.id]: { ...prev[rule.id], pattern: ev.target.value } }))}
                        style={{ background: '#111', color: '#60a5fa', border: '1px solid #60a5fa', borderRadius: 4, padding: '4px 8px', fontFamily: 'monospace', width: '100%' }} />
                    ) : (
                      <span style={{ fontFamily: 'monospace', color: '#60a5fa' }}>{rule.pattern}</span>
                    )}
                  </td>
                  <td style={{ padding: '10px 16px' }}>
                    {e ? (
                      <select value={e.category_id} onChange={ev => setEditing(prev => ({ ...prev, [rule.id]: { ...prev[rule.id], category_id: Number(ev.target.value) } }))}
                        style={{ background: '#111', color: '#e0e0e0', border: '1px solid #444', borderRadius: 4, padding: '4px 8px' }}>
                        {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                    ) : (
                      <span style={{ color: '#aaa' }}>{rule.category_name}</span>
                    )}
                  </td>
                  <td style={{ padding: '10px 16px', textAlign: 'right' }}>
                    <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                    {e ? (
                      <>
                        <button onClick={() => handleSaveEdit(rule.id)}
                          style={{ background: '#1d4ed8', color: '#fff', border: 'none', borderRadius: 4, padding: '4px 10px', cursor: 'pointer', fontSize: 12 }}>Save</button>
                        <button onClick={() => setEditing(prev => { const n = { ...prev }; delete n[rule.id]; return n })}
                          style={{ background: 'transparent', color: '#888', border: '1px solid #555', borderRadius: 4, padding: '4px 10px', cursor: 'pointer', fontSize: 12 }}>Cancel</button>
                      </>
                    ) : (
                      <>
                        <button onClick={() => setEditing(prev => ({ ...prev, [rule.id]: { pattern: rule.pattern, category_id: rule.category_id } }))}
                          style={{ background: 'transparent', color: '#60a5fa', border: '1px solid #60a5fa', borderRadius: 4, padding: '4px 10px', cursor: 'pointer', fontSize: 12 }}>Edit</button>
                        <button onClick={() => handleDelete(rule.id)}
                          style={{ background: 'transparent', color: '#f87171', border: '1px solid #f87171', borderRadius: 4, padding: '4px 10px', cursor: 'pointer', fontSize: 12 }}>Delete</button>
                      </>
                    )}
                    </div>
                  </td>
                </tr>
              )
            })}
            {rules.length === 0 && (
              <tr><td colSpan={3} style={{ padding: 24, textAlign: 'center', color: '#555' }}>No rules yet. Add one above.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
