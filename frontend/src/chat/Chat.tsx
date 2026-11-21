import { useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useLocation } from 'react-router-dom'
import { MessageCircle } from 'lucide-react'
import { createClient } from 'bot-kit/client'
import { Bubble, type CardBody, type Renderer } from 'bot-kit/bubble'
import 'bot-kit/bubble.css'
import { CHAT_BASE } from '../api'
import { AllRows, Answer, CardExtras, FileSent, ImportDone, Nudge, Question } from './kinds'

const DESKTOP = '(min-width: 1024px)'
const EXPLAIN = 'Ask anything about the household\'s money, or say what needs sorting out. Every change is shown on a card first, and nothing changes until it is applied.'
const ATTACH = { kind: 'file', accept: '.csv,text/csv', label: 'Attach an ING file' }
/** Finance's own message kinds (docs/bot.md); the kit draws text, answers, cards and errors. */
const renderers: Record<string, Renderer> = { file: FileSent, import: ImportDone, question: Question, nudge: Nudge, all_rows: AllRows, answer: Answer }
const cardBody: CardBody = (card, message) => <CardExtras card={card} message={message} />

/**
 * The chat: a round clay button on every page that opens a panel beside the page on a computer and a
 * bottom sheet on a phone. Inside is bot-kit's bubble, inline, with finance's own message kinds and card
 * extras (kinds.tsx) and finance's look (styles/chat.css maps its --bk-* variables).
 */
export default function Chat() {
  const queryClient = useQueryClient()
  const dialog = useRef<HTMLDialogElement>(null)
  const [open, setOpen] = useState(false)
  const { pathname } = useLocation()
  const client = useMemo(() => createClient(CHAT_BASE), [])

  // A panel beside the page on a computer, a modal sheet on a phone.
  useEffect(() => {
    const element = dialog.current
    if (!element || !open) return
    const media = matchMedia(DESKTOP)
    const place = () => {
      if (element.open) element.close()
      if (media.matches) {
        element.show()
        document.documentElement.dataset.chatDocked = ''
        element.querySelector<HTMLTextAreaElement>('textarea')?.focus()
      } else {
        element.showModal()
        delete document.documentElement.dataset.chatDocked
      }
    }
    place()
    media.addEventListener('change', place)
    return () => {
      media.removeEventListener('change', place)
      delete document.documentElement.dataset.chatDocked
      if (element.open) element.close()
    }
  }, [open])

  return (
    <>
      {!open && (
        <button type="button" className="chat-fab" aria-label="Open chat" onClick={() => setOpen(true)}>
          <MessageCircle size={22} aria-hidden="true" />
        </button>
      )}
      <dialog
        ref={dialog}
        className="chat-dialog"
        aria-label="Chat"
        onCancel={event => { event.preventDefault(); setOpen(false) }}
      >
        <div className="chat-sheet">
          <span className="chat-grab" aria-hidden="true" />
          {/* Mounted while closed too, so a reply that finishes meanwhile still updates the app's figures. */}
          <Bubble
            client={client}
            channel="bubble"
            page={pathname}
            mode="inline"
            title="Ask"
            intro={EXPLAIN}
            placeholder="What happened?"
            renderers={renderers}
            cardBody={cardBody}
            attach={ATTACH}
            onClose={() => setOpen(false)}
            onChange={() => queryClient.invalidateQueries({ predicate: q => q.queryKey[0] !== 'chat' })}
            className="hf-chat"
          />
        </div>
      </dialog>
    </>
  )
}
