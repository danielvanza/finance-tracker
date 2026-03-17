import { Link, useLocation } from 'react-router-dom'

const links = [
  { to: '/', label: 'Dashboard' },
  { to: '/import', label: 'Import' },
  { to: '/transactions', label: 'Transactions' },
  { to: '/budget', label: 'Budget' },
  { to: '/rules', label: 'Rules' },
]

export default function Nav() {
  const { pathname } = useLocation()
  return (
    <nav style={{ display: 'flex', gap: 16, padding: '12px 24px', borderBottom: '1px solid #333', background: '#111' }}>
      <span style={{ fontWeight: 'bold', marginRight: 16, color: '#fff' }}>Household Finance</span>
      {links.map(({ to, label }) => (
        <Link key={to} to={to} style={{
          color: pathname === to ? '#60a5fa' : '#999',
          textDecoration: 'none', fontWeight: pathname === to ? 'bold' : 'normal',
        }}>{label}</Link>
      ))}
    </nav>
  )
}
