import { Fragment, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Search } from 'lucide-react'
import { api } from '../../api'
import { dayLabel } from '../../dates'
import { formatCents } from '../../money'
import { flipTheme } from '../../theme'
import { PAGES, PLACES, SHORTCUTS } from './keys'
import './shell-palette.css'

interface Item {
  id: string
  group: string
  label: string
  hint?: string
  sub?: string
  amount?: string
  run: () => void
}

const MAX_TRANSACTIONS = 5
const MAX_PLACES = 5

/** Ctrl/Cmd-K: pages and actions, and (as you type) transactions and places such as settings, from anywhere. */
export default function CommandPalette({ onClose, onAdd, startHelp = false }: { onClose: () => void; onAdd: () => void; startHelp?: boolean }) {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [hi, setHi] = useState(0)
  const [help, setHelp] = useState(startHelp)
  const input = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLDivElement>(null)

  const { data: transactions = [], isLoading } = useQuery({
    queryKey: ['transactions', 'all'],
    queryFn: () => api.getTransactions(),
    staleTime: 30_000,
  })
  const { data: pace } = useQuery({ queryKey: ['pace', 'current'], queryFn: () => api.getPace() })

  useEffect(() => {
    const opener = document.activeElement
    input.current?.focus()
    return () => {
      if (opener instanceof HTMLElement && document.contains(opener)) opener.focus()
    }
  }, [])

  const items = useMemo(() => {
    const q = query.trim().toLowerCase()
    const go = (to: string) => () => navigate(to)
    const pages: Item[] = PAGES.map(p => ({
      id: `page-${p.key}`, group: 'Go to', label: p.label, hint: `G ${p.key.toUpperCase()}`, run: go(p.to),
    }))
    const review = pace?.to_review ?? 0
    const night = document.documentElement.dataset.theme === 'night'
    const actions: Item[] = [
      { id: 'add', group: q ? 'Actions' : 'Do', label: 'Add transaction', hint: 'N', run: onAdd },
      ...(review > 0
        ? [{ id: 'review', group: q ? 'Actions' : 'Do', label: `Review ${review} transaction${review === 1 ? '' : 's'}`, run: go('/transactions') }]
        : []),
      { id: 'theme', group: q ? 'Actions' : 'Do', label: night ? 'Switch to day' : 'Switch to night', run: () => void flipTheme(night ? 'night' : 'day') },
      { id: 'help', group: q ? 'Actions' : 'Do', label: 'Keyboard shortcuts', hint: '?', run: () => setHelp(true) },
    ]
    if (!q) return [...pages, ...actions]

    const byDescription = transactions.filter(t => t.description.toLowerCase().includes(q))
    const byCategory = transactions.filter(t => !byDescription.includes(t) && t.category_name?.toLowerCase().includes(q))
    const found: Item[] = [...byDescription, ...byCategory].slice(0, MAX_TRANSACTIONS).map(t => ({
      id: `tx-${t.id}`,
      group: 'Transactions',
      label: t.description,
      sub: [dayLabel(t.date), t.source.toUpperCase(), t.splits.length ? 'Split' : (t.category_name ?? 'Uncategorised')].join(' · '),
      amount: formatCents(t.amount_cents),
      run: go(`/transactions?q=${encodeURIComponent(t.description)}`),
    }))
    const matching = [...pages, ...actions].filter(i => i.label.toLowerCase().includes(q))
    // Someone looking for a purchase that is not there may well want to add it.
    if (found.length && !matching.some(i => i.id === 'add')) matching.push(actions[0])
    const words = q.split(/\s+/)
    const places: Item[] = PLACES
      .filter(p => {
        const text = `${p.label} ${p.sub} ${p.words}`.toLowerCase()
        return words.every(w => text.includes(w))
      })
      .slice(0, MAX_PLACES)
      .map(p => ({ id: `place-${p.label}`, group: 'Places', label: p.label, sub: p.sub, run: go(p.to) }))
    return [...found, ...matching, ...places]
  }, [query, transactions, pace, navigate, onAdd])

  const at = Math.min(hi, Math.max(items.length - 1, 0))

  useEffect(() => {
    list.current?.querySelector(`[data-idx="${at}"]`)?.scrollIntoView?.({ block: 'nearest' })
  }, [at])

  const choose = (item: Item | undefined) => {
    if (!item) return
    if (item.id === 'help') return item.run()
    onClose()
    item.run()
  }

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (items.length) setHi((at + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      choose(items[at])
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    } else if (e.key === 'Tab') {
      e.preventDefault()
    }
  }

  let lastGroup = ''
  return (
    <div className="scrim pal-scrim" onClick={onClose}>
      <div className="cs-panel pal" role="dialog" aria-modal="true" aria-label="Find or do anything" onClick={e => e.stopPropagation()}>
        <div className="cs-search">
          <Search size={16} aria-hidden="true" />
          <input
            ref={input}
            className="field"
            role="combobox"
            aria-expanded="true"
            aria-controls="pal-list"
            aria-activedescendant={items.length ? `pal-opt-${at}` : undefined}
            aria-label="Find a page, a setting or a transaction"
            placeholder="Find a page, a setting or a transaction"
            autoComplete="off"
            spellCheck={false}
            value={query}
            onChange={e => { setQuery(e.target.value); setHi(0); setHelp(false) }}
            onKeyDown={onKeyDown}
          />
        </div>
        {help ? (
          <div className="cs-list" id="pal-list">
            <div className="cs-group lab" role="presentation">Keyboard shortcuts</div>
            <dl className="pal-keys">
              {SHORTCUTS.map(k => (
                <div key={k.keys}><dt><kbd className="kbd">{k.keys}</kbd></dt><dd>{k.does}</dd></div>
              ))}
            </dl>
            <p className="sub pal-keys-note">Single letters wait while you type or a sheet is open. Type to search again.</p>
          </div>
        ) : (
        <div className="cs-list" id="pal-list" role="listbox" aria-label="Results" ref={list}>
          {items.map((item, i) => {
            const header = item.group !== lastGroup
            lastGroup = item.group
            return (
              <Fragment key={item.id}>
                {header && <div className="cs-group lab" role="presentation">{item.group}</div>}
                <div
                  id={`pal-opt-${i}`}
                  role="option"
                  aria-selected={i === at}
                  data-idx={i}
                  className={`cs-opt${i === at ? ' is-hi' : ''}`}
                  onClick={() => choose(item)}
                  onMouseMove={() => setHi(i)}
                >
                  <span className="grow">
                    {item.sub ? <strong>{item.label}</strong> : item.label}
                    {item.sub && <span className="sub">{item.sub}</span>}
                  </span>
                  {item.amount && <span className="num">{item.amount}</span>}
                  {item.hint && <kbd className="kbd">{item.hint}</kbd>}
                </div>
              </Fragment>
            )
          })}
          {!items.length && (
            <p className="empty" role="status">
              {isLoading ? 'Looking…' : `Nothing matches “${query.trim()}”. Try a shop, a category, a page or a setting.`}
            </p>
          )}
        </div>
        )}
      </div>
    </div>
  )
}
