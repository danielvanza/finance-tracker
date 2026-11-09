import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown } from 'lucide-react'

interface Option {
  value: string
  label: string
}

interface Props {
  label: string
  options: Option[]
  value: string
  /** The value that means "not filtering". */
  neutral: string
  onChange: (value: string) => void
}

/** A filter chip that opens a short list: the source filter, in the same row as the other chips. */
export default function ChipMenu({ label, options, value, neutral, onChange }: Props) {
  const [open, setOpen] = useState(false)
  const [hi, setHi] = useState(0)
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  const chosen = options.find(o => o.value === value)
  const active = value !== neutral

  useEffect(() => {
    if (!open) return
    const place = () => {
      const r = triggerRef.current!.getBoundingClientRect()
      const width = Math.min(Math.max(r.width, 180), window.innerWidth - 16)
      const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8))
      // Opens upwards when the list wouldn't fit below the chip.
      const need = options.length * 46 + 16
      const below = window.innerHeight - r.bottom - 14
      setPos(below >= need || below >= r.top ? { top: r.bottom + 6, left, width } : { top: Math.max(8, r.top - 6 - need), left, width })
    }
    place()
    const outside = (e: MouseEvent) => {
      const t = e.target as Node
      if (!triggerRef.current?.contains(t) && !panelRef.current?.contains(t)) setOpen(false)
    }
    document.addEventListener('mousedown', outside)
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      document.removeEventListener('mousedown', outside)
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open, options])

  const openMenu = () => {
    setHi(Math.max(0, options.findIndex(o => o.value === value)))
    setOpen(true)
  }

  const choose = (v: string) => {
    onChange(v)
    setOpen(false)
    triggerRef.current?.focus()
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === 'ArrowDown') { e.preventDefault(); openMenu() }
      return
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); setHi(i => (i + 1) % options.length) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi(i => (i - 1 + options.length) % options.length) }
    else if (e.key === 'Enter') { e.preventDefault(); choose(options[hi].value) }
    else if (e.key === 'Escape') { e.preventDefault(); setOpen(false); triggerRef.current?.focus() }
  }

  return (
    <div className="tx-chipmenu" onKeyDown={onKeyDown}>
      <button
        ref={triggerRef}
        type="button"
        aria-pressed={active}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => (open ? setOpen(false) : openMenu())}
      >
        {active && chosen ? chosen.label : label}
        <ChevronDown size={13} aria-hidden="true" />
      </button>
      {open && pos && createPortal(
        <div ref={panelRef} className="cs-panel" style={{ top: pos.top, left: pos.left, width: pos.width }}>
          <div role="listbox" aria-label={label} className="cs-list">
            {options.map((o, i) => (
              <div
                key={o.value}
                role="option"
                aria-selected={o.value === value}
                className={`cs-opt${i === hi ? ' is-hi' : ''}${o.value === value ? ' is-sel' : ''}`}
                onClick={() => choose(o.value)}
                onMouseEnter={() => setHi(i)}
              >
                <span className="cs-label">{o.label}</span>
                {o.value === value && <Check className="cs-check" size={13} aria-hidden="true" />}
              </div>
            ))}
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}
