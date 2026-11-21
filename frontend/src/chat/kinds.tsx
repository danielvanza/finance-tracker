import { useState, type ReactNode } from 'react'
import { Download, Paperclip } from 'lucide-react'
import { Buttons, Options, Rich, useTheme, type Renderer, type RendererProps } from 'bot-kit/bubble'
import type { Card, ChoiceOption, Message } from 'bot-kit/client'
import { exportUrl } from '../api'
import { formatCents } from '../money'
import type { ChatCardData, ChatCardResult, ChatChange, ChatExport, ChatImportCounts, ChatQuestion, ChatRowGroup } from '../types'

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

const count = new Intl.NumberFormat('nl-NL')

/** A file made in the chat: one row to download it, its name left and how many rows right. */
export function FileLink({ file }: { file: ChatExport }) {
  const rows = `${count.format(file.rows)} ${file.rows === 1 ? 'row' : 'rows'}`
  return (
    <div className="bk-options">
      <a className="bk-btn bk-option hf-download" href={exportUrl(file.id)} download={file.filename}>
        <span className="bk-option-label"><Download size={16} aria-hidden="true" />{file.filename}</span>
        <span className="bk-option-detail">{file.cut_off ? `first ${rows}` : rows}</span>
      </a>
    </div>
  )
}

/** A chart under the words, in the app's theme (as the kit draws it). */
function AnswerImage({ message, client }: Pick<RendererProps, 'message' | 'client'>) {
  const theme = useTheme()
  const src = client.imageUrl(message.id, theme)
  const [failed, setFailed] = useState<string | null>(null)  // the picture that would not load; another theme tries again
  const image = message.payload?.image as { alt?: unknown } | undefined
  if (failed === src) return <p className="bk-reply bk-error">The picture could not be shown.</p>
  const alt = (typeof image?.alt === 'string' && image.alt) || 'A picture. The figures are in the answer above.'
  return <img key={theme} className="bk-image" src={src} alt={alt} onError={() => setFailed(src)} />
}

function AnswerView({ message, bot, client }: RendererProps) {
  const payload = (message.payload ?? {}) as { options?: ChoiceOption[]; image?: unknown; export?: ChatExport }
  const options = Array.isArray(payload.options) ? payload.options : []
  const buttons = message.buttons ?? []
  const file = payload.export
  const last = bot.messages[bot.messages.length - 1]?.id === message.id
  const hasWords = !!message.text || options.length > 0 || buttons.length > 0 || !!file
  return (
    <div className="hf-answer">
      {hasWords && (
        <div className="bk-reply">
          {message.text && <Rich text={message.text} />}
          {file && <FileLink file={file} />}
          <Options options={options} disabled={!last || bot.sending || bot.inFlight} onChoose={id => void bot.choose(id)} />
          <Buttons message={message} buttons={buttons} bot={bot} />
        </div>
      )}
      {!!payload.image && <AnswerImage message={message} client={client} />}
    </div>
  )
}

/** Claude's answer, drawn as the kit draws it (words, "which one?" choices, buttons, a chart), plus the file it
 *  made, if any, as a download under the words. */
export const Answer: Renderer = props => <AnswerView {...props} />

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
