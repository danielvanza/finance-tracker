import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Trash2 } from 'lucide-react'
import { api, ApiError, BASE } from '../api'
import ErrorBanner, { describeApiError } from '../components/ErrorBanner'
import CategorySelect from '../components/CategorySelect'
import RuleSuggestions from './RuleSuggestions'

export default function Rules() {
  const qc = useQueryClient()
  const [newPattern, setNewPattern] = useState('')
  const [newCategory, setNewCategory] = useState<number | null>(null)
  const [editing, setEditing] = useState<Record<number, { pattern: string; category_id: number }>>({})
  const [error, setError] = useState('')

  const rulesQuery = useQuery({ queryKey: ['rules'], queryFn: api.getRules })
  const rules = rulesQuery.data ?? []
  const { data: categories = [] } = useQuery({ queryKey: ['categories'], queryFn: api.getCategories })

  const handleCreate = async () => {
    if (!newPattern || !newCategory) return
    try {
      await api.createRule({ pattern: newPattern, category_id: newCategory })
    } catch (e) {
      setError(describeApiError(e)); return
    }
    qc.invalidateQueries({ queryKey: ['rules'] })
    setNewPattern('')
  }

  const handleDelete = async (id: number) => {
    try {
      await api.deleteRule(id)
    } catch (e) {
      setError(describeApiError(e)); return
    }
    qc.invalidateQueries({ queryKey: ['rules'] })
  }

  const handleSaveEdit = async (id: number) => {
    const e = editing[id]
    if (!e) return
    try {
      const res = await fetch(`${BASE}/rules/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pattern: e.pattern, category_id: e.category_id }),
      })
      if (!res.ok) {
        let detail: string | null = null
        try { detail = (await res.json()).detail ?? null } catch { /* non-JSON body */ }
        throw new ApiError(res.status, detail ?? (res.statusText || `Request failed (${res.status})`), detail)
      }
    } catch (err) {
      setError(describeApiError(err instanceof ApiError ? err : new ApiError(0, 'Network error', null)))
      return
    }
    qc.invalidateQueries({ queryKey: ['rules'] })
    setEditing(prev => { const n = { ...prev }; delete n[id]; return n })
  }

  const canCreate = Boolean(newPattern && newCategory)

  return (
    <section className="section">
      <h2>Rules</h2>

      {error && <ErrorBanner message={error} onDismiss={() => setError('')} />}

      {rulesQuery.isSuccess && <RuleSuggestions rules={rules} categories={categories} />}

      <div className="panel setup-rule-form">
        <div className="form-row">
          <label className="lab" htmlFor="rule-pattern">Description contains</label>
          <input
            id="rule-pattern"
            className="field setup-mono"
            value={newPattern}
            onChange={e => setNewPattern(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleCreate()}
            placeholder="e.g. albert heijn"
          />
        </div>
        <div className="form-row">
          <span className="lab">Category</span>
          <CategorySelect
            categories={categories}
            value={newCategory}
            onChange={setNewCategory}
            placeholder="Select category…"
          />
        </div>
        <button type="button" className="btn" onClick={handleCreate} disabled={!canCreate}>
          Add rule
        </button>
      </div>

      {rulesQuery.isLoading && <span className="skeleton setup-skeleton" aria-busy="true" aria-label="Loading rules" />}
      {rulesQuery.isError && <ErrorBanner message={describeApiError(rulesQuery.error)} />}

      {rulesQuery.isSuccess && (
        <div className="panel setup-table-panel">
          <table className="table card-table rules-table">
            <thead>
              <tr>
                <th>Description contains</th>
                <th>Category</th>
                <th className="right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rules.map(rule => {
                const e = editing[rule.id]
                return (
                  <tr key={rule.id} className={e ? 'is-editing' : undefined}>
                    <td>
                      {e ? (
                        <input
                          className="field setup-mono"
                          aria-label={`Pattern for ${rule.pattern}`}
                          value={e.pattern}
                          onChange={ev => setEditing(prev => ({ ...prev, [rule.id]: { ...prev[rule.id], pattern: ev.target.value } }))}
                        />
                      ) : (
                        <code className="setup-code">{rule.pattern}</code>
                      )}
                    </td>
                    <td>
                      {e ? (
                        <CategorySelect
                          categories={categories}
                          value={e.category_id}
                          onChange={v => setEditing(prev => ({ ...prev, [rule.id]: { ...prev[rule.id], category_id: v } }))}
                          compact
                        />
                      ) : (
                        rule.category_name
                      )}
                    </td>
                    <td>
                      <div className="setup-actions">
                        {e ? (
                          <>
                            <button type="button" className="btn btn-sm" onClick={() => handleSaveEdit(rule.id)}>Save</button>
                            <button
                              type="button"
                              className="btn btn-sm"
                              onClick={() => setEditing(prev => { const n = { ...prev }; delete n[rule.id]; return n })}
                            >
                              Cancel
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              type="button"
                              className="btn btn-sm"
                              onClick={() => setEditing(prev => ({ ...prev, [rule.id]: { pattern: rule.pattern, category_id: rule.category_id } }))}
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              className="btn btn-sm btn-danger setup-icon"
                              onClick={() => handleDelete(rule.id)}
                              aria-label={`Delete ${rule.pattern}`}
                            >
                              <Trash2 size={15} aria-hidden="true" />
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
                  <td colSpan={3}>
                    <p className="empty">No rules yet. Add a pattern above to categorise transactions automatically.</p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
