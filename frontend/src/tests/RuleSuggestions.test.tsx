import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import RuleSuggestions, { descriptionKey, findSuggestions } from '../pages/RuleSuggestions'
import Rules from '../pages/Rules'
import type { Rule, Transaction } from '../types'

const tx = (id: number, description: string, category_id: number | null, over: Partial<Transaction> = {}): Transaction => ({
  id, date: '2026-11-01', description, amount_cents: -1000, source: 'ing', category_id, category_name: null,
  confirmed: true, categorised_by: 'manual', ai_confidence: null, is_refund: false, set_aside_id: null, set_aside_name: null, splits: [],
  ...over,
})
const many = (desc: string, cat: number, n: number, start = 1) =>
  Array.from({ length: n }, (_, i) => tx(start + i, `${desc} ${i}${i}7`, cat))

describe('descriptionKey', () => {
  it('drops trailing digits and reference codes', () => {
    expect(descriptionKey('Albert Heijn 4471')).toBe('albert heijn')
    expect(descriptionKey('Etsy.com  A1B2  #')).toBe('etsy.com')
    expect(descriptionKey('1234')).toBe('')
  })
})

describe('findSuggestions', () => {
  const none = new Set<string>()
  it('needs three manual choices in one category', () => {
    expect(findSuggestions(many('Bakker', 3, 2), [], [], none)).toEqual([])
    expect(findSuggestions(many('Bakker', 3, 3), [], [], none)).toMatchObject([{ pattern: 'bakker', categoryId: 3, count: 3 }])
  })
  it('ignores rule and AI categorised rows', () => {
    const rows = many('Bakker', 3, 3).map(t => ({ ...t, categorised_by: 'rule' as const }))
    expect(findSuggestions(rows, [], [], none)).toEqual([])
  })
  it('skips a description chosen for two categories, covered by a rule, or dismissed', () => {
    const mixed = [...many('Amazon', 3, 3), ...many('Amazon', 4, 1, 50)]
    expect(findSuggestions(mixed, [], [], none)).toEqual([])
    const rule = { id: 1, pattern: 'bakker', category_id: 3, category_name: 'x' } as Rule
    expect(findSuggestions(many('Bakker Utrecht', 3, 3), [], [rule], none)).toEqual([])
    expect(findSuggestions(many('Bakker', 3, 3), [], [], new Set(['bakker']))).toEqual([])
  })
  it('counts review items it would match and shows at most three, most chosen first', () => {
    const rows = [...many('aaa', 1, 3), ...many('bbb', 1, 5, 10), ...many('ccc', 1, 4, 20), ...many('ddd', 1, 6, 30)]
    const review = [tx(99, 'DDD 12', null, { confirmed: false })]
    const out = findSuggestions(rows, review, [], none)
    expect(out.map(s => s.pattern)).toEqual(['ddd', 'bbb', 'ccc'])
    expect(out[0].inReview).toBe(1)
  })
})

const mockApi = vi.hoisted(() => ({
  getTransactions: vi.fn(),
  createRule: vi.fn(() => Promise.resolve({})),
  getRules: vi.fn(() => Promise.resolve([])),
  getCategories: vi.fn(() => Promise.resolve([{ id: 3, name: 'Food', type: 'needs', sort_order: 1 }])),
  deleteRule: vi.fn(() => Promise.resolve({})),
}))
vi.mock('../api', async importOriginal => ({ ...(await importOriginal<typeof import('../api')>()), api: mockApi }))

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>)
}

describe('RuleSuggestions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    mockApi.getTransactions.mockImplementation((p: Record<string, string>) =>
      Promise.resolve(p.confirmed === 'true' ? many('Bakker', 3, 4) : []))
  })

  it('offers a rule, adds it, and can be dismissed', async () => {
    const cats = [{ id: 3, name: 'Food', type: 'needs' as const, sort_order: 1 }]
    wrap(<RuleSuggestions rules={[]} categories={cats} />)
    expect(await screen.findByText('bakker')).toBeTruthy()
    expect(screen.getByText(/Food · chosen 4 times/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Add rule' }))
    await waitFor(() => expect(mockApi.createRule).toHaveBeenCalledWith({ pattern: 'bakker', category_id: 3 }))
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss bakker' }))
    await waitFor(() => expect(screen.queryByText('bakker')).toBeNull())
    expect(localStorage.getItem('finances.dismissed-rule-suggestions')).toBe('["bakker"]')
  })

  it('shows nothing when there is nothing to suggest', async () => {
    mockApi.getTransactions.mockImplementation(() => Promise.resolve([]))
    wrap(<RuleSuggestions rules={[]} categories={[]} />)
    await waitFor(() => expect(mockApi.getTransactions).toHaveBeenCalledTimes(2))
    expect(screen.queryByText('From your corrections')).toBeNull()
  })
})

describe('Rules', () => {
  it('deletes a rule from a named icon button', async () => {
    mockApi.getTransactions.mockImplementation(() => Promise.resolve([]))
    mockApi.getRules.mockImplementation(() => Promise.resolve([{ id: 7, pattern: 'jumbo', category_id: 3, category_name: 'Food' }] as never))
    wrap(<Rules />)
    fireEvent.click(await screen.findByRole('button', { name: 'Delete jumbo' }))
    await waitFor(() => expect(mockApi.deleteRule).toHaveBeenCalledWith(7))
  })
})
