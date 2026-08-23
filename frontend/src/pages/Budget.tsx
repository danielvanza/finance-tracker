import React, { useState, useRef, useEffect } from 'react'
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query'
import { api } from '../api'
import { formatCents, parseToCents, centsToInputString, sumCents } from '../money'
import type { Category, Transaction } from '../types'
import CategorySelect from '../components/CategorySelect'

// ── Category type pill + inline dropdown ─────────────────────────────────────
const TYPE_CFG: Record<string, { label: string; color: string; bg: string; border: string }> = {
  needs:   { label: 'Needs',   color: '#60a5fa', bg: 'rgba(96,165,250,0.1)',  border: 'rgba(96,165,250,0.22)'  },
  wants:   { label: 'Wants',   color: '#a78bfa', bg: 'rgba(167,139,250,0.1)', border: 'rgba(167,139,250,0.22)' },
  savings: { label: 'Savings', color: '#22c55e', bg: 'rgba(34,197,94,0.1)',   border: 'rgba(34,197,94,0.22)'   },
}
const TYPE_OPTIONS = ['needs', 'wants', 'savings'] as const

interface TypeCellProps {
  categoryId: number
  type: string
  onSaved: () => void
}

function TypeCell({ categoryId, type, onSaved }: TypeCellProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const cfg = TYPE_CFG[type]

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const handleSelect = async (newType: string) => {
    setOpen(false)
    if (newType === type) return
    await api.patchCategory(categoryId, { type: newType })
    onSaved()
  }

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block' }} onClick={e => e.stopPropagation()}>
      <button
        onClick={() => setOpen(o => !o)}
        title="Click to change type"
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 4,
          fontSize: 10, fontWeight: 700, letterSpacing: '0.06em',
          textTransform: 'uppercase',
          color: cfg?.color ?? 'var(--text-muted)',
          background: cfg?.bg ?? 'transparent',
          border: `1px solid ${cfg?.border ?? 'var(--border)'}`,
          borderRadius: 'var(--radius-full)',
          padding: '2px 8px 2px 7px',
          lineHeight: '16px',
          cursor: 'pointer',
          transition: 'filter 0.15s ease, box-shadow 0.15s ease',
        }}
        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.filter = 'brightness(1.2)'; (e.currentTarget as HTMLElement).style.boxShadow = `0 0 8px ${cfg?.border ?? 'transparent'}` }}
        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.filter = ''; (e.currentTarget as HTMLElement).style.boxShadow = '' }}
      >
        {cfg?.label ?? type}
        {/* chevron */}
        <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.7, marginTop: 1 }}>
          <path d="M6 9l6 6 6-6"/>
        </svg>
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 5px)', left: 0, zIndex: 'var(--z-overlay)' as any,
          background: 'var(--bg-card)',
          border: '1px solid var(--border-strong)',
          borderRadius: 'var(--radius)',
          boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
          overflow: 'hidden',
          minWidth: 100,
          animation: 'categoryDropIn 0.12s var(--ease-out) both',
        }}>
          {TYPE_OPTIONS.map(opt => {
            const c = TYPE_CFG[opt]
            const active = opt === type
            return (
              <button
                key={opt}
                onClick={() => handleSelect(opt)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  width: '100%', padding: '8px 12px',
                  background: active ? 'rgba(148,163,184,0.06)' : 'transparent',
                  border: 'none', cursor: 'pointer',
                  color: c.color, fontSize: 11, fontWeight: 700,
                  letterSpacing: '0.06em', textTransform: 'uppercase',
                  textAlign: 'left',
                  transition: 'background 0.1s',
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(148,163,184,0.08)' }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = active ? 'rgba(148,163,184,0.06)' : 'transparent' }}
              >
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: c.color, flexShrink: 0 }} />
                {c.label}
                {active && (
                  <svg style={{ marginLeft: 'auto' }} width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 6L9 17l-5-5"/>
                  </svg>
                )}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Loading skeleton ──────────────────────────────────────────────────────────
function LoadingSkeleton() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {[0, 1, 2].map(i => (
        <div key={i} style={{
          height: 28, borderRadius: 'var(--radius)',
          background: 'var(--bg-input)',
          animation: 'pulse 1.5s ease-in-out infinite',
          opacity: 0.6 - i * 0.15,
        }} />
      ))}
    </div>
  )
}

// ── Single transaction drill row ──────────────────────────────────────────────
interface TransactionDrillRowProps {
  tx: Transaction
  categories: Category[]
  onRecategorise: (txId: number, newCategoryId: number) => void
}

function TransactionDrillRow({ tx, categories, onRecategorise }: TransactionDrillRowProps) {
  const filteredCategories = categories.filter(c => {
    if (c.type === 'exclude') return true
    return c.type !== 'income'
  })

  return (
    <tr style={{ borderBottom: '1px solid rgba(148,163,184,0.07)' }}>
      <td style={{ padding: '5px 8px', color: 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums' }}>
        {tx.date}
      </td>
      <td style={{ padding: '5px 8px', color: 'var(--text-h)', maxWidth: 340, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {tx.description}
      </td>
      <td style={{ padding: '5px 8px', textAlign: 'right', color: tx.amount_cents < 0 ? 'var(--red)' : 'var(--green)', fontVariantNumeric: 'tabular-nums', fontFamily: 'var(--mono)' }}>
        {tx.amount_cents < 0 ? '-' : '+'}{formatCents(Math.abs(tx.amount_cents))}
      </td>
      <td style={{ padding: '5px 8px', minWidth: 200 }} onClick={e => e.stopPropagation()}>
        <CategorySelect
          categories={filteredCategories}
          value={tx.category_id}
          onChange={(newId) => onRecategorise(tx.id, newId)}
          compact
        />
      </td>
    </tr>
  )
}

// ── Expanded drill-down sub-row ───────────────────────────────────────────────
interface DrillDownRowProps {
  categoryId: number
  categoryName: string
  month: string
  categories: Category[]
  onRecategorise: (txId: number, newCategoryId: number) => void
}

function DrillDownRow({ categoryId, categoryName, month, categories, onRecategorise }: DrillDownRowProps) {
  const { data: txs = [], isLoading } = useQuery({
    queryKey: ['transactions', { category_id: categoryId, month }],
    queryFn: () => api.getTransactions({
      category_id: String(categoryId),
      month,
      confirmed: 'true',
    }),
  })

  return (
    <tr>
      <td colSpan={5} style={{
        padding: 0,
        background: 'rgba(99,102,241,0.03)',
        borderBottom: '2px solid var(--accent)',
      }}>
        <div style={{ padding: '12px 20px 16px' }}>
          <div style={{
            fontSize: 11.5, fontWeight: 700, textTransform: 'uppercase',
            letterSpacing: '0.08em', color: 'var(--text-label)', marginBottom: 10,
          }}>
            {categoryName} — {month}
          </div>

          {isLoading && <LoadingSkeleton />}

          {!isLoading && txs.length === 0 && (
            <div style={{ color: 'var(--text-muted)', fontSize: 12.5, padding: '8px 0' }}>
              No confirmed transactions this month.
            </div>
          )}

          {!isLoading && txs.length > 0 && (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  <th style={{ textAlign: 'left', padding: '4px 8px', color: 'var(--text-label)', fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Date</th>
                  <th style={{ textAlign: 'left', padding: '4px 8px', color: 'var(--text-label)', fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Description</th>
                  <th style={{ textAlign: 'right', padding: '4px 8px', color: 'var(--text-label)', fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Amount</th>
                  <th style={{ textAlign: 'left', padding: '4px 8px', color: 'var(--text-label)', fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', minWidth: 200 }}>Category</th>
                </tr>
              </thead>
              <tbody>
                {txs.map(tx => (
                  <TransactionDrillRow
                    key={tx.id}
                    tx={tx}
                    categories={categories}
                    onRecategorise={onRecategorise}
                  />
                ))}
              </tbody>
            </table>
          )}
        </div>
      </td>
    </tr>
  )
}



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

  const { data: dashboard } = useQuery({
    queryKey: ['dashboard', month],
    queryFn: () => api.getDashboard(month),
  })

  const totalPlanned = sumCents(rows.map(r => r.planned_amount_cents))
  const totalActual = sumCents(rows.map(r => r.actual_amount_cents ?? 0))
  const totalIncome = dashboard?.total_income_cents ?? 0
  const spendPct = totalIncome > 0 ? Math.round((totalActual / totalIncome) * 100) : null

  const handleSave = async (id: number) => {
    const val = parseToCents(editing[id] ?? '')
    if (val !== null) {
      await api.patchBudget(id, val)
      qc.invalidateQueries({ queryKey: ['budget', month] })
    }
    setEditing(e => { const n = { ...e }; delete n[id]; return n })
  }

  const recategoriseMutation = useMutation({
    mutationFn: ({ txId, newCategoryId }: { txId: number; newCategoryId: number }) =>
      api.patchTransaction(txId, { category_id: newCategoryId }),
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: ['transactions', { category_id: expandedCategoryId, month }],
      })
      qc.invalidateQueries({ queryKey: ['budget', month] })
    },
  })

  const handleRecategorise = (txId: number, newCategoryId: number) =>
    recategoriseMutation.mutate({ txId, newCategoryId })

  const pct = (actual: number | null, planned: number) =>
    planned > 0 && actual != null ? Math.round((actual / planned) * 100) : 0

  const renderRow = (row: any, idx: number, totalRows: number) => {
    const p = pct(row.actual_amount_cents, row.planned_amount_cents)
    const over = p > 100
    const warn = p > 80 && !over

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

    const isExpanded = expandedCategoryId === row.category_id

    return (
      <React.Fragment key={row.id}>
        <tr
          onClick={() =>
            setExpandedCategoryId(prev =>
              prev === row.category_id ? null : row.category_id
            )
          }
          style={{
            borderBottom: !isExpanded && idx < totalRows - 1 ? '1px solid var(--border)' : 'none',
            transition: 'background 0.12s ease',
            cursor: 'pointer',
          }}
          onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'rgba(99,102,241,0.03)'}
          onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = ''}
        >
        <td style={{ padding: '13px 16px', color: 'var(--text-h)', fontWeight: 500, fontSize: 13.5 }}>
          {row.category_name}
        </td>

        {/* Type — clickable pill dropdown */}
        <td style={{ padding: '13px 16px' }}>
          <TypeCell
            categoryId={row.category_id}
            type={row.category_type}
            onSaved={() => {
              qc.invalidateQueries({ queryKey: ['categories'] })
              qc.invalidateQueries({ queryKey: ['budget', month] })
            }}
          />
        </td>

        {/* Planned — click to edit */}
        <td style={{ padding: '13px 16px', textAlign: 'right' }}>
          {row.id in editing ? (
            <input
              type="number"
              value={editing[row.id] ?? centsToInputString(row.planned_amount_cents)}
              onChange={e => setEditing(prev => ({ ...prev, [row.id]: e.target.value }))}
              onBlur={() => handleSave(row.id)}
              onKeyDown={e => e.key === 'Enter' && handleSave(row.id)}
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
              onClick={() => setEditing(prev => ({ ...prev, [row.id]: centsToInputString(row.planned_amount_cents) }))}
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
              {formatCents(row.planned_amount_cents)}
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
              </svg>
            </span>
          )}
        </td>

        {/* Actual — negative means refunded more than spent this month */}
        <td style={{
          padding: '13px 16px', textAlign: 'right',
          color: (row.actual_amount_cents ?? 0) < 0 ? 'var(--green)' : over ? 'var(--red)' : 'var(--text-h)',
          fontWeight: 700, fontVariantNumeric: 'tabular-nums',
          fontFamily: 'var(--mono)', fontSize: 13,
        }}>
          {(row.actual_amount_cents ?? 0) < 0 ? '-' : ''}{formatCents(Math.abs(row.actual_amount_cents ?? 0))}
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
                width: `${Math.max(0, Math.min(p, 100))}%`,
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
      {isExpanded && (
        <DrillDownRow
          categoryId={row.category_id}
          categoryName={row.category_name}
          month={month}
          categories={categories}
          onRecategorise={handleRecategorise}
        />
      )}
    </React.Fragment>
  )
}

  return (
    <div className="animate-fade-in">
      {/* Page header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 28 }}>
        <div>
          <h1 style={{ marginBottom: 4 }}>Budget</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: 13 }}>Click a category to see transactions • Click planned amount to edit</p>
        </div>
        <input
          type="month" value={month} onChange={e => setMonth(e.target.value)}
          style={{
            background: 'var(--bg-card)', color: 'var(--text-h)',
            border: '1px solid var(--border-strong)',
            borderRadius: 'var(--radius)', padding: '8px 14px',
            fontSize: 13, fontFamily: 'var(--sans)', cursor: 'pointer',
          }}
          onFocus={e => { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.boxShadow = 'var(--shadow-input)' }}
          onBlur={e => { e.currentTarget.style.borderColor = 'var(--border-strong)'; e.currentTarget.style.boxShadow = 'none' }}
        />
      </div>

      {/* Summary stat strip */}
      {rows.length > 0 && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 12,
          marginBottom: 20,
        }}>
          {/* Total Planned */}
          <div style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-lg)',
            padding: '16px 20px',
            boxShadow: '0 2px 16px rgba(0,0,0,0.3)',
          }}>
            <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-label)', marginBottom: 6 }}>
              Total Planned
            </div>
            <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-h)', fontFamily: 'var(--mono)', fontVariantNumeric: 'tabular-nums' }}>
              {formatCents(totalPlanned)}
            </div>
          </div>

          {/* Total Actual */}
          <div style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-lg)',
            padding: '16px 20px',
            boxShadow: '0 2px 16px rgba(0,0,0,0.3)',
          }}>
            <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-label)', marginBottom: 6 }}>
              Total Spent
            </div>
            <div style={{
              fontSize: 22, fontWeight: 700,
              color: totalActual > totalPlanned ? 'var(--red)' : 'var(--text-h)',
              fontFamily: 'var(--mono)', fontVariantNumeric: 'tabular-nums',
            }}>
              {formatCents(totalActual)}
            </div>
            {totalPlanned > 0 && (
              <div style={{ fontSize: 11.5, color: totalActual > totalPlanned ? 'var(--red)' : 'var(--text-muted)', marginTop: 3, fontVariantNumeric: 'tabular-nums' }}>
                {Math.round((totalActual / totalPlanned) * 100)}% of planned
              </div>
            )}
          </div>

          {/* % of Income */}
          <div style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-lg)',
            padding: '16px 20px',
            boxShadow: '0 2px 16px rgba(0,0,0,0.3)',
          }}>
            <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-label)', marginBottom: 6 }}>
              % of Income Spent
            </div>
            {spendPct !== null ? (
              <>
                <div style={{
                  fontSize: 22, fontWeight: 700,
                  color: spendPct > 100 ? 'var(--red)' : spendPct > 80 ? 'var(--yellow)' : 'var(--green)',
                  fontFamily: 'var(--mono)', fontVariantNumeric: 'tabular-nums',
                }}>
                  {spendPct}%
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 3, fontVariantNumeric: 'tabular-nums' }}>
                  of {formatCents(totalIncome)} income
                </div>
                {/* Mini bar */}
                <div style={{ marginTop: 10, height: 4, borderRadius: 'var(--radius-full)', background: 'rgba(148,163,184,0.1)', overflow: 'hidden' }}>
                  <div style={{
                    height: '100%',
                    borderRadius: 'var(--radius-full)',
                    width: `${Math.min(spendPct, 100)}%`,
                    background: spendPct > 100 ? 'linear-gradient(90deg,#f87171,#ef4444)' : spendPct > 80 ? 'linear-gradient(90deg,#fbbf24,#f59e0b)' : 'linear-gradient(90deg,#22c55e,#16a34a)',
                    transition: 'width 0.5s cubic-bezier(0.16,1,0.3,1)',
                  }} />
                </div>
              </>
            ) : (
              <div style={{ fontSize: 13.5, color: 'var(--text-muted)', marginTop: 4 }}>No income data</div>
            )}
          </div>
        </div>
      )}

      {rows.length === 0 ? (
        <div style={{
          background: 'var(--bg-card)', borderRadius: 'var(--radius-lg)',
          border: '1px solid var(--border)',
          padding: '52px 24px', textAlign: 'center',
          color: 'var(--text-muted)', fontSize: 13,
          boxShadow: '0 4px 32px rgba(0,0,0,0.5)',
        }}>
          No budget data for this month.
        </div>
      ) : (
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
                {[
                  { label: 'Category', align: 'left', w: undefined },
                  { label: 'Type', align: 'left', w: 110 },
                  { label: 'Planned', align: 'right', w: undefined },
                  { label: 'Actual', align: 'right', w: undefined },
                  { label: 'Progress', align: 'left', w: 220 },
                ].map(({ label, align, w }) => (
                  <th key={label} style={{
                    padding: '12px 16px',
                    textAlign: align as 'left' | 'right',
                    fontSize: 10.5, fontWeight: 700,
                    color: 'var(--text-label)',
                    textTransform: 'uppercase', letterSpacing: '0.08em',
                    width: w,
                  }}>{label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, idx) => renderRow(row, idx, rows.length))}
            </tbody>
            <tfoot>
              <tr style={{ background: 'var(--bg-table-header)', borderTop: '2px solid var(--border-strong)' }}>
                <td style={{ padding: '12px 16px', fontSize: 11.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-label)' }}>
                  Total
                </td>
                <td style={{ padding: '12px 16px' }} />
                <td style={{ padding: '12px 16px', textAlign: 'right', fontFamily: 'var(--mono)', fontVariantNumeric: 'tabular-nums', fontWeight: 700, fontSize: 13.5, color: 'var(--text-secondary)' }}>
                  {formatCents(totalPlanned)}
                </td>
                <td style={{ padding: '12px 16px', textAlign: 'right', fontFamily: 'var(--mono)', fontVariantNumeric: 'tabular-nums', fontWeight: 700, fontSize: 13.5, color: totalActual > totalPlanned ? 'var(--red)' : 'var(--text-h)' }}>
                  {formatCents(totalActual)}
                </td>
                <td style={{ padding: '12px 16px' }}>
                  {totalPlanned > 0 && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{ flex: 1, background: 'rgba(148,163,184,0.07)', borderRadius: 'var(--radius-full)', height: 8, overflow: 'hidden' }}>
                        <div style={{
                          height: '100%',
                          borderRadius: 'var(--radius-full)',
                          width: `${Math.min(Math.round((totalActual / totalPlanned) * 100), 100)}%`,
                          background: totalActual > totalPlanned
                            ? 'linear-gradient(90deg,#f87171,#ef4444)'
                            : totalActual / totalPlanned > 0.8
                            ? 'linear-gradient(90deg,#fbbf24,#f59e0b)'
                            : 'linear-gradient(90deg,#22c55e,#16a34a)',
                          transition: 'width 0.5s cubic-bezier(0.16,1,0.3,1)',
                        }} />
                      </div>
                      <span style={{
                        fontSize: 11.5, fontWeight: 700, fontFamily: 'var(--mono)', fontVariantNumeric: 'tabular-nums', minWidth: 38, textAlign: 'right',
                        color: totalActual > totalPlanned ? 'var(--red)' : totalActual / totalPlanned > 0.8 ? 'var(--yellow)' : 'var(--text-secondary)',
                      }}>
                        {Math.round((totalActual / totalPlanned) * 100)}%
                      </span>
                    </div>
                  )}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      <style>{`
        @keyframes shimmer {
          100% { transform: translateX(200%); }
        }
        @keyframes pulse {
          0%, 100% { opacity: 0.6; }
          50% { opacity: 0.3; }
        }
      `}</style>
    </div>
  )
}
