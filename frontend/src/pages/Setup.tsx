import { useEffect, useLayoutEffect, useRef, type MouseEvent } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import BudgetPlanner from '../components/BudgetPlanner'
import Rules from './Rules'
import Settings from './Settings'
import CategoryManager from '../components/CategoryManager'
import SetAsides from '../components/SetAsides'
import TargetSplit from '../components/TargetSplit'
import OwnNames from '../components/OwnNames'
import YourData from '../components/reports/YourData'
import { SETUP_SECTIONS } from './setup/sections'

const calm = () => !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
const SETTLE_MS = 3000
const idOf = (hash: string) => {
  try { return decodeURIComponent(hash.slice(1)) } catch { return hash.slice(1) }
}

export default function Setup() {
  const grid = useRef<HTMLDivElement>(null)
  const { hash, key } = useLocation()
  const navigate = useNavigate()
  const first = useRef(true)

  // A section that is still loading renders nothing, so the ids follow the children as they appear.
  useLayoutEffect(() => {
    const el = grid.current
    if (!el) return
    const place = () => SETUP_SECTIONS.forEach((s, i) => { if (el.children[i]) el.children[i].id = s.id })
    place()
    const watch = new MutationObserver(place)
    watch.observe(el, { childList: true })
    return () => watch.disconnect()
  }, [])

  // Arriving on /setup#id, or tapping a chip, scrolls to the section. The sections above it fill in
  // as their data arrives, so a jump on arrival is kept in place until the person scrolls themselves.
  useEffect(() => {
    const arriving = first.current
    first.current = false
    const id = idOf(hash)
    if (!id) return
    const go = (behavior: ScrollBehavior) =>
      document.getElementById(id)?.scrollIntoView?.({ block: 'start', behavior })
    go(!arriving && calm() ? 'smooth' : 'auto')
    if (!arriving || !grid.current || typeof ResizeObserver === 'undefined') return
    const stay = new ResizeObserver(() => go('auto'))
    stay.observe(grid.current)
    const stop = () => stay.disconnect()
    const events = ['wheel', 'touchstart', 'keydown', 'pointerdown'] as const
    events.forEach(e => window.addEventListener(e, stop, { once: true, passive: true }))
    const timer = window.setTimeout(stop, SETTLE_MS)
    return () => {
      stop()
      window.clearTimeout(timer)
      events.forEach(e => window.removeEventListener(e, stop))
    }
  }, [hash, key])

  const jump = (e: MouseEvent, id: string) => {
    e.preventDefault()
    navigate({ hash: `#${id}` }, { replace: true })
  }

  return (
    <>
      <div className="page-head">
        <h1>Setup</h1>
      </div>
      <nav className="setup-jump" aria-label="Jump to a section">
        {SETUP_SECTIONS.map(s => (
          <a key={s.id} className="btn" href={`#${s.id}`} onClick={e => jump(e, s.id)}>{s.label}</a>
        ))}
      </nav>
      <div className="setup-sections" ref={grid}>
        <BudgetPlanner />
        <Rules />
        <CategoryManager />
        <SetAsides />
        <TargetSplit />
        <OwnNames />
        <Settings />
        <YourData />
      </div>
    </>
  )
}
