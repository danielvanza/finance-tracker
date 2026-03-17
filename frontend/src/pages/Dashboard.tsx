import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { BarChart, Bar, XAxis, YAxis, Tooltip, PieChart, Pie, Cell, LineChart, Line, ResponsiveContainer, Legend } from 'recharts'
import { api } from '../api'
import SummaryCards from '../components/SummaryCards'

const COLORS = { needs: '#f87171', wants: '#facc15', savings: '#60a5fa' }

function currentMonth() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export default function Dashboard() {
  const [month, setMonth] = useState(currentMonth)
  const { data, isLoading } = useQuery({
    queryKey: ['dashboard', month],
    queryFn: () => api.getDashboard(month),
  })

  if (isLoading || !data) return <div>Loading...</div>

  const pieData = [
    { name: 'Needs', value: data.needs_wants_savings.needs },
    { name: 'Wants', value: data.needs_wants_savings.wants },
    { name: 'Savings', value: data.needs_wants_savings.savings },
  ]

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h1 style={{ margin: 0 }}>Dashboard</h1>
        <input type="month" value={month} onChange={e => setMonth(e.target.value)}
          style={{ background: '#1a1f2e', color: '#e0e0e0', border: '1px solid #333', borderRadius: 6, padding: '6px 12px' }} />
      </div>

      <SummaryCards
        total_income={data.total_income}
        total_expenses={data.total_expenses}
        total_savings={data.total_savings}
        left_over={data.left_over}
      />

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 24, marginBottom: 24 }}>
        <div style={{ background: '#1a1f2e', borderRadius: 8, padding: 20 }}>
          <h3 style={{ marginTop: 0 }}>Planned vs Actual by Category</h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={data.category_breakdown}>
              <XAxis dataKey="category_name" tick={{ fontSize: 10 }} angle={-30} textAnchor="end" height={60} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip formatter={(v) => `€${Number(v).toFixed(2)}`} />
              <Legend />
              <Bar dataKey="planned" fill="#374151" name="Planned" />
              <Bar dataKey="actual" fill="#60a5fa" name="Actual" />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div style={{ background: '#1a1f2e', borderRadius: 8, padding: 20 }}>
          <h3 style={{ marginTop: 0 }}>50/30/20 Split</h3>
          <ResponsiveContainer width="100%" height={300}>
            <PieChart>
              <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label={({ name, percent }) => `${name} ${((percent ?? 0) * 100).toFixed(0)}%`}>
                {pieData.map((_, i) => <Cell key={i} fill={Object.values(COLORS)[i]} />)}
              </Pie>
              <Tooltip formatter={(v) => `€${Number(v).toFixed(2)}`} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div style={{ background: '#1a1f2e', borderRadius: 8, padding: 20 }}>
        <h3 style={{ marginTop: 0 }}>6-Month Spending Trend</h3>
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={data.monthly_trend}>
            <XAxis dataKey="month" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip formatter={(v) => `€${Number(v).toFixed(2)}`} />
            <Line type="monotone" dataKey="total" stroke="#60a5fa" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
