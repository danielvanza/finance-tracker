import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { GripVertical, Plus, Trash2 } from 'lucide-react'
import { api } from '../api'
import type { Category } from '../types'
import { ApiError } from '../api'
import ErrorBanner, { describeApiError } from './ErrorBanner'
import { TYPE_META, GROUP_ORDER } from './CategorySelect'

export default function CategoryManager() {
  const qc = useQueryClient()
  const categoriesQuery = useQuery({
    queryKey: ['categories'],
    queryFn: api.getCategories,
  })
  const categories = categoriesQuery.data ?? []

  const [listOpen, setListOpen] = useState(false)
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
    try {
      await api.patchCategory(cat.id, { name: trimmed })
    } catch (e) {
      setError(describeApiError(e))
      return
    }
    setEditedNames(prev => { const { [cat.id]: _, ...rest } = prev; return rest })
    invalidate()
  }

  /** What a category counts as. One that is in use is only changed after a second look, as its payments move with it. */
  const changeType = async (cat: Category, type: string) => {
    if (type === cat.type) return
    setError('')
    try {
      await api.patchCategory(cat.id, { type })
    } catch (e) {
      const inUse = e instanceof ApiError && e.status === 422 && (e.detail ?? '').includes('in use')
      if (!inUse) { setError(describeApiError(e)); return }
      const label = TYPE_META[type as keyof typeof TYPE_META].label
      if (!window.confirm(`"${cat.name}" already has payments or rules. Count it as ${label} from now on? Everything in it, in past months too, then counts as ${label}.`)) return
      try {
        await api.patchCategory(cat.id, { type, force: true })
      } catch (again) {
        setError(describeApiError(again))
        return
      }
    }
    invalidate()
    qc.invalidateQueries({ queryKey: ['pace'] })
  }

  const remove = async (cat: Category) => {
    if (!window.confirm(`Delete category "${cat.name}"?`)) return
    try {
      await api.deleteCategory(cat.id)
    } catch (e) {
      setError(describeApiError(e))
      return
    }
    invalidate()
  }

  const add = async () => {
    setError('')
    const trimmed = newName.trim()
    if (!trimmed) { setError('Name is required'); return }
    try {
      await api.createCategory({ name: trimmed, type: newType })
    } catch (e) {
      setError(describeApiError(e)); return
    }
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
    try {
      await api.reorderCategories(ids)
      invalidate()
    } catch (e) {
      setError(describeApiError(e))
    }
  }

  return (
    <section className="section">
      <h2>Categories</h2>

      {categoriesQuery.isLoading && <span className="skeleton setup-skeleton" aria-busy="true" aria-label="Loading categories" />}
      {categoriesQuery.isError && <ErrorBanner message={describeApiError(categoriesQuery.error)} />}

      {categoriesQuery.isSuccess && (
        <div className={`panel setup-panel cat-panel${listOpen ? ' is-open' : ''}`}>
          <p className="setup-note">Drag to reorder. A category can only be deleted once nothing uses it.</p>

          {categories.length === 0 && <p className="empty">No categories yet.</p>}
          {categories.length > 0 && (
            <button type="button" className="btn cat-toggle" aria-expanded={listOpen} onClick={() => setListOpen(v => !v)}>
              {listOpen ? 'Hide categories' : `Show all ${categories.length} categories`}
            </button>
          )}

          {groups.map(group => (
            <div className="setup-group" key={group.type}>
              <h3>{TYPE_META[group.type].label}</h3>
              {group.items.map(cat => (
                <div
                  key={cat.id}
                  className="setup-cat"
                  draggable
                  onDragStart={() => setDraggedId(cat.id)}
                  onDragOver={e => e.preventDefault()}
                  onDrop={() => handleDrop(group, cat)}
                >
                  <GripVertical size={16} className="setup-grip" aria-label={`Reorder ${cat.name}`} />
                  <input
                    className="setup-name"
                    value={editedNames[cat.id] ?? cat.name}
                    onChange={e => setEditedNames(prev => ({ ...prev, [cat.id]: e.target.value }))}
                    onBlur={() => saveName(cat)}
                    onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                    aria-label={`${cat.name} name`}
                  />
                  <select
                    className="field setup-type"
                    value={cat.type}
                    onChange={e => changeType(cat, e.target.value)}
                    aria-label={`${cat.name} counts as`}
                  >
                    {GROUP_ORDER.map(type => (
                      <option key={type} value={type}>{TYPE_META[type].label}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="btn btn-sm btn-danger setup-icon"
                    onClick={() => remove(cat)}
                    aria-label={`Delete ${cat.name}`}
                  >
                    <Trash2 size={15} aria-hidden="true" />
                  </button>
                </div>
              ))}
            </div>
          ))}

          {error && <p role="alert" className="setup-error">{error}</p>}

          {showAdd ? (
            <div className="setup-add-form">
              <div className="setup-form">
                <div className="form-row">
                  <label className="lab" htmlFor="new-category-name">Name</label>
                  <input
                    id="new-category-name"
                    className="field"
                    value={newName}
                    onChange={e => setNewName(e.target.value)}
                    placeholder="e.g. Pet Care"
                  />
                </div>
                <div className="form-row">
                  <label className="lab" htmlFor="new-category-type">Type</label>
                  <select
                    id="new-category-type"
                    className="field"
                    value={newType}
                    onChange={e => setNewType(e.target.value)}
                  >
                    {GROUP_ORDER.map(type => (
                      <option key={type} value={type}>{TYPE_META[type].label}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="setup-form-actions">
                <button type="button" className="btn" onClick={add}>Add category</button>
                <button
                  type="button"
                  className="btn"
                  onClick={() => { setShowAdd(false); setError(''); setNewName(''); setNewType('needs') }}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button type="button" className="btn" onClick={() => setShowAdd(true)}>
              <Plus size={15} aria-hidden="true" />
              Add category
            </button>
          )}
        </div>
      )}
    </section>
  )
}
