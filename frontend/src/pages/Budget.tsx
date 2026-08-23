import React, { useState } from 'react'
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query'
import { api } from '../api'
import { formatCents, parseToCents, centsToInputString, sumCents } from '../money'
import { TypeCell } from './budget/TypeCell'
import { DrillDownRow } from './budget/DrillDown'
import ErrorBanner, { describeApiError } from '../components/ErrorBanner'

function currentMonth() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export default function Budget() {
  const [month, setMonth] = useState(currentMonth)
  const [editing, setEditing] = useState<Record<number, string>>({})
  const [expandedCategoryId, setExpandedCategoryId] = useState<number | null>(null)
  const [actionError, setActionError] = useState('')
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
      try {
        await api.patchBudget(id, val)
        qc.invalidateQueries({ queryKey: ['budget', month] })
      } catch (e) {
        setActionError(describeApiError(e))
      }
    }
    setEditing(e => { const n = { ...e }; delete n[id]; return n })
  }

  const recategoriseMutation = useMutation({
    mutationFn: ({ txId, newCategoryId }: { txId: number; newCategoryId: number }) =>
      api.patchTransaction(txId, { category_id: newCategoryId }),
    onSuccess: () => {
      setActionError('')
      qc.invalidateQueries({
        queryKey: ['transactions', { category_id: expandedCategoryId, month }],
      })
      qc.invalidateQueries({ queryKey: ['budget', month] })
    },
    onError: (e) => {
      setActionError(describeApiError(e))
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
            onError={setActionError}
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
      {actionError && <ErrorBanner message={actionError} />}
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
