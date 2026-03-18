import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, PieChart, Pie, Cell,
  Area, AreaChart, ResponsiveContainer, Legend, CartesianGrid,
} from 'recharts'
import { api } from '../api'
import SummaryCards from '../components/SummaryCards'

const PIE_COLORS = ['#f87171', '#fbbf24', '#60a5fa']
const PIE_GLOWS = ['rgba(248,113,113,0.5)', 'rgba(251,191,36,0.5)', 'rgba(96,165,250,0.5)']

const tooltipStyle = {
  background: '#07101e',
  border: '1px solid rgba(148,163,184,0.14)',
  borderRadius: 12,
  color: '#eef2fa',
  fontSize: 13,
  boxShadow: '0 12px 40px rgba(0,0,0,0.65)',
  padding: '10px 14px',
}

function currentMonth() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

const axisStyle = { fontSize: 11.5, fill: '#5a7592' }
const gridStroke = 'rgba(148,163,184,0.05)'

// Custom pie label
const renderPieLabel = ({ cx, cy, midAngle, outerRadius, percent, name }: {
  cx: number; cy: number; midAngle: number; outerRadius: number; percent: number; name: string;
}) => {
  if ((percent ?? 0) < 0.03) return null
  const RADIAN = Math.PI / 180
  const radius = outerRadius + 28
  const x = cx + radius * Math.cos(-midAngle * RADIAN)
  const y = cy + radius * Math.sin(-midAngle * RADIAN)
  return (
    <text x={x} y={y} fill="#7890aa" textAnchor={x > cx ? 'start' : 'end'} dominantBaseline="central" style={{ fontSize: 12, fontFamily: 'var(--sans)' }}>
      {name} {((percent ?? 0) * 100).toFixed(0)}%
    </text>
  )
}

// Card wrapper for charts
const ChartCard = ({ title, subtitle, children, style = {} }: {
  title: string; subtitle: string; children: React.ReactNode; style?: React.CSSProperties;
}) => (
  <div style={{
    background: 'var(--bg-card)',
    borderRadius: 'var(--radius-lg)',
    padding: '22px 22px 14px',
    border: '1px solid var(--border)',
    boxShadow: '0 4px 32px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.035)',
    ...style,
  }}>
    <div style={{ marginBottom: 18 }}>
      <h3 style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-h)', letterSpacing: '-0.02em', marginBottom: 3 }}>{title}</h3>
      <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{subtitle}</p>
    </div>
    {children}
  </div>
)

export default function Dashboard() {
  const [month, setMonth] = useState(currentMonth)
  const { data, isLoading } = useQuery({
    queryKey: ['dashboard', month],
    queryFn: () => api.getDashboard(month),
  })
  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: api.getSettings,
  })

  if (isLoading || !data) return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      minHeight: 360, gap: 14, color: 'var(--text-secondary)',
    }}>
      <div style={{
        width: 36, height: 36, borderRadius: '50%',
        border: '3px solid var(--border-strong)',
        borderTopColor: 'var(--accent)',
        animation: 'spin 0.8s linear infinite',
      }} />
      <span style={{ fontSize: 13 }}>Loading dashboard…</span>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )

  const pieData = [
    { name: 'Needs', value: data.needs_wants_savings.needs },
    { name: 'Wants', value: data.needs_wants_savings.wants },
    { name: 'Savings', value: data.needs_wants_savings.savings },
  ]

  const totalExpenses = data.total_expenses || 1
  const needsPct = ((data.needs_wants_savings.needs / totalExpenses) * 100).toFixed(0)
  const wantsPct = ((data.needs_wants_savings.wants / totalExpenses) * 100).toFixed(0)
  const savingsPct = ((data.needs_wants_savings.savings / totalExpenses) * 100).toFixed(0)

  return (
    <div className="animate-fade-in">
      {/* Page header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 28 }}>
        <div>
          <h1 style={{ marginBottom: 4 }}>Dashboard</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
            {(() => {
              const startDay = settings?.financial_month_start_day ? parseInt(settings.financial_month_start_day) : 24
              const [y, m] = month.split('-').map(Number)
              if (startDay === 1) {
                return `${new Date(y, m - 1, 1).toLocaleDateString('en-GB', { month: 'short', day: 'numeric' })} – ${new Date(y, m, 0).toLocaleDateString('en-GB', { month: 'short', day: 'numeric' })}`
              }
              const prevM = m === 1 ? 12 : m - 1
              const prevY = m === 1 ? y - 1 : y
              return `${new Date(prevY, prevM - 1, startDay).toLocaleDateString('en-GB', { month: 'short', day: 'numeric' })} – ${new Date(y, m - 1, startDay - 1).toLocaleDateString('en-GB', { month: 'short', day: 'numeric' })}`
            })()}
          </p>
        </div>
        <input
          type="month" value={month} onChange={e => setMonth(e.target.value)}
          style={{
            background: 'var(--bg-card)', color: 'var(--text-h)',
            border: '1px solid var(--border-strong)',
            borderRadius: 'var(--radius)',
            padding: '8px 14px',
            fontSize: 13, fontFamily: 'var(--sans)', cursor: 'pointer',
            boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.03)',
          }}
          onFocus={e => { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.boxShadow = 'var(--shadow-input)' }}
          onBlur={e => { e.currentTarget.style.borderColor = 'var(--border-strong)'; e.currentTarget.style.boxShadow = 'inset 0 1px 0 rgba(255,255,255,0.03)' }}
        />
      </div>

      {/* Summary cards */}
      <SummaryCards
        total_income={data.total_income}
        total_expenses={data.total_expenses}
        total_savings={data.total_savings}
        left_over={data.left_over}
        income_breakdown={data.income_breakdown}
      />

      {/* Charts row 1: Bar + Pie */}
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 16, marginBottom: 16 }}>

        {/* Bar chart — Planned vs Actual */}
        <ChartCard title="Planned vs Actual" subtitle="Spending by category this month">
          <ResponsiveContainer width="100%" height={290}>
            <BarChart data={data.category_breakdown} barGap={3} barCategoryGap="28%">
              <defs>
                <linearGradient id="barActual" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#818cf8" stopOpacity={1} />
                  <stop offset="100%" stopColor="#6366f1" stopOpacity={0.85} />
                </linearGradient>
                <linearGradient id="barPlanned" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#6366f1" stopOpacity={0.25} />
                  <stop offset="100%" stopColor="#6366f1" stopOpacity={0.1} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="0" stroke={gridStroke} vertical={false} />
              <XAxis
                dataKey="category_name"
                tick={axisStyle}
                angle={-30}
                textAnchor="end"
                height={64}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tick={axisStyle}
                axisLine={false}
                tickLine={false}
                tickFormatter={v => `€${v}`}
                width={56}
              />
              <Tooltip
                formatter={(v) => [`€${Number(v).toFixed(2)}`]}
                contentStyle={tooltipStyle}
                cursor={{ fill: 'rgba(99,102,241,0.05)', radius: 6 }}
                labelStyle={{ color: 'var(--text-h)', fontWeight: 600, marginBottom: 4 }}
              />
              <Legend
                wrapperStyle={{ fontSize: 12, paddingTop: 8 }}
                iconType="square"
                iconSize={10}
              />
              <Bar dataKey="planned" fill="url(#barPlanned)" name="Planned" radius={[4, 4, 0, 0]} stroke="rgba(99,102,241,0.3)" strokeWidth={1} />
              <Bar dataKey="actual" fill="url(#barActual)" name="Actual" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        {/* Pie chart — 50/30/20 */}
        <ChartCard title="50/30/20 Split" subtitle="Needs · Wants · Savings">
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <defs>
                {PIE_COLORS.map((_color, i) => (
                  <filter key={i} id={`glow-${i}`} x="-20%" y="-20%" width="140%" height="140%">
                    <feGaussianBlur stdDeviation="3" result="coloredBlur"/>
                    <feMerge><feMergeNode in="coloredBlur"/><feMergeNode in="SourceGraphic"/></feMerge>
                  </filter>
                ))}
              </defs>
              <Pie
                data={pieData} dataKey="value" nameKey="name"
                cx="50%" cy="50%"
                outerRadius={82} innerRadius={46}
                paddingAngle={3}
                labelLine={{ stroke: '#3d5270', strokeWidth: 1, strokeDasharray: '3 2' }}
                label={renderPieLabel as any}
              >
                {pieData.map((_, i) => (
                  <Cell
                    key={i}
                    fill={PIE_COLORS[i]}
                    stroke="transparent"
                    style={{ filter: `drop-shadow(0 0 6px ${PIE_GLOWS[i]})` }}
                  />
                ))}
              </Pie>
              <Tooltip
                formatter={(v) => [`€${Number(v).toFixed(2)}`]}
                contentStyle={tooltipStyle}
              />
            </PieChart>
          </ResponsiveContainer>

          {/* Legend with percentages */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
            {[
              { label: 'Needs', pct: needsPct, color: PIE_COLORS[0], value: data.needs_wants_savings.needs },
              { label: 'Wants', pct: wantsPct, color: PIE_COLORS[1], value: data.needs_wants_savings.wants },
              { label: 'Savings', pct: savingsPct, color: PIE_COLORS[2], value: data.needs_wants_savings.savings },
            ].map(({ label, pct, color: dotColor, value }) => (
              <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{
                  width: 10, height: 10, borderRadius: 2,
                  background: dotColor, flexShrink: 0,
                  boxShadow: `0 0 6px ${dotColor}80`,
                }} />
                <span style={{ fontSize: 12, color: 'var(--text-secondary)', flex: 1 }}>{label}</span>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-h)', fontVariantNumeric: 'tabular-nums' }}>
                  €{value.toLocaleString('nl-NL', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                </span>
                <span style={{
                  fontSize: 11, color: 'var(--text-muted)',
                  background: 'rgba(148,163,184,0.07)',
                  padding: '1px 6px', borderRadius: 4, minWidth: 36, textAlign: 'center',
                }}>{pct}%</span>
              </div>
            ))}
          </div>
        </ChartCard>
      </div>

      {/* Trend area chart */}
      <ChartCard
        title="6-Month Spending Trend"
        subtitle="Total monthly expenses over the last 6 months"
      >
        <ResponsiveContainer width="100%" height={190}>
          <AreaChart data={data.monthly_trend} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#6366f1" stopOpacity={0.3} />
                <stop offset="60%" stopColor="#6366f1" stopOpacity={0.08} />
                <stop offset="100%" stopColor="#6366f1" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="lineGrad" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#818cf8" />
                <stop offset="100%" stopColor="#a78bfa" />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="0" stroke={gridStroke} vertical={false} />
            <XAxis dataKey="month" tick={axisStyle} axisLine={false} tickLine={false} />
            <YAxis tick={axisStyle} axisLine={false} tickLine={false} tickFormatter={v => `€${v}`} width={56} />
            <Tooltip
              formatter={(v) => [`€${Number(v).toFixed(2)}`, 'Total Expenses']}
              contentStyle={tooltipStyle}
              cursor={{ stroke: 'rgba(99,102,241,0.25)', strokeWidth: 1, strokeDasharray: '4 2' }}
              labelStyle={{ color: 'var(--text-h)', fontWeight: 600, marginBottom: 4 }}
            />
            <Area
              type="monotone"
              dataKey="total"
              stroke="url(#lineGrad)"
              strokeWidth={2.5}
              fill="url(#areaGrad)"
              dot={{ fill: '#6366f1', stroke: '#818cf8', strokeWidth: 1.5, r: 4 }}
              activeDot={{ r: 6, fill: '#818cf8', stroke: '#a78bfa', strokeWidth: 2 }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </ChartCard>
    </div>
  )
}
