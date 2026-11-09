import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { X } from 'lucide-react'
import { api } from '../api'
import type { Category, Rule, Transaction } from '../types'
import { describeApiError } from '../components/ErrorBanner'

export interface Suggestion {
  pattern: string
  categoryId: number
  count: number
  inReview: number
}

/** A description without its trailing digits and reference codes: "Albert Heijn 4471" -> "albert heijn". */
export function descriptionKey(description: string): string {
  const tokens = description.toLowerCase().trim().split(/\s+/)
  while (tokens.length > 0) {
    const t = tokens[tokens.length - 1]
    if (/\d/.test(t) || !/[\p{L}\p{N}]/u.test(t)) tokens.pop()
    else break
  }
  return tokens.join(' ')
}

const MIN_CHOSEN = 3
const MAX_SHOWN = 3

/**
 * Descriptions a person put in the same category by hand at least three times, that no rule covers.
 * A description that was put in two different categories by hand is not suggested: a rule would be a guess.
 */
export function findSuggestions(
  confirmed: Transaction[],
  inReview: Transaction[],
  rules: Rule[],
  dismissed: ReadonlySet<string>,
): Suggestion[] {
  const byKey = new Map<string, Map<number, number>>()
  for (const t of confirmed) {
    if (t.categorised_by !== 'manual' || t.category_id === null || t.splits.length > 0) continue
    const key = descriptionKey(t.description)
    if (key.length < 3) continue
    const cats = byKey.get(key) ?? new Map<number, number>()
    cats.set(t.category_id, (cats.get(t.category_id) ?? 0) + 1)
    byKey.set(key, cats)
  }
  const patterns = rules.map(r => r.pattern.toLowerCase().trim()).filter(Boolean)
  const found: Suggestion[] = []
  for (const [pattern, cats] of byKey) {
    if (cats.size !== 1 || dismissed.has(pattern)) continue
    const [[categoryId, count]] = [...cats]
    if (count < MIN_CHOSEN || patterns.some(p => pattern.includes(p))) continue
    found.push({
      pattern, categoryId, count,
      inReview: inReview.filter(t => t.description.toLowerCase().includes(pattern)).length,
    })
  }
  return found
    .sort((a, b) => b.count - a.count || b.inReview - a.inReview || a.pattern.localeCompare(b.pattern))
    .slice(0, MAX_SHOWN)
}

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
      await api.createRule({ pattern: s.pattern, category_id: s.categoryId, priority: 0 })
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
