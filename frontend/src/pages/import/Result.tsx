import { Link } from 'react-router-dom'
import type { ImportConfirmResponse } from '../../types'
import { BANKS } from './bank'

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

interface Props {
  data: ImportConfirmResponse
  bank: string
  /** Set while picking up after a gap: the next bank still behind, or null when they are all in. */
  catchup: { next: string | null; toReview: number } | null
  headingRef: React.Ref<HTMLHeadingElement>
  onAgain: (bank?: string) => void
}

/** What was added, what needs a look, then the next step. The full count folds away. */
export default function Result({ data, bank, catchup, headingRef, onAgain }: Props) {
  // Rule matches are confirmed on import; guesses and anything left over need a person.
  const review = data.categorised_by_ai + data.uncategorised
  const added = `${plural(data.imported, 'transaction')}${data.skipped_duplicates ? `, ${data.skipped_duplicates} already in` : ''}`

  const line =
    review > 0 ? (
      <>
        {data.categorised_by_rule > 0 && (
          <><strong>{plural(data.categorised_by_rule, 'row')}</strong> sorted by your rules, </>
        )}
        <strong>{review}</strong> {review === 1 ? 'needs' : 'need'} a look.
      </>
    ) : (
      <>All <strong>{data.imported}</strong> sorted by your rules. Nothing to review.</>
    )

  const backlog = catchup && catchup.toReview > 0 ? catchup.toReview : review
  const next = catchup?.next ?? null
  const primary = next ? (
    <button type="button" className="btn btn-primary" onClick={() => onAgain(next)}>Next: {BANKS[next]}</button>
  ) : backlog > 0 ? (
    <Link to="/transactions" className="btn btn-primary">Review {plural(backlog, 'transaction')}</Link>
  ) : (
    <Link to="/" className="btn btn-primary">See the month</Link>
  )

  return (
    <section className="panel import-done" aria-labelledby="import-result-title">
      <h2 id="import-result-title" className="lab import-done-label" tabIndex={-1} ref={headingRef}>
        {catchup ? `${BANKS[bank]} added` : 'Import finished'}
      </h2>
      <p className="import-done-title num">{catchup ? added : `Added ${added}`}</p>
      <p className="import-done-line num">{line}</p>
      <div className="import-done-actions">
        {primary}
        {next ? (
          review > 0 && <Link to="/transactions" className="btn">Review first</Link>
        ) : (
          <button type="button" className="btn" onClick={() => onAgain()}>Import another file</button>
        )}
      </div>
      <details className="import-more">
        <summary>The full count</summary>
        <dl className="import-tally num">
          <div><dt>Imported</dt><dd>{data.imported}</dd></div>
          <div><dt>Skipped duplicates</dt><dd>{data.skipped_duplicates}</dd></div>
          <div><dt>Categorised by rule</dt><dd>{data.categorised_by_rule}</dd></div>
          <div><dt>Categorised by AI</dt><dd>{data.categorised_by_ai}</dd></div>
          <div><dt>Uncategorised</dt><dd>{data.uncategorised}</dd></div>
        </dl>
      </details>
    </section>
  )
}
