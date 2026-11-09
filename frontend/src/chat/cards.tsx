import { formatCents } from '../money'
import type { ChatCard, ChatEffect, ChatImportCounts, ChatTransactionRef } from '../types'

export type CardAction = 'apply' | 'reject'
export type CardError = { unknown: boolean; action: CardAction }

const plan = (cents: number | null) => (cents === null ? '' : ` of ${formatCents(cents)}`)

function EffectRow({ effect }: { effect: ChatEffect }) {
  const planChanged = effect.planned_before_cents !== effect.planned_cents
  return (
    <div className="chat-row">
      <dt>{effect.category} {effect.when}</dt>
      <dd>
        {effect.before_cents !== effect.after_cents && (
          <><s>{formatCents(effect.before_cents)}</s> → </>
        )}
        {formatCents(effect.after_cents)}
        {planChanged && effect.planned_before_cents !== null ? <> of <s>{formatCents(effect.planned_before_cents)}</s> → </> : effect.planned_cents === null ? '' : ' of '}
        {effect.planned_cents === null ? '' : formatCents(effect.planned_cents)}
      </dd>
    </div>
  )
}

/** The proposed change, field by field, then what became of it. */
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
        <p><span className="chat-done">Done.</span> {card.result?.text}</p>
        {card.result?.effect.map(e => (
          <p key={e.category + e.when}>{e.category} {e.when}: {formatCents(e.after_cents)}{plan(e.planned_cents)}</p>
        ))}
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
    <div className="chat-card" data-state="pending">
      <p className="lab">{card.heading}</p>
      <p className="chat-summary">{card.summary}</p>
      {card.note && <p className="chat-note">{card.note}</p>}
      {card.changes.map(change => (
        <div key={change.title} className="chat-change">
          <p className="lab">{change.title}</p>
          <dl>
            {change.fields.map(field => (
              <div className="chat-row" key={field.label}>
                <dt>{field.label}</dt>
                <dd><s>{field.before}</s> → {field.after}</dd>
              </div>
            ))}
          </dl>
        </div>
      ))}
      {(card.purchase || card.effect.length > 0) && (
        <dl className="chat-change">
          {card.purchase && (
            <div className="chat-row">
              <dt>Refund for</dt>
              <dd>{card.purchase.description}, {card.purchase.date_label}</dd>
            </div>
          )}
          {card.effect.map(effect => <EffectRow key={effect.category + effect.when} effect={effect} />)}
        </dl>
      )}
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
    ['Sorted by rules', counts.by_rule],
    ['Guesses to review', counts.by_ai],
    ["Couldn't be sorted", counts.uncategorised],
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
