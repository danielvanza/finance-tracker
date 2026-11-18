import { useEffect, useLayoutEffect, useRef } from 'react'
import { BrowserRouter, Routes, Route, Navigate, Link, useLocation } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { House } from 'lucide-react'
import { ThemeProvider } from './daylight'
import Month from './pages/Month'
import Import from './pages/Import'
import Transactions from './pages/Transactions'
import Trends from './pages/Trends'
import Setup from './pages/Setup'
import ReportPage from './components/reports/ReportPage'
import Chat from './chat/Chat'
import { AddChip, AddRow, FindButtons, ImportEntries } from './components/shell/Entries'
import { scrollToTop, useOpenAtTop } from './components/shell/scroll'
import { useShellTools } from './components/shell/useShellTools'

const queryClient = new QueryClient()

const TABS = [
  { to: '/', label: 'Overview' },
  { to: '/transactions', label: 'Money' },
  { to: '/setup', label: 'Plan' },
]

/** Which of the three places a path belongs to: Money holds payments and trends, Overview its report. */
function placeOf(pathname: string) {
  if (pathname === '/' || pathname === '/report') return '/'
  if (pathname === '/transactions' || pathname === '/trends') return '/transactions'
  if (pathname === '/setup') return '/setup'
  return undefined
}

/** Money's two views: every payment, and how the months compare. */
function MoneySwitch({ pathname }: { pathname: string }) {
  return (
    <nav className="subnav" aria-label="Money">
      <Link to="/transactions" aria-current={pathname === '/transactions' ? 'page' : undefined}>Payments</Link>
      <Link to="/trends" aria-current={pathname === '/trends' ? 'page' : undefined}>Trends</Link>
    </nav>
  )
}

/** The pressed-in well that glides from the old tab to the new one, as on the dashboard. */
function useTabWell(current: string | undefined) {
  const nav = useRef<HTMLElement>(null)
  const well = useRef<HTMLSpanElement>(null)

  const place = (glide: boolean) => {
    const navEl = nav.current
    const wellEl = well.current
    if (!navEl || !wellEl) return
    const tab = navEl.querySelector<HTMLElement>('a[aria-current="page"]')
    wellEl.hidden = !tab
    if (!tab) return
    const chip = getComputedStyle(tab, '::before')
    const [top, right, bottom, left] = [chip.top, chip.right, chip.bottom, chip.left].map(parseFloat)
    wellEl.style.width = `${tab.offsetWidth - left - right}px`
    wellEl.style.height = `${tab.offsetHeight - top - bottom}px`
    wellEl.style.borderRadius = chip.borderRadius
    const to = `translate(${tab.offsetLeft + left}px, ${tab.offsetTop + top}px)`
    const motion = glide && to !== wellEl.style.transform && !matchMedia('(prefers-reduced-motion: reduce)').matches
    if (motion) navEl.dataset.gliding = ''
    else delete navEl.dataset.gliding
    wellEl.style.transition = motion ? '' : 'none'
    wellEl.style.transform = to
  }

  const placed = useRef(false)
  useLayoutEffect(() => {
    place(placed.current)
    placed.current = true
  }, [current])

  useEffect(() => {
    const navEl = nav.current
    const wellEl = well.current
    if (!navEl || !wellEl) return
    let first = true
    const resized = new ResizeObserver(() => (first ? (first = false) : place(false)))
    resized.observe(navEl)
    const done = () => delete navEl.dataset.gliding
    wellEl.addEventListener('transitionend', done)
    wellEl.addEventListener('transitioncancel', done)
    return () => {
      resized.disconnect()
      wellEl.removeEventListener('transitionend', done)
      wellEl.removeEventListener('transitioncancel', done)
    }
  }, [])

  return { nav, well }
}

function Shell() {
  const { pathname, search } = useLocation()
  const current = placeOf(pathname)
  const { nav, well } = useTabWell(current)
  const { openFind, openAdd, overlays } = useShellTools()
  useOpenAtTop(pathname)

  return (
    <div className="shell">
      <aside className="side">
        <Link to="/" className="brand">Finances</Link>
        <FindButtons onOpen={openFind} />
        <AddChip onOpen={openAdd} />
        <ImportEntries />
        <nav className="tabbar" aria-label="Main" ref={nav}>
          <span className="tab-well" ref={well} aria-hidden="true" />
          {TABS.map(t => (
            <Link
              key={t.to}
              to={t.to}
              aria-current={t.to === current ? 'page' : undefined}
              onClick={e => {
                // The tab you are on: back to the top of it, unless a search is there to clear.
                if (t.to === current && pathname === t.to && !search) {
                  e.preventDefault()
                  scrollToTop()
                }
              }}
            >
              <span className="tab-label">{t.label}</span>
            </Link>
          ))}
        </nav>
        <AddRow onOpen={openAdd} />
        <a href="/" className="back" aria-label="Dashboard"><House size={16} aria-hidden="true" /><span className="back-label">Dashboard</span></a>
      </aside>
      <main className="content" key={pathname}>
        {current === '/transactions' && <MoneySwitch pathname={pathname} />}
        <Routes>
          <Route path="/" element={<Month />} />
          <Route path="/transactions" element={<Transactions />} />
          <Route path="/trends" element={<Trends />} />
          <Route path="/setup" element={<Setup />} />
          <Route path="/report" element={<ReportPage />} />
          <Route path="/import" element={<Import />} />
          {/* The old pages, so bookmarks still land somewhere sensible. */}
          <Route path="/budget" element={<Navigate to="/" replace />} />
          <Route path="/analytics" element={<Navigate to="/trends" replace />} />
          <Route path="/rules" element={<Navigate to="/setup" replace />} />
          <Route path="/settings" element={<Navigate to="/setup" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      <Chat />
      {overlays}
    </div>
  )
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, '') || '/'}>
          <Shell />
        </BrowserRouter>
      </ThemeProvider>
    </QueryClientProvider>
  )
}
