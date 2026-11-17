import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { X } from 'lucide-react'
import { api } from '../api'
import type { Category, Rule } from '../types'
import { describeApiError } from '../components/apiError'

import { findSuggestions, type Suggestion } from './ruleSuggestions'

const STORE = 'finances.dismissed-rule-suggestions'
const loadDismissed = (): Set<string> => {
  try { return new Set(JSON.parse(localStorage.getItem(STORE) ?? '[]')) } catch { return new Set() }
}

/** A quiet offer above the Add rule form. It shows nothing when there is nothing to suggest. */

export default function RuleSuggestions({ rules, categories }: { rules: Rule[]; categories: Category[] }) {
  const qc = useQueryClient()
  const [dismissed, setDismissed] = useState(loadDismissed)
  const [error, setError] = useState('')
  const confirmedQuery = useQuery({
    queryKey: ['transactions', 'suggest-confirmed'],
    queryFn: () => api.getTransactions({ confirmed: 'true' }),
  })
  const reviewQuery = useQuery({
    queryKey: ['transactions', 'suggest-review'],
    queryFn: () => api.getTransactions({ confirmed: 'false' }),
  })

  const suggestions = findSuggestions(confirmedQuery.data ?? [], reviewQuery.data ?? [], rules, dismissed)
  if (suggestions.length === 0) return null

  const dismiss = (pattern: string) => {
    const next = new Set(dismissed).add(pattern)
    setDismissed(next)
    try { localStorage.setItem(STORE, JSON.stringify([...next])) } catch { /* private mode: it comes back next visit */ }
  }
  const add = async (s: Suggestion) => {
    setError('')
    try {
      await api.createRule({ pattern: s.pattern, category_id: s.categoryId })
    } catch (e) {
      setError(describeApiError(e)); return
    }
    qc.invalidateQueries({ queryKey: ['rules'] })
  }

  return (
    <div className="panel setup-panel rs-panel">
      <h3>From your corrections</h3>
      <p className="setup-note">You gave these the same category by hand each time. A rule does it for you next time.</p>
      <ul className="rs-list">
        {suggestions.map(s => (
          <li className="rs-row" key={s.pattern}>
            <div className="rs-text">
              <code className="setup-code">{s.pattern}</code>
              <small>
                {categories.find(c => c.id === s.categoryId)?.name ?? 'Category'} · chosen {s.count} times
                {s.inReview > 0 && ` · ${s.inReview} in review would match`}
              </small>
            </div>
            <div className="rs-actions">
              <button type="button" className="btn btn-sm" onClick={() => add(s)}>Add rule</button>
              <button type="button" className="btn btn-sm btn-danger setup-icon" onClick={() => dismiss(s.pattern)}
                aria-label={`Dismiss ${s.pattern}`}>
                <X size={15} aria-hidden="true" />
              </button>
            </div>
          </li>
        ))}
      </ul>
      {error && <p role="alert" className="setup-error">{error}</p>}
    </div>
  )
}
