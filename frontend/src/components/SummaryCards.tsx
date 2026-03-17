interface Props {
  total_income: number
  total_expenses: number
  total_savings: number
  left_over: number
}

const fmt = (n: number) => `€${n.toLocaleString('nl-NL', { minimumFractionDigits: 2 })}`

const Card = ({ label, value, color }: { label: string; value: string; color: string }) => (
  <div style={{ background: '#1a1f2e', borderRadius: 8, padding: '16px 20px', flex: 1 }}>
    <div style={{ fontSize: 12, color: '#888', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 1 }}>{label}</div>
    <div style={{ fontSize: 24, fontWeight: 'bold', color }}>{value}</div>
  </div>
)

export default function SummaryCards({ total_income, total_expenses, total_savings, left_over }: Props) {
  return (
    <div style={{ display: 'flex', gap: 16, marginBottom: 24 }}>
      <Card label="Income" value={fmt(total_income)} color="#4ade80" />
      <Card label="Spent" value={fmt(total_expenses)} color="#f87171" />
      <Card label="Saved" value={fmt(total_savings)} color="#60a5fa" />
      <Card label="Left Over" value={fmt(left_over)} color="#facc15" />
    </div>
  )
}
