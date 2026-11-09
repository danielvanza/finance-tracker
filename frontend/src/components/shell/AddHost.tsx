import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../../api'
import { formatCents } from '../../money'
import type { Transaction } from '../../types'
import AddTransactionModal from '../AddTransactionModal'
import './shell-add.css'

const LIST = { queryKey: ['transactions', 'all'], queryFn: () => api.getTransactions(), staleTime: 0 }
const SHOWN_MS = 4000

function said(added: Transaction[]) {
  if (added.length === 1) {
    const [tx] = added
    return ['Added', tx.description, formatCents(tx.amount_cents), tx.category_name].filter(Boolean).join(' · ')
  }
  if (added.length === 2) return `Added adjustment pair · ${added[0].description}`
  return 'Added'
}

/** The existing add form, opened from any page, and one polite line once it is saved. */
export default function AddHost({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient()
  const { data: categories = [] } = useQuery({ queryKey: ['categories'], queryFn: () => api.getCategories() })
  const [note, setNote] = useState<{ text: string; n: number } | null>(null)
  const before = useRef<Set<number> | null>(null)
  const opener = useRef<Element | null>(null)

  // Remember what was there, so the saved row can be told apart afterwards.
  useEffect(() => {
    if (!open) return
    before.current = null
    opener.current = document.activeElement
    qc.fetchQuery(LIST).then(rows => { before.current = new Set(rows.map(r => r.id)) }).catch(() => {})
    requestAnimationFrame(() => document.getElementById('add-tx-description')?.focus())
    return () => {
      if (opener.current instanceof HTMLElement && document.contains(opener.current)) opener.current.focus()
    }
  }, [open, qc])

  // Escape closes the form, unless it is closing the category list inside it.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.querySelector('.cs-panel')) onClose()
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [open, onClose])

  useEffect(() => {
    if (!note) return
    const timer = window.setTimeout(() => setNote(null), SHOWN_MS)
    return () => window.clearTimeout(timer)
  }, [note])

  const saved = async () => {
    for (const key of ['review', 'dashboard', 'pace', 'budget']) qc.invalidateQueries({ queryKey: [key] })
    const known = before.current
    const rows = await qc.fetchQuery(LIST).catch(() => null)
    qc.invalidateQueries({ queryKey: ['transactions'] })
    const added = known && rows ? rows.filter(r => !known.has(r.id)) : []
    setNote(prev => ({ text: said(added), n: (prev?.n ?? 0) + 1 }))
  }

  return (
    <>
      {open && <AddTransactionModal categories={categories} onClose={onClose} onSaved={saved} />}
      <div role="status" aria-live="polite">
        {note && <p className="qa-saved">{note.text}</p>}
      </div>
    </>
  )
}
