import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts'
import { api } from '../api'
import { formatCents } from '../money'
import { tooltipStyle } from '../styles/shared'

// ── Constants ──────────────────────────────────────────────────────────────

const OTHER_COLOR = '#475569'

// Color families per category type (round-robin within each group)
const TYPE_COLORS: Record<string, string[]> = {
  needs:   ['#f87171', '#ef4444', '#dc2626', '#fca5a5', '#fecaca'],
  wants:   ['#fbbf24', '#f59e0b', '#d97706', '#fde68a', '#fef3c7'],
  savings: ['#60a5fa', '#3b82f6', '#2563eb', '#93c5fd', '#bfdbfe'],
}

const THRESHOLD = 0.02  // slices below 2% of total_expenses → "Other"

// ── Helpers ────────────────────────────────────────────────────────────────

function currentMonth() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

// Assign a color to each category item based on type + position within type
function assignColors(
  items: Array<{ type: string }>,
): string[] {
  const typeCounters: Record<string, number> = {}
  return items.map(item => {
    const family = TYPE_COLORS[item.type] ?? TYPE_COLORS['wants']
    const idx = typeCounters[item.type] ?? 0
    typeCounters[item.type] = idx + 1
    return family[idx % family.length]
  })
}

// Custom label: skip slices below 3% to avoid clutter
// (slices below 2% are already collapsed into "Other" so this is belt-and-suspenders)
const renderPieLabel = ({ cx, cy, midAngle, outerRadius, percent, name }: {
  cx: number; cy: number; midAngle: number; outerRadius: number; percent: number; name: string
}) => {
  if ((percent ?? 0) < 0.03) return null
  const RADIAN = Math.PI / 180
  const radius = outerRadius + 28
  const x = cx + radius * Math.cos(-midAngle * RADIAN)
  const y = cy + radius * Math.sin(-midAngle * RADIAN)
  return (
    <text x={x} y={y} fill="#7890aa" textAnchor={x > cx ? 'start' : 'end'}
          dominantBaseline="central"
          style={{ fontSize: 12, fontFamily: 'var(--sans)' }}>
      {name} {String(Math.round((percent ?? 0) * 100))}%
    </text>
  )
}

// ── Component ──────────────────────────────────────────────────────────────

export default function Analytics() {
  const [month, setMonth] = useState(currentMonth)

  const { data, isLoading } = useQuery({
    queryKey: ['dashboard', month],
    queryFn: () => api.getDashboard(month),
  })
  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: api.getSettings,
  })

  // ── Derive chart data ────────────────────────────────────────────────────
  // Only run when data is available
  const chartData = (() => {
    if (!data) return { pieItems: [], legendItems: [] }

    const total = data.total_expenses_cents || 1
    const breakdown = data.category_breakdown.filter(c => c.actual_cents > 0)

    // Split into above- and below-threshold
    const above = breakdown.filter(c => c.actual_cents / total >= THRESHOLD)
    const below = breakdown.filter(c => c.actual_cents / total < THRESHOLD)

    const colors = assignColors(above)

    const pieItems: Array<{ name: string; value: number; color: string; pct: string; type: string }> = [
      ...above.map((c, i) => ({
        name: c.category_name,
        value: c.actual_cents,
        color: colors[i],
        pct: String(Math.round(c.actual_cents / total * 1000) / 10),
        type: c.type,
      })),
    ]

    if (below.length > 0) {
      const otherTotal = below.reduce((s, c) => s + c.actual_cents, 0)
      pieItems.push({
        name: 'Other',
        value: otherTotal,
        color: OTHER_COLOR,
        pct: String(Math.round(otherTotal / total * 1000) / 10),
        type: 'other',
      })
    }

    return { pieItems, legendItems: pieItems }
  })()

  // ── Date range label (mirrors Dashboard logic) ───────────────────────────
  const dateRangeLabel = (() => {
    const startDay = settings?.financial_month_start_day
      ? parseInt(settings.financial_month_start_day)
      : 24
    const [y, m] = month.split('-').map(Number)
    if (startDay === 1) {
      return `${new Date(y, m - 1, 1).toLocaleDateString('en-GB', { month: 'short', day: 'numeric' })} – ${new Date(y, m, 0).toLocaleDateString('en-GB', { month: 'short', day: 'numeric' })}`
    }
    const prevM = m === 1 ? 12 : m - 1
    const prevY = m === 1 ? y - 1 : y
    return `${new Date(prevY, prevM - 1, startDay).toLocaleDateString('en-GB', { month: 'short', day: 'numeric' })} – ${new Date(y, m - 1, startDay - 1).toLocaleDateString('en-GB', { month: 'short', day: 'numeric' })}`
  })()

  // ── Loading state ────────────────────────────────────────────────────────
  if (isLoading || !data) return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', minHeight: 360, gap: 14,
      color: 'var(--text-secondary)',
    }}>
      <div style={{
        width: 36, height: 36, borderRadius: '50%',
        border: '3px solid var(--border-strong)',
        borderTopColor: 'var(--accent)',
        animation: 'spin 0.8s linear infinite',
      }} />
      <span style={{ fontSize: 13 }}>Loading analytics…</span>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="animate-fade-in">
      {/* Page header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 28 }}>
        <div>
          <h1 style={{ marginBottom: 4 }}>Analytics</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: 13 }}>{dateRangeLabel}</p>
        </div>
        <input
          type="month" value={month} onChange={e => setMonth(e.target.value)}
          style={{
            background: 'var(--bg-card)', color: 'var(--text-h)',
            border: '1px solid var(--border-strong)',
            borderRadius: 'var(--radius)', padding: '8px 14px',
            fontSize: 13, fontFamily: 'var(--sans)', cursor: 'pointer',
            boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.03)',
          }}
          onFocus={e => { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.boxShadow = 'var(--shadow-input)' }}
          onBlur={e => { e.currentTarget.style.borderColor = 'var(--border-strong)'; e.currentTarget.style.boxShadow = 'inset 0 1px 0 rgba(255,255,255,0.03)' }}
        />
      </div>

      {/* Chart card */}
      <div style={{
        background: 'var(--bg-card)',
        borderRadius: 'var(--radius-lg)',
        padding: '22px 22px 14px',
        border: '1px solid var(--border)',
        boxShadow: '0 4px 32px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.035)',
        maxWidth: 640,
      }}>
        <div style={{ marginBottom: 18 }}>
          <h3 style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-h)', letterSpacing: '-0.02em', marginBottom: 3 }}>
            Spending by Category
          </h3>
          <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
            Share of total expenses · {chartData.pieItems.length} categor{chartData.pieItems.length === 1 ? 'y' : 'ies'}
          </p>
        </div>

        {chartData.pieItems.length === 0 ? (
          <p style={{ color: 'var(--text-muted)', fontSize: 13, textAlign: 'center', padding: '40px 0' }}>
            No spending data for this month.
          </p>
        ) : (
          <>
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie
                  data={chartData.pieItems}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  outerRadius={100}
                  innerRadius={56}
                  paddingAngle={2}
                  labelLine={{ stroke: '#3d5270', strokeWidth: 1, strokeDasharray: '3 2' }}
                  label={renderPieLabel as any}
                >
                  {chartData.pieItems.map((item, i) => (
                    <Cell key={i} fill={item.color} stroke="transparent" />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(v) => [formatCents(Math.round(Number(v)))]}
                  contentStyle={tooltipStyle}
                />
              </PieChart>
            </ResponsiveContainer>

            {/* Legend */}
            <div style={{
              display: 'flex', flexDirection: 'column', gap: 8,
              marginTop: 12,
              maxHeight: 280, overflowY: 'auto',
            }}>
              {chartData.legendItems.map(item => (
                <div key={item.name} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{
                    width: 10, height: 10, borderRadius: 2,
                    background: item.color, flexShrink: 0,
                  }} />
                  <span style={{ fontSize: 12, color: 'var(--text-secondary)', flex: 1 }}>
                    {item.name}
                  </span>
                  <span style={{
                    fontSize: 12, fontWeight: 600, color: 'var(--text-h)',
                    fontVariantNumeric: 'tabular-nums',
                  }}>
                    {formatCents(item.value)}
                  </span>
                  <span style={{
                    fontSize: 11, color: 'var(--text-muted)',
                    background: 'rgba(148,163,184,0.07)',
                    padding: '1px 6px', borderRadius: 4,
                    minWidth: 36, textAlign: 'center',
                  }}>
                    {item.pct}%
                  </span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
