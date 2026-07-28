import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api'
import CategorySelect from '../components/CategorySelect'

const fieldLabel: React.CSSProperties = {
  display: 'block', marginBottom: 7,
  fontSize: 10.5, fontWeight: 700,
  color: 'var(--text-label)',
  textTransform: 'uppercase', letterSpacing: '0.1em',
}

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

  const canCreate = Boolean(newPattern && newCategory)

  return (
    <div className="animate-fade-in">
      {/* Page header */}
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ marginBottom: 4 }}>Categorisation Rules</h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: 13 }}>Pattern-based rules auto-categorise transactions on import</p>
      </div>

      {/* Add rule form */}
      <div style={{
        background: 'var(--bg-card)',
        borderRadius: 'var(--radius-lg)',
        padding: '20px 22px',
        marginBottom: 20,
        maxWidth: 680,
        border: '1px solid var(--border)',
        boxShadow: '0 4px 32px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.03)',
      }}>
        {/* Form header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
          <div style={{
            width: 30, height: 30, borderRadius: 8,
            background: 'var(--accent-bg)',
            border: '1px solid var(--accent-border)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent-light)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
          </div>
          <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text-h)', letterSpacing: '-0.02em' }}>Add Rule</div>
        </div>

        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end' }}>
          <div style={{ flex: 1.2 }}>
            <label style={fieldLabel}>Pattern (substring match)</label>
            <input
              value={newPattern}
              onChange={e => setNewPattern(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleCreate()}
              placeholder="e.g. albert heijn"
              style={{
                width: '100%',
                background: 'var(--bg-input)', color: 'var(--text-h)',
                border: '1px solid var(--border-strong)',
                borderRadius: 'var(--radius)', padding: '9px 12px',
                fontSize: 13, fontFamily: 'var(--mono)',
                outline: 'none', transition: 'border-color 0.15s, box-shadow 0.15s',
                letterSpacing: '0.01em',
              }}
              onFocus={e => { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.boxShadow = 'var(--shadow-input)' }}
              onBlur={e => { e.currentTarget.style.borderColor = 'var(--border-strong)'; e.currentTarget.style.boxShadow = 'none' }}
            />
          </div>
          <div style={{ flex: 1 }}>
            <label style={fieldLabel}>Category</label>
            <CategorySelect
              categories={categories}
              value={newCategory}
              onChange={setNewCategory}
              placeholder="Select category\u2026"
            />
          </div>
          <button
            onClick={handleCreate}
            disabled={!canCreate}
            style={{
              background: canCreate ? 'linear-gradient(135deg, #4f46e5, #6366f1)' : 'var(--bg-input)',
              color: canCreate ? '#fff' : 'var(--text-muted)',
              border: canCreate ? 'none' : '1px solid var(--border)',
              borderRadius: 'var(--radius)', padding: '9px 20px',
              cursor: canCreate ? 'pointer' : 'not-allowed',
              fontWeight: 600, fontSize: 13.5, fontFamily: 'var(--sans)',
              whiteSpace: 'nowrap',
              boxShadow: canCreate ? '0 4px 14px rgba(99,102,241,0.35)' : 'none',
              transition: 'all 0.2s ease',
              display: 'flex', alignItems: 'center', gap: 7,
              letterSpacing: '-0.01em',
              flexShrink: 0,
            }}
            onMouseEnter={e => { if (canCreate) { (e.currentTarget as HTMLElement).style.boxShadow = '0 6px 22px rgba(99,102,241,0.5)'; (e.currentTarget as HTMLElement).style.transform = 'translateY(-1px)' } }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.boxShadow = canCreate ? '0 4px 14px rgba(99,102,241,0.35)' : 'none'; (e.currentTarget as HTMLElement).style.transform = 'none' }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            Add Rule
          </button>
        </div>
      </div>

      {/* Rules table */}
      <div style={{
        background: 'var(--bg-card)',
        borderRadius: 'var(--radius-lg)',
        overflow: 'hidden',
        border: '1px solid var(--border)',
        boxShadow: '0 4px 32px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.03)',
      }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: 'var(--bg-table-header)', borderBottom: '1px solid var(--border-strong)' }}>
              {[['Pattern', 'left'], ['Category', 'left'], ['Actions', 'right']].map(([h, align]) => (
                <th key={h} style={{
                  padding: '12px 16px', textAlign: align as 'left' | 'right',
                  fontSize: 10.5, fontWeight: 700, color: 'var(--text-label)',
                  textTransform: 'uppercase', letterSpacing: '0.08em',
                }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rules.map((rule, idx) => {
              const e = editing[rule.id]
              return (
                <tr
                  key={rule.id}
                  style={{
                    borderBottom: idx < rules.length - 1 ? '1px solid var(--border)' : 'none',
                    transition: 'background 0.12s ease',
                  }}
                  onMouseEnter={ev => (ev.currentTarget as HTMLElement).style.background = 'rgba(99,102,241,0.04)'}
                  onMouseLeave={ev => (ev.currentTarget as HTMLElement).style.background = ''}
                >
                  {/* Pattern */}
                  <td style={{ padding: '12px 16px' }}>
                    {e ? (
                      <input
                        value={e.pattern}
                        onChange={ev => setEditing(prev => ({ ...prev, [rule.id]: { ...prev[rule.id], pattern: ev.target.value } }))}
                        style={{
                          background: 'var(--bg-input)', color: 'var(--text-h)',
                          border: '1px solid var(--accent)', borderRadius: 'var(--radius)',
                          padding: '6px 10px', outline: 'none',
                          fontFamily: 'var(--mono)', fontSize: 13,
                          boxShadow: 'var(--shadow-input)', minWidth: 200,
                        }}
                      />
                    ) : (
                      <code style={{
                        fontFamily: 'var(--mono)', fontSize: 12.5, fontWeight: 500,
                        background: 'var(--accent-bg)',
                        color: 'var(--accent-light)',
                        padding: '3px 9px',
                        borderRadius: 'var(--radius-xs)',
                        border: '1px solid var(--accent-border)',
                        letterSpacing: '-0.01em',
                      }}>{rule.pattern}</code>
                    )}
                  </td>

                  {/* Category */}
                  <td style={{ padding: '12px 16px' }}>
                    {e ? (
                      <CategorySelect
                        categories={categories}
                        value={e.category_id}
                        onChange={v => setEditing(prev => ({ ...prev, [rule.id]: { ...prev[rule.id], category_id: v } }))}
                        compact
                      />
                    ) : (
                      <span style={{
                        color: 'var(--text-secondary)',
                        fontSize: 13,
                      }}>{rule.category_name}</span>
                    )}
                  </td>

                  {/* Actions */}
                  <td style={{ padding: '12px 16px' }}>
                    <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                      {e ? (
                        <>
                          <button
                            onClick={() => handleSaveEdit(rule.id)}
                            style={{
                              background: 'linear-gradient(135deg, #4f46e5, #6366f1)',
                              color: '#fff', border: 'none',
                              borderRadius: 'var(--radius)', padding: '6px 14px',
                              cursor: 'pointer', fontSize: 12.5, fontFamily: 'var(--sans)', fontWeight: 600,
                              boxShadow: '0 2px 8px rgba(99,102,241,0.3)',
                              display: 'flex', alignItems: 'center', gap: 5,
                            }}
                          >
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="20 6 9 17 4 12"/>
                            </svg>
                            Save
                          </button>
                          <button
                            onClick={() => setEditing(prev => { const n = { ...prev }; delete n[rule.id]; return n })}
                            style={{
                              background: 'transparent', color: 'var(--text-secondary)',
                              border: '1px solid var(--border-strong)',
                              borderRadius: 'var(--radius)', padding: '6px 14px',
                              cursor: 'pointer', fontSize: 12.5, fontFamily: 'var(--sans)',
                            }}
                          >Cancel</button>
                        </>
                      ) : (
                        <>
                          <button
                            onClick={() => setEditing(prev => ({ ...prev, [rule.id]: { pattern: rule.pattern, category_id: rule.category_id } }))}
                            style={{
                              background: 'var(--accent-bg)',
                              color: 'var(--accent-light)',
                              border: '1px solid var(--accent-border)',
                              borderRadius: 'var(--radius)', padding: '6px 14px',
                              cursor: 'pointer', fontSize: 12.5, fontFamily: 'var(--sans)', fontWeight: 600,
                              display: 'flex', alignItems: 'center', gap: 5,
                              transition: 'all 0.15s ease',
                            }}
                          >
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                            </svg>
                            Edit
                          </button>
                          <button
                            onClick={() => handleDelete(rule.id)}
                            style={{
                              background: 'var(--red-bg)',
                              color: 'var(--red)',
                              border: '1px solid var(--red-border)',
                              borderRadius: 'var(--radius)', padding: '6px 14px',
                              cursor: 'pointer', fontSize: 12.5, fontFamily: 'var(--sans)', fontWeight: 600,
                              display: 'flex', alignItems: 'center', gap: 5,
                              transition: 'all 0.15s ease',
                            }}
                          >
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                              <path d="M10 11v6"/><path d="M14 11v6"/>
                              <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
                            </svg>
                            Delete
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              )
            })}
            {rules.length === 0 && (
              <tr>
                <td colSpan={3} style={{ padding: '52px 24px', textAlign: 'center' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, color: 'var(--text-muted)' }}>
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.4 }}>
                      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
                    </svg>
                    <span style={{ fontSize: 13 }}>No rules yet. Add a pattern above to auto-categorise transactions.</span>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
