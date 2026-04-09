# Budget Category Drill-Down Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add expandable transaction sub-tables to the Budget page so users can see which transactions make up a category's actual spend and reassign them inline.

**Architecture:** A new `CategoryTransactionList` component fetches and renders transactions for a given category+month. `Budget.tsx` tracks one expanded category in local state and renders `CategoryTransactionList` below the matching row. Recategorisation fires `PATCH /transactions/{id}` then invalidates TanStack Query keys so budget totals update automatically. No backend changes.

**Tech Stack:** React 19, TypeScript, TanStack Query v5, existing `api.ts` + `CategorySelect` component, inline styles (no CSS framework).

---

## File Map

| Action | File | What changes |
|--------|------|--------------|
| Create | `frontend/src/components/CategoryTransactionList.tsx` | New component: fetches + renders transaction sub-table |
| Create | `frontend/src/tests/CategoryTransactionList.test.tsx` | Unit tests for the new component |
| Modify | `frontend/src/pages/Budget.tsx` | Add expand state, chevron, render `CategoryTransactionList` |
| Modify | `frontend/src/tests/Budget.test.tsx` | Unit tests for expand/collapse behaviour (new file) |

---

## Task 1: `CategoryTransactionList` — tests first

**Files:**
- Create: `frontend/src/tests/CategoryTransactionList.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/tests/CategoryTransactionList.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import CategoryTransactionList from '../components/CategoryTransactionList'
import { api } from '../api'

vi.mock('../api', () => ({
  api: {
    getTransactions: vi.fn(),
    patchTransaction: vi.fn(),
    getCategories: vi.fn(),
  },
}))

const mockCategories = [
  { id: 3, name: 'Food - Essential', type: 'needs', sort_order: 1 },
  { id: 7, name: 'Miscellaneous', type: 'wants', sort_order: 9 },
]

const mockTransactions = [
  {
    id: 10, date: '2026-04-05', amount: -42.50, description: 'Albert Heijn supermarkt',
    source: 'ing', category_id: 3, category_name: 'Food - Essential',
    confirmed: true, categorised_by: 'rule', ai_confidence: null,
  },
  {
    id: 11, date: '2026-04-02', amount: -18.00, description: 'Jumbo',
    source: 'ing', category_id: 3, category_name: 'Food - Essential',
    confirmed: true, categorised_by: 'rule', ai_confidence: null,
  },
]

const wrap = (ui: React.ReactElement) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>)
}

describe('CategoryTransactionList', () => {
  beforeEach(() => {
    vi.mocked(api.getTransactions).mockResolvedValue(mockTransactions)
    vi.mocked(api.patchTransaction).mockResolvedValue({ id: 10, category_id: 7 })
    vi.mocked(api.getCategories).mockResolvedValue(mockCategories)
  })

  it('renders transactions for the category', async () => {
    wrap(
      <CategoryTransactionList
        categoryId={3}
        categoryName="Food - Essential"
        month="2026-04"
        categories={mockCategories}
      />
    )
    expect(await screen.findByText('Albert Heijn supermarkt')).toBeInTheDocument()
    expect(screen.getByText('Jumbo')).toBeInTheDocument()
  })

  it('fetches with correct params: category_id, month, confirmed=true', async () => {
    wrap(
      <CategoryTransactionList
        categoryId={3}
        categoryName="Food - Essential"
        month="2026-04"
        categories={mockCategories}
      />
    )
    await screen.findByText('Albert Heijn supermarkt')
    expect(api.getTransactions).toHaveBeenCalledWith({
      category_id: '3',
      month: '2026-04',
      confirmed: 'true',
    })
  })

  it('shows empty state when no transactions', async () => {
    vi.mocked(api.getTransactions).mockResolvedValue([])
    wrap(
      <CategoryTransactionList
        categoryId={3}
        categoryName="Food - Essential"
        month="2026-04"
        categories={mockCategories}
      />
    )
    expect(await screen.findByText(/no transactions this month/i)).toBeInTheDocument()
  })

  it('calls patchTransaction when category dropdown changes', async () => {
    wrap(
      <CategoryTransactionList
        categoryId={3}
        categoryName="Food - Essential"
        month="2026-04"
        categories={mockCategories}
      />
    )
    await screen.findByText('Albert Heijn supermarkt')
    // The component renders a native <select> per transaction row for test simplicity
    const selects = screen.getAllByRole('combobox')
    fireEvent.change(selects[0], { target: { value: '7' } })
    await waitFor(() => {
      expect(api.patchTransaction).toHaveBeenCalledWith(10, { category_id: 7, confirmed: true })
    })
  })

  it('renders a "View all in Transactions" link', async () => {
    wrap(
      <CategoryTransactionList
        categoryId={3}
        categoryName="Food - Essential"
        month="2026-04"
        categories={mockCategories}
      />
    )
    await screen.findByText('Albert Heijn supermarkt')
    const link = screen.getByRole('link', { name: /view all in transactions/i })
    expect(link).toHaveAttribute('href', '/transactions?category_id=3&month=2026-04')
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd frontend && npx vitest run src/tests/CategoryTransactionList.test.tsx
```

Expected: All tests fail with `Cannot find module '../components/CategoryTransactionList'`.

---

## Task 2: Implement `CategoryTransactionList`

**Files:**
- Create: `frontend/src/components/CategoryTransactionList.tsx`

- [ ] **Step 1: Create the component**

Create `frontend/src/components/CategoryTransactionList.tsx`:

```tsx
import { useState, useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api'
import type { Transaction, Category } from '../types'

interface Props {
  categoryId: number
  categoryName: string
  month: string // "YYYY-MM"
  categories: Category[]
}

/** Flash a green left-border on a row for 1.5s to confirm save. */
function useFlash() {
  const [flashId, setFlashId] = useState<number | null>(null)
  const flash = useCallback((id: number) => {
    setFlashId(id)
    setTimeout(() => setFlashId(null), 1500)
  }, [])
  return { flashId, flash }
}

export default function CategoryTransactionList({ categoryId, categoryName, month, categories }: Props) {
  const qc = useQueryClient()
  const { flashId, flash } = useFlash()

  const { data: transactions = [], isLoading, isError } = useQuery<Transaction[]>({
    queryKey: ['transactions', categoryId, month],
    queryFn: () => api.getTransactions({
      category_id: String(categoryId),
      month,
      confirmed: 'true',
    }),
  })

  const handleCategoryChange = async (tx: Transaction, newCategoryId: number) => {
    await api.patchTransaction(tx.id, { category_id: newCategoryId, confirmed: true })
    flash(tx.id)
    // Invalidate both the sub-table (tx disappears) and the budget totals
    qc.invalidateQueries({ queryKey: ['transactions', categoryId, month] })
    qc.invalidateQueries({ queryKey: ['budget', month] })
  }

  const cellStyle: React.CSSProperties = {
    padding: '10px 14px',
    fontSize: 12.5,
    verticalAlign: 'middle',
  }

  if (isLoading) {
    return (
      <div style={{ padding: '16px 14px', color: 'var(--text-muted)', fontSize: 12.5 }}>
        Loading transactions…
      </div>
    )
  }

  if (isError) {
    return (
      <div style={{ padding: '16px 14px', color: 'var(--red)', fontSize: 12.5 }}>
        Failed to load transactions.
      </div>
    )
  }

  return (
    <div style={{ background: '#1E293B', borderTop: '1px solid var(--border)' }}>
      {transactions.length === 0 ? (
        <div style={{
          padding: '20px 16px',
          textAlign: 'center',
          color: '#64748B',
          fontSize: 12.5,
        }}>
          No transactions this month
        </div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)' }}>
              {['Date', 'Description', 'Amount', 'Category'].map(h => (
                <th key={h} style={{
                  padding: '8px 14px',
                  textAlign: h === 'Amount' ? 'right' : 'left',
                  fontSize: 10, fontWeight: 700,
                  color: 'var(--text-label)',
                  textTransform: 'uppercase', letterSpacing: '0.08em',
                }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {transactions.map((tx, idx) => {
              const isFlashing = flashId === tx.id
              return (
                <tr
                  key={tx.id}
                  style={{
                    borderBottom: idx < transactions.length - 1 ? '1px solid rgba(148,163,184,0.07)' : 'none',
                    borderLeft: isFlashing ? '3px solid #22C55E' : '3px solid transparent',
                    transition: 'background 120ms ease, border-left-color 120ms ease',
                    background: 'transparent',
                  }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.04)' }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}
                >
                  {/* Date */}
                  <td style={{ ...cellStyle, color: 'var(--text-secondary)', whiteSpace: 'nowrap', width: 90 }}>
                    {tx.date}
                  </td>

                  {/* Description */}
                  <td style={{ ...cellStyle, color: 'var(--text-h)', maxWidth: 260 }}>
                    <span
                      title={tx.description}
                      style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                    >
                      {tx.description}
                    </span>
                  </td>

                  {/* Amount */}
                  <td style={{
                    ...cellStyle,
                    textAlign: 'right',
                    whiteSpace: 'nowrap',
                    fontFamily: 'var(--mono)',
                    fontVariantNumeric: 'tabular-nums',
                    color: tx.amount < 0 ? 'var(--red)' : 'var(--green)',
                    width: 100,
                  }}>
                    €{Math.abs(tx.amount).toFixed(2)}
                  </td>

                  {/* Category select */}
                  <td style={{ ...cellStyle, width: 200 }}>
                    <select
                      value={tx.category_id ?? ''}
                      onChange={e => handleCategoryChange(tx, Number(e.target.value))}
                      aria-label={`Category for ${tx.description}`}
                      style={{
                        background: 'var(--bg-input)',
                        color: 'var(--text-h)',
                        border: '1px solid var(--border-strong)',
                        borderRadius: 'var(--radius)',
                        padding: '5px 8px',
                        fontSize: 12,
                        fontFamily: 'var(--sans)',
                        cursor: 'pointer',
                        width: '100%',
                        outline: 'none',
                      }}
                      onFocus={e => { e.currentTarget.style.borderColor = 'var(--accent)' }}
                      onBlur={e => { e.currentTarget.style.borderColor = 'var(--border-strong)' }}
                    >
                      {categories.map(cat => (
                        <option key={cat.id} value={cat.id}>{cat.name}</option>
                      ))}
                    </select>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}

      {/* View all link */}
      <div style={{ padding: '10px 14px', textAlign: 'right' }}>
        <a
          href={`/transactions?category_id=${categoryId}&month=${month}`}
          style={{
            fontSize: 12, color: 'var(--text-muted)',
            textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4,
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = 'var(--text-secondary)' }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'var(--text-muted)' }}
        >
          View all in Transactions
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12h14M12 5l7 7-7 7" />
          </svg>
        </a>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Run tests — expect them all to pass**

```bash
cd frontend && npx vitest run src/tests/CategoryTransactionList.test.tsx
```

Expected output: 5 tests pass, 0 fail.

- [ ] **Step 3: Commit**

```bash
cd frontend && git add src/components/CategoryTransactionList.tsx src/tests/CategoryTransactionList.test.tsx && git commit -m "feat: add CategoryTransactionList component with tests"
```

---

## Task 3: Write Budget expand/collapse tests

**Files:**
- Create: `frontend/src/tests/Budget.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/tests/Budget.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import Budget from '../pages/Budget'
import { api } from '../api'

vi.mock('../api', () => ({
  api: {
    getBudget: vi.fn(),
    patchBudget: vi.fn(),
    getCategories: vi.fn(),
    getTransactions: vi.fn(),
    patchTransaction: vi.fn(),
  },
}))

const mockBudgetRows = [
  {
    id: 1, category_id: 3, category_name: 'Food - Essential',
    month: '2026-04', planned_amount: 400, actual_amount: 320,
  },
  {
    id: 2, category_id: 7, category_name: 'Miscellaneous',
    month: '2026-04', planned_amount: 100, actual_amount: 55,
  },
]

const mockCategories = [
  { id: 3, name: 'Food - Essential', type: 'needs', sort_order: 1 },
  { id: 7, name: 'Miscellaneous', type: 'wants', sort_order: 9 },
]

const wrap = (ui: React.ReactElement) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>)
}

describe('Budget page drill-down', () => {
  beforeEach(() => {
    vi.mocked(api.getBudget).mockResolvedValue(mockBudgetRows)
    vi.mocked(api.getCategories).mockResolvedValue(mockCategories)
    vi.mocked(api.getTransactions).mockResolvedValue([
      {
        id: 10, date: '2026-04-05', amount: -42.50, description: 'Albert Heijn',
        source: 'ing', category_id: 3, category_name: 'Food - Essential',
        confirmed: true, categorised_by: 'rule', ai_confidence: null,
      },
    ])
  })

  it('renders all category rows', async () => {
    wrap(<Budget />)
    expect(await screen.findByText('Food - Essential')).toBeInTheDocument()
    expect(screen.getByText('Miscellaneous')).toBeInTheDocument()
  })

  it('does not show transaction sub-table before any row is clicked', async () => {
    wrap(<Budget />)
    await screen.findByText('Food - Essential')
    expect(screen.queryByText('Albert Heijn')).not.toBeInTheDocument()
  })

  it('shows transaction sub-table when a row is clicked', async () => {
    wrap(<Budget />)
    const row = await screen.findByText('Food - Essential')
    fireEvent.click(row.closest('tr')!)
    expect(await screen.findByText('Albert Heijn')).toBeInTheDocument()
  })

  it('hides transaction sub-table when the same row is clicked again', async () => {
    wrap(<Budget />)
    const row = await screen.findByText('Food - Essential')
    const tr = row.closest('tr')!
    fireEvent.click(tr)
    await screen.findByText('Albert Heijn')
    fireEvent.click(tr)
    await waitFor(() => {
      expect(screen.queryByText('Albert Heijn')).not.toBeInTheDocument()
    })
  })

  it('only one category is expanded at a time', async () => {
    wrap(<Budget />)
    // Click first row
    const firstRow = (await screen.findByText('Food - Essential')).closest('tr')!
    fireEvent.click(firstRow)
    await screen.findByText('Albert Heijn')

    // Mock second category's transactions
    vi.mocked(api.getTransactions).mockResolvedValue([
      {
        id: 20, date: '2026-04-10', amount: -15.00, description: 'Random shop',
        source: 'revolut', category_id: 7, category_name: 'Miscellaneous',
        confirmed: true, categorised_by: 'manual', ai_confidence: null,
      },
    ])
    // Click second row
    const secondRow = screen.getByText('Miscellaneous').closest('tr')!
    fireEvent.click(secondRow)
    await screen.findByText('Random shop')

    // First category's transactions should be gone
    expect(screen.queryByText('Albert Heijn')).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd frontend && npx vitest run src/tests/Budget.test.tsx
```

Expected: Tests fail — `Budget` does not yet support expand behaviour.

---

## Task 4: Update `Budget.tsx` to support expand/collapse

**Files:**
- Modify: `frontend/src/pages/Budget.tsx`

- [ ] **Step 1: Add imports, state, and categories query**

Replace the top of `Budget.tsx` (lines 1–13) — the imports and opening of the component — with:

```tsx
import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api'
import CategoryTransactionList from '../components/CategoryTransactionList'

function currentMonth() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export default function Budget() {
  const [month, setMonth] = useState(currentMonth)
  const [editing, setEditing] = useState<Record<number, string>>({})
  const [expandedCategoryId, setExpandedCategoryId] = useState<number | null>(null)
  const qc = useQueryClient()

  const { data: rows = [] } = useQuery({
    queryKey: ['budget', month],
    queryFn: () => api.getBudget(month),
  })

  const { data: categories = [] } = useQuery({
    queryKey: ['categories'],
    queryFn: () => api.getCategories(),
  })
```

- [ ] **Step 2: Add the toggle handler**

After the `handleSave` function (after line 27 in the original), add:

```tsx
  const handleToggleExpand = (categoryId: number) => {
    setExpandedCategoryId(prev => prev === categoryId ? null : categoryId)
  }
```

- [ ] **Step 3: Update `renderRow` to accept `categoryId` and add the chevron + expand**

Replace the entire `renderRow` function (lines 32–168 in the original) with:

```tsx
  const renderRow = (row: any, idx: number, totalRows: number) => {
    const p = pct(row.actual_amount, row.planned_amount)
    const over = p > 100
    const warn = p > 80 && !over
    const isExpanded = expandedCategoryId === row.category_id

    let barGrad: string, barColor: string
    if (over) {
      barGrad = 'linear-gradient(90deg, #f87171, #ef4444)'
      barColor = 'var(--red)'
    } else if (warn) {
      barGrad = 'linear-gradient(90deg, #fbbf24, #f59e0b)'
      barColor = 'var(--yellow)'
    } else {
      barGrad = 'linear-gradient(90deg, #22c55e, #16a34a)'
      barColor = 'var(--green)'
    }

    const isLast = idx === totalRows - 1

    return (
      <>
        <tr
          key={row.id}
          onClick={() => handleToggleExpand(row.category_id)}
          style={{
            borderBottom: (!isExpanded && isLast) ? 'none' : '1px solid var(--border)',
            transition: 'background 0.12s ease',
            cursor: 'pointer',
            minHeight: 44,
          }}
          onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'rgba(99,102,241,0.05)'}
          onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = ''}
        >
          {/* Category name + chevron */}
          <td style={{ padding: '13px 16px', color: 'var(--text-h)', fontWeight: 500, fontSize: 13.5 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {row.category_name}
              <svg
                width="13" height="13" viewBox="0 0 24 24" fill="none"
                stroke="var(--text-muted)" strokeWidth="2.5"
                strokeLinecap="round" strokeLinejoin="round"
                aria-hidden="true"
                style={{
                  transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
                  transition: 'transform 200ms ease',
                  flexShrink: 0,
                }}
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </div>
          </td>

          {/* Planned — click to edit (stop propagation so row click doesn't fire) */}
          <td style={{ padding: '13px 16px', textAlign: 'right' }}>
            {row.id in editing ? (
              <input
                type="number"
                value={editing[row.id] ?? row.planned_amount}
                onChange={e => setEditing(prev => ({ ...prev, [row.id]: e.target.value }))}
                onBlur={() => handleSave(row.id)}
                onKeyDown={e => e.key === 'Enter' && handleSave(row.id)}
                onClick={e => e.stopPropagation()}
                autoFocus
                style={{
                  width: 96, background: 'var(--bg-input)', color: 'var(--text-h)',
                  border: '1px solid var(--accent)',
                  borderRadius: 'var(--radius)', padding: '6px 10px',
                  textAlign: 'right', fontSize: 13, fontFamily: 'var(--mono)',
                  outline: 'none', boxShadow: 'var(--shadow-input)',
                  fontVariantNumeric: 'tabular-nums',
                }}
              />
            ) : (
              <span
                onClick={e => {
                  e.stopPropagation()
                  setEditing(prev => ({ ...prev, [row.id]: String(row.planned_amount) }))
                }}
                title="Click to edit"
                style={{
                  cursor: 'pointer',
                  color: 'var(--text-secondary)',
                  padding: '5px 10px',
                  borderRadius: 'var(--radius)',
                  border: '1px solid transparent',
                  fontVariantNumeric: 'tabular-nums',
                  transition: 'all 0.15s ease',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  fontSize: 13.5,
                }}
                onMouseEnter={e => {
                  const el = e.currentTarget as HTMLElement
                  el.style.borderColor = 'var(--border-strong)'
                  el.style.color = 'var(--text-h)'
                  el.style.background = 'rgba(148,163,184,0.06)'
                }}
                onMouseLeave={e => {
                  const el = e.currentTarget as HTMLElement
                  el.style.borderColor = 'transparent'
                  el.style.color = 'var(--text-secondary)'
                  el.style.background = 'transparent'
                }}
              >
                €{Number(row.planned_amount).toFixed(2)}
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                </svg>
              </span>
            )}
          </td>

          {/* Actual */}
          <td style={{
            padding: '13px 16px', textAlign: 'right',
            color: over ? 'var(--red)' : 'var(--text-h)',
            fontWeight: 700, fontVariantNumeric: 'tabular-nums',
            fontFamily: 'var(--mono)', fontSize: 13,
          }}>
            €{(row.actual_amount ?? 0).toFixed(2)}
          </td>

          {/* Progress bar */}
          <td style={{ padding: '13px 16px', minWidth: 200 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{
                flex: 1, background: 'rgba(148,163,184,0.07)',
                borderRadius: 'var(--radius-full)', height: 8, overflow: 'hidden',
                position: 'relative',
              }}>
                <div style={{
                  height: '100%',
                  borderRadius: 'var(--radius-full)',
                  width: `${Math.min(p, 100)}%`,
                  background: barGrad,
                  transition: 'width 0.5s cubic-bezier(0.16, 1, 0.3, 1)',
                  boxShadow: over ? `0 0 8px ${barColor}80` : warn ? `0 0 6px rgba(251,191,36,0.5)` : 'none',
                  position: 'relative',
                  overflow: 'hidden',
                }}>
                  {/* Shimmer */}
                  <div style={{
                    position: 'absolute', inset: 0,
                    background: 'linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.2) 50%, rgba(255,255,255,0) 100%)',
                    transform: 'translateX(-100%)',
                    animation: 'shimmer 2.5s infinite',
                  }} />
                </div>
              </div>
              <span style={{
                fontSize: 11.5, fontWeight: 700,
                color: over ? 'var(--red)' : warn ? 'var(--yellow)' : 'var(--text-secondary)',
                minWidth: 38, textAlign: 'right',
                fontVariantNumeric: 'tabular-nums',
                fontFamily: 'var(--mono)',
              }}>{p}%</span>
            </div>
          </td>
        </tr>

        {/* Expanded sub-table row */}
        {isExpanded && (
          <tr key={`expand-${row.id}`}>
            <td colSpan={4} style={{ padding: 0, borderBottom: isLast ? 'none' : '1px solid var(--border)' }}>
              <CategoryTransactionList
                categoryId={row.category_id}
                categoryName={row.category_name}
                month={month}
                categories={categories}
              />
            </td>
          </tr>
        )}
      </>
    )
  }
```

- [ ] **Step 4: Update the subtitle hint text**

In the JSX return, update the `<p>` subtitle (currently "Click any planned amount to edit inline") to read:

```tsx
<p style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
  Click a row to see its transactions · Click the amount to edit the budget
</p>
```

- [ ] **Step 5: Update the `tbody` render call**

The `tbody` currently calls `renderRow` and wraps each result directly. Since `renderRow` now returns a fragment (`<>…</>`), the tbody render stays the same — but verify it still reads:

```tsx
<tbody>
  {rows.map((row, idx) => renderRow(row, idx, rows.length))}
</tbody>
```

No change needed here; confirm it already looks like this.

- [ ] **Step 5b: Verify TypeScript compiles**

```bash
cd frontend && npx tsc --noEmit
```

Expected: No errors. If TypeScript complains that `renderRow` returns `JSX.Element | JSX.Element[]`, add an explicit return type annotation to the function:

```tsx
const renderRow = (row: any, idx: number, totalRows: number): React.ReactElement => {
```

React accepts fragments as `React.ReactElement` so this annotation is correct.

- [ ] **Step 6: Run the Budget tests**

```bash
cd frontend && npx vitest run src/tests/Budget.test.tsx
```

Expected: All 5 tests pass.

- [ ] **Step 7: Run all frontend tests to confirm nothing broke**

```bash
cd frontend && npx vitest run
```

Expected: All tests pass (no regressions).

- [ ] **Step 8: Commit**

```bash
cd frontend && git add src/pages/Budget.tsx src/tests/Budget.test.tsx && git commit -m "feat: add budget category drill-down with inline recategorisation"
```

---

## Task 5: Manual smoke test

- [ ] **Step 1: Start backend**

```bash
cd backend && uvicorn main:app --reload
```

- [ ] **Step 2: Start frontend**

```bash
cd frontend && npm run dev
```

- [ ] **Step 3: Verify the following in the browser at http://localhost:5173/budget**

1. Each budget row shows a small chevron on the right side of the category name.
2. Clicking a row expands a sub-table showing that category's transactions for the selected month.
3. Clicking the same row again collapses the sub-table.
4. Clicking a different row collapses the first and expands the second.
5. The sub-table shows date, description (truncated if long), amount in red/green, and a category dropdown.
6. Changing the category dropdown immediately saves — the transaction disappears from the sub-table and the actual amount on both the source and destination rows updates.
7. A green left-border flash appears briefly on the row being saved.
8. An empty state message "No transactions this month" appears for categories with no confirmed transactions.
9. The "View all in Transactions →" link navigates to `/transactions?category_id=<id>&month=<YYYY-MM>`.
10. Clicking a planned amount to edit it still works (does not trigger the row expand).

- [ ] **Step 4: Commit smoke test confirmation (no code changes needed)**

If all smoke test points pass, no further commit is needed. The implementation is complete.
