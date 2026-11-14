import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import AddHost from './AddHost'
import CommandPalette from './CommandPalette'
import { PAGES, dialogOpen, isTyping } from './keys'

const G_MS = 1200

/** Find and add from any page: the keys, the two sheets, and openers for the buttons. */
export function useShellTools() {
  const navigate = useNavigate()
  const [finding, setFinding] = useState(false)
  const [help, setHelp] = useState(false)
  const [adding, setAdding] = useState(false)
  const pendingG = useRef(0)

  const openFind = useCallback(() => { setHelp(false); setFinding(true) }, [])
  const closeFind = useCallback(() => setFinding(false), [])
  const openAdd = useCallback(() => setAdding(true), [])
  const closeAdd = useCallback(() => setAdding(false), [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing || e.repeat) return
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setHelp(false)
        setFinding(open => (open ? false : !dialogOpen()))
        return
      }
      if (e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target) || dialogOpen()) return
      const key = e.key.toLowerCase()
      if (pendingG.current && Date.now() - pendingG.current < G_MS) {
        pendingG.current = 0
        const page = PAGES.find(p => p.key === key)
        if (page) {
          e.preventDefault()
          navigate(page.to)
          return
        }
      }
      pendingG.current = key === 'g' ? Date.now() : 0
      if (e.key === '?') {
        e.preventDefault()
        setHelp(true)
        setFinding(true)
        return
      }
      if (key === 'n') {
        e.preventDefault()
        setAdding(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [navigate])

  const overlays = (
    <>
      {finding && <CommandPalette startHelp={help} onClose={closeFind} onAdd={openAdd} />}
      <AddHost open={adding} onClose={closeAdd} />
    </>
  )
  return { openFind, openAdd, overlays }
}
