import type { Rule, Transaction } from '../types'

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
