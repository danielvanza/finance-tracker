import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import Nav from './components/Nav'
import Dashboard from './pages/Dashboard'
import Import from './pages/Import'
import Transactions from './pages/Transactions'
import Budget from './pages/Budget'
import Rules from './pages/Rules'

const queryClient = new QueryClient()

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <div style={{ minHeight: '100vh', background: '#0f0f13', color: '#e0e0e0', fontFamily: 'system-ui, sans-serif' }}>
          <Nav />
          <div style={{ padding: '24px', maxWidth: 1200, margin: '0 auto' }}>
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/import" element={<Import />} />
              <Route path="/transactions" element={<Transactions />} />
              <Route path="/budget" element={<Budget />} />
              <Route path="/rules" element={<Rules />} />
            </Routes>
          </div>
        </div>
      </BrowserRouter>
    </QueryClientProvider>
  )
}
