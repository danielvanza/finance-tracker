import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { GripVertical } from 'lucide-react'
import { api } from '../api'
import type { Category } from '../types'
import { TYPE_META, GROUP_ORDER } from './CategorySelect'

const labelStyle: React.CSSProperties = {
  display: 'block', marginBottom: 6,
  fontSize: 10.5, fontWeight: 700, color: 'var(--text-label)',
  textTransform: 'uppercase', letterSpacing: '0.1em',
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  background: 'var(--bg-input)', color: 'var(--text-h)',
  border: '1px solid var(--border-strong)',
  borderRadius: 'var(--radius)',
  padding: '8px 12px',
  fontSize: 13, fontFamily: 'var(--sans)',
  outline: 'none',
}

export default function CategoryManager() {
  const qc = useQueryClient()
  const { data: categories = [] } = useQuery({
    queryKey: ['categories'],
    queryFn: api.getCategories,
  })

  const [showAdd, setShowAdd] = useState(false)
  const [newName, setNewName] = useState('')
  const [newType, setNewType] = useState('needs')
  const [error, setError] = useState('')
  const [editedNames, setEditedNames] = useState<Record<number, string>>({})
  const [draggedId, setDraggedId] = useState<number | null>(null)

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['categories'] })
    qc.invalidateQueries({ queryKey: ['budget'] })
    qc.invalidateQueries({ queryKey: ['dashboard'] })
    qc.invalidateQueries({ queryKey: ['transactions'] })
    qc.invalidateQueries({ queryKey: ['rules'] })
    qc.invalidateQueries({ queryKey: ['standing-adjustments'] })
  }

  const groups = GROUP_ORDER
    .map(type => ({
      type,
      items: categories.filter(c => c.type === type).sort((a, b) => a.sort_order - b.sort_order),
    }))
    .filter(g => g.items.length > 0)

  const saveName = async (cat: Category) => {
    const raw = editedNames[cat.id]
    if (raw == null) return
    const trimmed = raw.trim()
    if (!trimmed || trimmed === cat.name) {
      setEditedNames(prev => { const { [cat.id]: _, ...rest } = prev; return rest })
      return
    }
    const res = (await api.patchCategory(cat.id, { name: trimmed })) as { detail?: unknown }
    if (res.detail) {
      setError(typeof res.detail === 'string' ? res.detail : 'Could not rename')
      return
    }
    setEditedNames(prev => { const { [cat.id]: _, ...rest } = prev; return rest })
    invalidate()
  }

  const remove = async (cat: Category) => {
    if (!window.confirm(`Delete category "${cat.name}"?`)) return
    const res = (await api.deleteCategory(cat.id)) as { detail?: unknown }
    if (res?.detail) {
      setError(typeof res.detail === 'string' ? res.detail : 'Could not delete')
      return
    }
    invalidate()
  }

  const add = async () => {
    setError('')
    const trimmed = newName.trim()
    if (!trimmed) { setError('Name is required'); return }
    const res = (await api.createCategory({ name: trimmed, type: newType })) as { detail?: unknown }
    if (res.detail) { setError(typeof res.detail === 'string' ? res.detail : 'Could not save'); return }
    setNewName(''); setNewType('needs'); setShowAdd(false)
    invalidate()
  }

  const handleDrop = async (group: { type: string; items: Category[] }, target: Category) => {
    if (draggedId == null || draggedId === target.id) return
    const ids = group.items.map(c => c.id)
    const from = ids.indexOf(draggedId)
    if (from === -1) return
    const to = ids.indexOf(target.id)
    ids.splice(from, 1)
    ids.splice(to, 0, draggedId)
    setDraggedId(null)
    await api.reorderCategories(ids)
    invalidate()
  }

  return (
    <div style={{
      background: 'var(--bg-card)',
      borderRadius: 'var(--radius-lg)',
      padding: '24px 28px',
      border: '1px solid var(--border)',
      boxShadow: '0 4px 32px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.035)',
      maxWidth: 520,
      marginTop: 24,
    }}>
      <h3 style={{
        fontSize: 14, fontWeight: 700, color: 'var(--text-h)',
        letterSpacing: '-0.02em', marginBottom: 4,
      }}>Manage Categories</h3>
      <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 18 }}>
        Rename, reorder (drag the handle), or delete categories. A category can only be deleted
        once nothing references it.
      </p>

      {groups.map(group => {
        const gm = TYPE_META[group.type]
        return (
          <div key={group.type} style={{ marginBottom: 14 }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 7,
              padding: '4px 0',
            }}>
              <span style={{
                width: 6, height: 6, borderRadius: '50%',
                background: gm.color, flexShrink: 0,
                boxShadow: `0 0 5px ${gm.glow}`,
              }} />
              <span style={{
                fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
                letterSpacing: '0.1em', color: gm.color, opacity: 0.85,
              }}>
                {gm.label}
              </span>
            </div>

            {group.items.map(cat => (
              <div
                key={cat.id}
                draggable
                onDragStart={() => setDraggedId(cat.id)}
                onDragOver={e => e.preventDefault()}
                onDrop={() => handleDrop(group, cat)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '7px 0',
                  borderBottom: '1px solid var(--border)',
                }}
              >
                <GripVertical
                  size={14}
                  color="var(--text-muted)"
                  style={{ flexShrink: 0, cursor: 'grab' }}
                  aria-label={`Reorder ${cat.name}`}
                />
                <input
                  value={editedNames[cat.id] ?? cat.name}
                  onChange={e => setEditedNames(prev => ({ ...prev, [cat.id]: e.target.value }))}
                  onBlur={() => saveName(cat)}
                  onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                  aria-label={`${cat.name} name`}
                  style={{
                    flex: 1, minWidth: 0,
                    background: 'transparent', color: 'var(--text-h)',
                    border: '1px solid transparent',
                    borderRadius: 'var(--radius-sm)',
                    padding: '4px 6px', fontSize: 13, fontFamily: 'var(--sans)',
                    outline: 'none',
                  }}
                />
                <button
                  onClick={() => remove(cat)}
                  aria-label={`Delete ${cat.name}`}
                  style={{
                    background: 'transparent', color: 'var(--red)',
                    border: '1px solid rgba(248,113,113,0.3)',
                    borderRadius: 'var(--radius-sm)', width: 24, height: 24,
                    cursor: 'pointer', fontSize: 13, lineHeight: 1, flexShrink: 0,
                  }}
                >×</button>
              </div>
            ))}
          </div>
        )
      })}

      {error && <p style={{ fontSize: 12, color: 'var(--red)', margin: '10px 0' }}>{error}</p>}

      {showAdd ? (
        <div style={{ marginTop: 16 }}>
          <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
            <div style={{ flex: 2 }}>
              <label style={labelStyle}>Name</label>
              <input value={newName} onChange={e => setNewName(e.target.value)}
                placeholder="e.g. Pet Care" style={inputStyle} />
            </div>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>Type</label>
              <select
                value={newType}
                onChange={e => setNewType(e.target.value)}
                style={{ ...inputStyle, cursor: 'pointer' }}
              >
                {GROUP_ORDER.map(type => (
                  <option key={type} value={type}>{TYPE_META[type].label}</option>
                ))}
              </select>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={add} style={{
              background: 'linear-gradient(135deg, #4f46e5, #6366f1)',
              color: '#fff', border: 'none',
              borderRadius: 'var(--radius)', padding: '8px 16px',
              cursor: 'pointer', fontWeight: 600, fontSize: 12.5, fontFamily: 'var(--sans)',
            }}>Add</button>
            <button onClick={() => { setShowAdd(false); setError(''); setNewName(''); setNewType('needs') }} style={{
              background: 'transparent', color: 'var(--text-secondary)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius)', padding: '8px 16px',
              cursor: 'pointer', fontSize: 12.5, fontFamily: 'var(--sans)',
            }}>Cancel</button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setShowAdd(true)}
          style={{
            marginTop: 14,
            background: 'transparent', color: 'var(--text-secondary)',
            border: '1px dashed var(--border-strong)',
            borderRadius: 'var(--radius-sm)', padding: '6px 12px',
            cursor: 'pointer', fontSize: 12, fontFamily: 'var(--sans)',
          }}
        >
          + Add category
        </button>
      )}
    </div>
  )
}
