import type { ChatCard, ChatChange, ChatImportCounts, ChatTransactionRef } from '../types'

export type CardAction = 'apply' | 'reject'
export type CardError = { unknown: boolean; action: CardAction }

/** Every row of a card that was summed up, for when someone wants to see them. */
function AllRows({ changes }: { changes: ChatChange[] }) {
  return (
    <details className="chat-all">
      <summary>Show all {changes.length} rows</summary>
      <ul className="chat-batch">
        {changes.map((change, i) => (
          <li key={i}>
            <span>{change.title}</span>
            <span className="chat-batch-fields">
              {change.fields.map(field => <span key={field.label}>{field.label}: <s>{field.before}</s> → {field.after}</span>)}
            </span>
          </li>
        ))}
      </ul>
    </details>
  )
}

/** The proposed change in the app's own plain words, then what became of it. */
export function ProposalCard({ card, localError, busy, onApply, onReject }: {
  card: ChatCard
  localError: CardError | null
  busy: boolean
  onApply: () => void
  onReject: () => void
}) {
  if (card.status === 'applied') {
    return (
      <div className="chat-reply" data-state="applied">
        <p><span className="chat-done">Done.</span> {card.lines.length === 1 && card.lines[0]}</p>
        {card.lines.length > 1 && card.lines.map((line, i) => <p key={i}>{line}</p>)}
        {card.effect_lines.map((line, i) => <p key={`e${i}`}>{line}</p>)}
      </div>
    )
  }
  if (card.status === 'rejected') {
    return <div className="chat-reply chat-quiet" data-state="rejected">{card.apply_label === 'Merge' ? 'Kept both. Nothing changed.' : 'Not applied. Nothing changed.'}</div>
  }
  if (card.status === 'superseded') {
    return <div className="chat-reply chat-quiet" data-state="superseded">Replaced by a newer suggestion. Nothing changed.</div>
  }
  if (card.status === 'failed' || localError) {
    const declining = localError?.action === 'reject'
    const headline = declining
      ? (localError?.unknown ? `Couldn't confirm "${card.reject_label}" went through.` : `"${card.reject_label}" didn't go through, so this is still waiting for an answer.`)
      : (localError?.unknown ? "Couldn't confirm whether that went through." : "That didn't go through, and nothing changed.")
    const unreachable = localError?.unknown ? "The app can't be reached right now." : 'The app could not be reached.'
    const detail = declining
      ? `${unreachable} Try again won't make the change.`
      : localError?.unknown ? `${unreachable} Try again is safe: it can't apply twice.` : localError ? unreachable : card.error
    return (
      <div className="chat-reply" data-state="failed">
        <p className="chat-failed">{headline}</p>
        <p>{detail}</p>
        <div className="chat-actions">
          <button type="button" className="btn" disabled={busy} onClick={declining ? onReject : onApply}>Try again</button>
        </div>
      </div>
    )
  }
  return (
    <div className="chat-card" data-state="pending" data-summary={card.summary}>
      {card.says && <p className="chat-says">{card.says}</p>}
      {card.apply_label === 'Merge' && (
        <>
          <p className="lab">{card.heading}</p>
          <p className="chat-summary">{card.summary}</p>
        </>
      )}
      <ul className="chat-lines">
        {card.lines.map((line, i) => <li key={i}>{line}</li>)}
      </ul>
      {card.note && <p className="chat-note">{card.note}</p>}
      {card.purchase && <p className="chat-note">Refund for: {card.purchase.description}, {card.purchase.date_label}</p>}
      {card.effect_lines.length > 0 && (
        <ul className="chat-lines chat-effect">
          {card.effect_lines.map((line, i) => <li key={i}>{line}</li>)}
        </ul>
      )}
      {card.summed_up && <AllRows changes={card.changes} />}
      <div className="chat-actions">
        <button type="button" className="btn btn-primary" disabled={busy} onClick={onApply}>{card.apply_label}</button>
        <button type="button" className="btn" disabled={busy} onClick={onReject}>{card.reject_label}</button>
      </div>
    </div>
  )
}

export function ImportCard({ counts }: { counts: ChatImportCounts }) {
  const rows: [string, number][] = [
    ['New', counts.imported],
    ['Already here, skipped', counts.skipped],
    ['Sorted and counted', counts.by_rule + counts.by_ai],
    ['Waiting for your answer', (counts.doubtful ?? 0) + counts.uncategorised],
    ...(counts.noted ? [['Already here, bank note added', counts.noted] as [string, number]] : []),
  ]
  return (
    <div className="chat-card">
      <p className="lab">ING import</p>
      <dl>
        {rows.map(([label, value]) => (
          <div className="chat-row" key={label}><dt>{label}</dt><dd>{value}</dd></div>
        ))}
      </dl>
    </div>
  )
}

export function ClarifyCard({ text, options, disabled, onChoose }: {
  text: string
  options: ChatTransactionRef[]
  disabled: boolean
  onChoose: (id: number) => void
}) {
  return (
    <div className="chat-reply">
      <p>{text}</p>
      {options.length > 0 && (
        <div className="chat-options">
          {options.map(option => (
            <button key={option.id} type="button" className="btn" disabled={disabled} onClick={() => onChoose(option.id)}>
              <span>{option.date_label} · {option.amount_label}</span>
              <span>{option.description}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
