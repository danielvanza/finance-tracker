import type { ReactNode } from 'react'
import { Paperclip } from 'lucide-react'
import { Buttons, Rich, type Renderer } from 'bot-kit/bubble'
import type { Card, Message } from 'bot-kit/client'
import { formatCents } from '../money'
import type { ChatCardData, ChatCardResult, ChatChange, ChatImportCounts, ChatQuestion, ChatRowGroup } from '../types'

/** Finance's own message kinds in the bubble (docs/bot.md), and its card extras; Chat.tsx hands them to the bubble.
 *  The kit draws text, answers, cards and errors itself. */

const payloadOf = <T,>(message: Message) => (message.payload ?? {}) as unknown as T

/** A bank file sent in the chat: its name, with a paperclip. */
export const FileSent: Renderer = ({ message }) => (
  <span className="hf-file">
    <Paperclip size={16} aria-hidden="true" />
    {payloadOf<{ filename?: string }>(message).filename || message.text || 'bank file'}
  </span>
)

/** What an import in the chat did, as counts. */
export const ImportDone: Renderer = ({ message }) => {
  const counts = payloadOf<ChatImportCounts>(message)
  const rows: [string, number][] = [
    ['New', counts.imported],
    ['Already here, skipped', counts.skipped],
    ['Sorted and counted', counts.by_rule + counts.by_ai],
    ['Waiting for your answer', (counts.doubtful ?? 0) + counts.uncategorised],
    ...(counts.noted ? [['Already here, bank note added', counts.noted] as [string, number]] : []),
  ]
  return (
    <div className="bk-card hf-import">
      <p className="lab">ING import</p>
      <dl>
        {rows.map(([label, value]) => (
          <div className="hf-row" key={label}><dt>{label}</dt><dd>{value}</dd></div>
        ))}
      </dl>
    </div>
  )
}

/** A question about payments Claude was not sure of: who was paid, the payments, the likely categories as
 *  buttons; once answered, what became of it and the offer to remember the shop. */
export const Question: Renderer = ({ message, bot }) => {
  const question = payloadOf<ChatQuestion>(message)
  const buttons = message.buttons ?? []
  if (question.status !== 'open') {
    return (
      <div className="bk-reply" data-state="answered">
        <p className="hf-pre"><strong>{question.name}</strong>: {question.result || 'Sorted.'}</p>
        <Buttons message={message} buttons={buttons} bot={bot} />
      </div>
    )
  }
  const many = question.count > 1
  return (
    <div className="bk-reply" data-state="question">
      <p>
        <strong>{question.name}</strong>
        {many && ` · ${question.count} payments, ${formatCents(Math.abs(question.total_cents))}`}
      </p>
      <ul className="hf-examples">
        {question.examples.map((example, i) => (
          <li key={i}>
            <span className="hf-when">{example.date_label} · {example.amount_label}</span>
            {example.note && <span className="hf-note"> · “{example.note}”</span>}
          </li>
        ))}
        {question.count > question.examples.length && <li className="bk-quiet">and {question.count - question.examples.length} more</li>}
      </ul>
      <p className="hf-ask">{question.incoming ? 'What was this money for?' : 'Where does it belong?'}</p>
      <Buttons message={message} buttons={buttons} bot={bot} />
    </div>
  )
}

/** Something the app said unasked (the weekly recap, old bank data, a month that ended). */
export const Nudge: Renderer = ({ message }) => <div className="bk-reply hf-pre">{message.text}</div>

/** A reminder the household asked for: one plain line. */
export const Reminder: Renderer = ({ message }) => <div className="bk-reply hf-pre">Reminder: {message.text}</div>

/** Every row of a card, grouped by what changes, one short line per payment. */
export const AllRows: Renderer = ({ message }) => {
  const groups = payloadOf<{ groups?: ChatRowGroup[] }>(message).groups ?? []
  if (!groups.length) return <div className="bk-reply"><Rich text={message.text} /></div>
  return (
    <div className="bk-reply hf-all-rows">
      {groups.map(group => (
        <section key={group.heading}>
          <p className="lab">{group.heading} ({(group.rows ?? group.lines ?? []).length})</p>
          <ul>
            {group.rows?.map((row, i) => (
              <li key={i} className="hf-rowline"><span>{row.name}</span><span className="hf-when">{row.when} · {row.amount}</span></li>
            ))}
            {group.lines?.map((line, i) => <li key={i}>{line}</li>)}
          </ul>
        </section>
      ))}
    </div>
  )
}

/** Every row of a card that was summed up, for when someone wants to see them. */
function EveryRow({ changes }: { changes: ChatChange[] }) {
  return (
    <details className="hf-all">
      <summary>Show all {changes.length} rows</summary>
      <ul className="hf-batch">
        {changes.map((change, i) => (
          <li key={i}>
            <span>{change.title}</span>
            <span className="hf-batch-fields">
              {change.fields.map(field => <span key={field.label}>{field.label}: <s>{field.before}</s> → {field.after}</span>)}
            </span>
          </li>
        ))}
      </ul>
    </details>
  )
}

const lines = (items: string[] | undefined, className: string): ReactNode =>
  items && items.length > 0 ? <ul className={className}>{items.map((line, i) => <li key={i}>{line}</li>)}</ul> : null

/** Finance's extras inside a card: the refunded purchase, the budget effect, and every row of a long card;
 *  once applied, the budget lines as they stand and what was remembered. */
export function CardExtras({ card, message }: { card: Card; message: Message }) {
  const data = (card.data ?? {}) as Partial<ChatCardData>
  if (card.status === 'applied') {
    const result = (card.result ?? {}) as ChatCardResult
    const remembered = payloadOf<{ remembered?: string }>(message).remembered
    return (
      <>
        {(result.effect_lines ?? []).map((line, i) => <p key={`e${i}`}>{line}</p>)}
        {remembered && <p>{remembered}</p>}
      </>
    )
  }
  return (
    <>
      {data.purchase && <p className="bk-note">Refund for: {data.purchase.description}, {data.purchase.date_label}</p>}
      {lines(data.effect_lines, 'bk-lines hf-effect')}
      {data.summed_up && data.changes && <EveryRow changes={data.changes} />}
    </>
  )
}
