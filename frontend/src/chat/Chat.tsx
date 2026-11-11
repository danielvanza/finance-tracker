import { useEffect, useMemo, useRef, useState, type DragEvent, type FormEvent, type KeyboardEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowUp, MessageCircle, Paperclip } from 'lucide-react'
import { api } from '../api'
import type { ChatCard, ChatChart, ChatConversation, ChatMessage, ChatTransactionRef, ChatImportCounts, ChatWork } from '../types'
import { ClarifyCard, ImportCard, ProposalCard, type CardAction, type CardError } from './cards'

const CHAT_KEY = ['chat', 'bubble']
const DESKTOP = '(min-width: 1024px)'
const POLL_BUSY_MS = 1200
const POLL_OPEN_MS = 6000
const UNREACHABLE = "The app can't be reached right now."
const SEND_UNKNOWN = "The app can't be reached right now, so that may not have been sent. Nothing changes without an Apply."
const NOT_SENT = "That didn't reach the app, so nothing changed."
const FILE_UNKNOWN = "The app can't be reached right now, so that file may not have been imported. Sending it again adds nothing twice."
const FILE_NOT_SENT = "That file didn't reach the app, so nothing was imported."
const EXPLAIN = 'Ask anything about the household\'s money, or say what needs sorting out. Every change is shown on a card first, and nothing changes until it is applied.'

function isInFlight(m: ChatMessage) {
  return m.role === 'user' && m.status !== 'done'
}

/** Which line sits under a message that is not answered yet. */
function pendingLine(m: ChatMessage, others: ChatMessage[], claudeBusy: boolean) {
  const behind = others.some(o => o.id < m.id && isInFlight(o))
  if (m.status === 'waiting' || (m.status === 'queued' && (behind || claudeBusy))) {
    return 'Waiting for Claude. Your message is saved and will be answered next.'
  }
  if (m.status === 'stopping') return 'Stopping…'
  return m.kind === 'file' ? 'Reading your file and sorting it. This can take a few minutes.' : 'Thinking…'
}

const workOf = (m: ChatMessage) => (m.role === 'user' ? (m.payload as ChatWork | null) : null) ?? {}

/** What the reply is doing, step by step, while it works; afterwards folded away under the message. */
function WorkLog({ message, line, onStop, stopping }: { message: ChatMessage; line: string | null; onStop: () => void; stopping: boolean }) {
  const { steps = [], ended } = workOf(message)
  if (line !== null) {
    const working = message.kind === 'text' && message.status !== 'stopping'
    return (
      <li className="chat-reply chat-quiet chat-log" role="status" data-testid="chat-pending">
        <p>{line}</p>
        {steps.length > 0 && <ol data-testid="chat-steps">{steps.map((step, i) => <li key={i}>{step}</li>)}</ol>}
        {working && (
          <div className="chat-actions">
            <button type="button" className="btn" disabled={stopping} onClick={onStop}>Stop</button>
          </div>
        )}
      </li>
    )
  }
  if (!steps.length) return null
  const label = ended === 'stopped' ? 'Stopped' : ended === 'time' ? 'Stopped at the time limit' : 'Worked through'
  return (
    <li className="chat-quiet chat-log-done">
      <details>
        <summary>{label} · {steps.length} {steps.length === 1 ? 'step' : 'steps'}</summary>
        <ol>{steps.map((step, i) => <li key={i}>{step}</li>)}</ol>
      </details>
    </li>
  )
}

/** The app draws one picture per theme; the stylesheet shows the one that fits. */
function ChartPicture({ messageId, createdAt, chart }: { messageId: number; createdAt: string; chart: ChatChart }) {
  const [failed, setFailed] = useState(false)
  if (failed) return <p className="chat-reply chat-error">The chart could not be shown.</p>
  const alt = `${chart.title || 'Chart'}. The figures are in the answer above.`
  return (
    <>
      {(['day', 'night'] as const).map(theme => (
        <img
          key={theme}
          className="chat-chart"
          data-chart-theme={theme}
          src={api.chatChartUrl(messageId, createdAt, theme)}
          alt={alt}
          onError={() => setFailed(true)}
        />
      ))}
    </>
  )
}

function Message({ message, inFlightLine, onStop, stopping, chooseDisabled, onChoose, cardBusy, cardError, onApply, onReject }: {
  message: ChatMessage
  inFlightLine: string | null
  onStop: () => void
  stopping: boolean
  chooseDisabled: boolean
  onChoose: (id: number) => void
  cardBusy: boolean
  cardError: CardError | null
  onApply: (card: ChatCard) => void
  onReject: (card: ChatCard) => void
}) {
  if (message.role === 'user') {
    return (
      <>
        <li className={message.kind === 'file' ? 'chat-me chat-file' : 'chat-me'}>
          {message.kind === 'file' && <Paperclip size={16} aria-hidden="true" />}
          {message.text}
        </li>
        <WorkLog message={message} line={inFlightLine} onStop={onStop} stopping={stopping} />
      </>
    )
  }
  if (message.kind === 'proposal' && message.card) {
    const card = message.card
    return (
      <li>
        <ProposalCard card={card} localError={cardError} busy={cardBusy} onApply={() => onApply(card)} onReject={() => onReject(card)} />
      </li>
    )
  }
  if (message.kind === 'import' && message.payload) {
    return <li><ImportCard counts={message.payload as ChatImportCounts} /></li>
  }
  if (message.kind === 'clarify') {
    const options = (message.payload as { options?: ChatTransactionRef[] } | null)?.options ?? []
    return <li><ClarifyCard text={message.text} options={options} disabled={chooseDisabled} onChoose={onChoose} /></li>
  }
  const chart = (message.payload as { chart?: ChatChart } | null)?.chart
  return (
    <>
      <li className={message.kind === 'error' ? 'chat-reply chat-error' : 'chat-reply'}>{message.text}</li>
      {chart && <li><ChartPicture key={message.created_at} messageId={message.id} createdAt={message.created_at} chart={chart} /></li>}
    </>
  )
}

export default function Chat() {
  const queryClient = useQueryClient()
  const dialog = useRef<HTMLDialogElement>(null)
  const bottom = useRef<HTMLLIElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const textBox = useRef<HTMLTextAreaElement>(null)
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [sendError, setSendError] = useState<string | null>(null)
  const [confirmingNew, setConfirmingNew] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [cardErrors, setCardErrors] = useState<Record<number, { at: number; action: CardAction; version: string }>>({}) // by card id: the tap that failed
  const [unsure, setUnsure] = useState<{ text?: string; afterId: number; notice: string } | null>(null)
  const [busyCards, setBusyCards] = useState<Set<number>>(() => new Set())

  const { data, isError, dataUpdatedAt } = useQuery<ChatConversation>({
    queryKey: CHAT_KEY,
    queryFn: api.getChat,
    refetchInterval: query => {
      const inFlight = query.state.data?.messages.some(isInFlight)
      return inFlight ? POLL_BUSY_MS : open ? POLL_OPEN_MS : false
    },
  })
  const messages = useMemo(() => data?.messages ?? [], [data])

  // The rest of the app's figures follow whatever the chat changed, without a reload.
  const settled = messages.filter(m => m.status === 'done').length + ':' +
    messages.filter(m => m.card?.status === 'applied').length
  const lastSettled = useRef(settled)
  useEffect(() => {
    if (lastSettled.current !== settled) {
      lastSettled.current = settled
      queryClient.invalidateQueries({ predicate: q => q.queryKey[0] !== 'chat' })
    }
  }, [settled, queryClient])

  const openChat = () => setOpen(true)
  const closeChat = () => setOpen(false)

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
        textBox.current?.focus()
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

  const lastId = messages[messages.length - 1]?.id
  const pendingCount = messages.filter(isInFlight).length
  useEffect(() => {
    if (open) bottom.current?.scrollIntoView({ block: 'end' })
  }, [open, lastId, pendingCount])

  const refresh = () => queryClient.invalidateQueries({ queryKey: CHAT_KEY })

  /** After a failed send: did it get there after all? Only the server can say. */
  const settleSend = async (afterId: number, text: string | undefined, kind: 'text' | 'file') => {
    const landed = (messages: ChatMessage[]) =>
      messages.some(m => m.role === 'user' && m.id > afterId && (kind === 'file' ? m.kind === 'file' : text === undefined || m.text === text))
    const fresh = await queryClient.fetchQuery({ queryKey: CHAT_KEY, queryFn: api.getChat, retry: false, staleTime: 0 }).catch(() => null)
    if (fresh && landed(fresh.messages)) return
    if (kind === 'text' && text) setText(text)
    if (fresh) setSendError(kind === 'file' ? FILE_NOT_SENT : NOT_SENT)
    else setUnsure({ text, afterId, notice: kind === 'file' ? FILE_UNKNOWN : SEND_UNKNOWN })
  }

  const send = useMutation({
    mutationFn: (body: { text?: string; choose_transaction_id?: number; seen_message_id?: number }) => api.sendChatMessage(body),
    onMutate: () => { setSendError(null); setUnsure(null); return { afterId: lastId ?? 0 } },
    onSuccess: refresh,
    onError: (_error, body, context) => settleSend(context?.afterId ?? 0, body.text, 'text'),
  })
  const sendFile = useMutation({
    mutationFn: (file: File) => api.sendChatFile(file),
    onMutate: () => { setSendError(null); setUnsure(null); return { afterId: lastId ?? 0 } },
    onSuccess: refresh,
    onError: (_error, _file, context) => settleSend(context?.afterId ?? 0, undefined, 'file'),
  })

  const decide = async (card: ChatCard, action: CardAction) => {
    setBusyCards(current => new Set(current).add(card.id))
    setCardErrors(current => Object.fromEntries(Object.entries(current).filter(([id]) => Number(id) !== card.id)))
    try {
      if (action === 'apply') await api.applyChatProposal(card.id, card.version)
      else await api.rejectChatProposal(card.id)
      await refresh()
      queryClient.invalidateQueries({ predicate: q => q.queryKey[0] !== 'chat' })
    } catch {
      setCardErrors(current => ({ ...current, [card.id]: { at: Date.now(), action, version: card.version } }))
      refresh()
    } finally {
      setBusyCards(current => {
        const next = new Set(current)
        next.delete(card.id)
        return next
      })
    }
  }

  const newChat = useMutation({
    mutationFn: api.newChat,
    onSuccess: () => {
      setConfirmingNew(false)
      setCardErrors({})
      refresh()
    },
    onError: () => setSendError("The app can't be reached right now, so a new chat was not started."),
  })
  const stop = useMutation({
    mutationFn: api.stopChat,
    onSuccess: refresh,
    onError: () => setSendError("The app can't be reached right now, so that may not have stopped."),
  })

  const submit = (event?: FormEvent) => {
    event?.preventDefault()
    const trimmed = text.trim()
    if (!trimmed || send.isPending) return
    setText('')
    send.mutate({ text: trimmed, seen_message_id: lastId })
  }
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && matchMedia(DESKTOP).matches) submit(event)
  }

  const onDrop = (event: DragEvent) => {
    event.preventDefault()
    setDragging(false)
    void sendFiles(Array.from(event.dataTransfer.files))
  }

  /** One after the other. After a failure the rest wait, because nothing should go missing unsaid. */
  const sendFiles = async (files: File[]) => {
    for (const [index, file] of files.entries()) {
      try {
        await sendFile.mutateAsync(file)
      } catch {
        const left = files.length - index - 1
        if (left > 0) setSendError(`Stopped there: that file may not have arrived, and ${left} more ${left === 1 ? 'was' : 'were'} not sent. Sending them all again adds nothing twice.`)
        return
      }
    }
  }

  /** A failed tap is unknown until the server is heard from again, and then its status decides. */
  const cardError = (card: ChatCard): CardError | null => {
    const failure = cardErrors[card.id]
    if (failure?.version !== card.version) return null // never tapped, or the card has since been replaced
    if (dataUpdatedAt <= failure.at) return { unknown: true, action: failure.action }
    return card.status === 'pending' ? { unknown: false, action: failure.action } : null
  }
  const stillUnsure = unsure && !messages.some(m => m.role === 'user' && m.id > unsure.afterId && (unsure.text === undefined || m.text === unsure.text))
  const notice = sendError ?? (stillUnsure ? unsure.notice : null) ?? (isError ? UNREACHABLE : null)

  const guesses = data?.guesses_waiting ?? 0
  const starters = [
    'How are we doing this month?',
    'Something got refunded',
    ...(guesses > 0 ? [`Go through the ${guesses} to review`] : []),
  ]
  const busy = data?.claude_busy ?? false

  return (
    <>
      {!open && (
        <button type="button" className="chat-fab" aria-label="Open chat" onClick={openChat}>
          <MessageCircle size={22} aria-hidden="true" />
        </button>
      )}
      <dialog
        ref={dialog}
        className="chat-dialog"
        aria-label="Chat"
        onCancel={event => { event.preventDefault(); closeChat() }}
        onDragOver={event => { event.preventDefault(); setDragging(true) }}
        onDragLeave={event => { if (event.currentTarget === event.target) setDragging(false) }}
        onDrop={onDrop}
        data-dragging={dragging || undefined}
      >
        <div className="chat-sheet">
          <header className="chat-head">
            <span className="chat-grab" aria-hidden="true" />
            <h2>Ask</h2>
            <div className="chat-head-actions">
              {messages.length > 0 && !confirmingNew && (
                <button type="button" className="chat-quiet-btn" onClick={() => setConfirmingNew(true)}>New chat</button>
              )}
              <button type="button" className="chat-quiet-btn" onClick={closeChat}>Close</button>
            </div>
          </header>

          {confirmingNew && (
            <div className="chat-confirm">
              <p>Start a new chat for everyone using the app? The assistant won't draw on this conversation any more.</p>
              <div className="chat-actions">
                <button type="button" className="btn" disabled={newChat.isPending} onClick={() => newChat.mutate()}>Start new chat</button>
                <button type="button" className="btn" onClick={() => setConfirmingNew(false)}>Keep this one</button>
              </div>
            </div>
          )}

          <div className="chat-body">
            {messages.length === 0 && data && (
              <div className="chat-empty">
                <p>{EXPLAIN}</p>
                <div className="chat-starters">
                  {starters.map(starter => (
                    <button key={starter} type="button" className="btn" onClick={() => send.mutate({ text: starter })}>{starter}</button>
                  ))}
                </div>
              </div>
            )}
            <ul className="chat-thread" aria-live="polite">
              {messages.map(message => (
                <Message
                  key={message.id}
                  message={message}
                  inFlightLine={isInFlight(message) ? pendingLine(message, messages, busy) : null}
                  onStop={() => stop.mutate()}
                  stopping={stop.isPending}
                  chooseDisabled={send.isPending || pendingCount > 0}
                  onChoose={id => send.mutate({ choose_transaction_id: id })}
                  cardBusy={message.card ? busyCards.has(message.card.id) : false}
                  cardError={message.card ? cardError(message.card) : null}
                  onApply={card => decide(card, 'apply')}
                  onReject={card => decide(card, 'reject')}
                />
              ))}
              <li ref={bottom} aria-hidden="true" />
            </ul>
            {notice && <p className="chat-reply chat-error" role="alert">{notice}</p>}
          </div>

          <form className="chat-foot" onSubmit={submit}>
            <input
              ref={fileInput}
              type="file"
              accept=".csv,text/csv"
              hidden
              data-testid="chat-file"
              onChange={event => {
                const file = event.target.files?.[0]
                if (file) sendFile.mutate(file)
                event.target.value = ''
              }}
            />
            <button type="button" className="chat-icon" aria-label="Attach an ING file" onClick={() => fileInput.current?.click()}>
              <Paperclip size={18} aria-hidden="true" />
            </button>
            <textarea
              ref={textBox}
              rows={1}
              value={text}
              placeholder="What happened?"
              aria-label="Message"
              onChange={event => setText(event.target.value)}
              onKeyDown={onKeyDown}
            />
            <button type="submit" className="chat-icon" aria-label="Send" disabled={!text.trim() || send.isPending}>
              <ArrowUp size={18} aria-hidden="true" />
            </button>
          </form>
        </div>
      </dialog>
    </>
  )
}
