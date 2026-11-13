import { api } from '../../api'
import { describeApiError } from '../../components/ErrorBanner'

/** What one answer on the review card changed: the payment, and the shop's other waiting payments that left the queue with it. */
export interface Answer {
  id: number
  description: string
  /** The category the answer set; null for a split. */
  categoryId: number | null
  followed: number[]
  /** The tick box asked to remember the shop. */
  remember: boolean
}

const more = (n: number) => (n > 0 ? ` ${n} more followed.` : '')

/** The line said after an answer. Without an Answer (what followed is unknown) it only says what was sorted. */
export function answerLine(description: string, what: string, answer: Answer | null): string {
  const sorted = what === 'split' ? `Split ${description} into parts.` : `Sorted ${description} as ${what}.`
  if (!answer) return sorted
  return `${sorted}${more(answer.followed.length)}${answer.remember ? ' Undo keeps the shop rule.' : ''}`
}

/** The line said after Undo went through; a rule made with the tick box is kept, and it says so. */
export function undoneLine(answer: Answer, reverted: number): string {
  const rows = reverted > 1 ? ` with ${reverted - 1} more` : ''
  const rule = answer.remember ? ' The shop rule you asked for stays: remove it on the Rules page.' : ''
  return `Put ${answer.description} back in the queue${rows}.${rule}`
}

/**
 * Put back what the answer changed and nothing else. A payment is only put back while it is still as the
 * answer left it (confirmed, in that category; a shop's followers still sorted by the shop's answer), so
 * a change made since by a person, an import or the bot is never undone. One PATCH per row, as bulk.ts does.
 */
export async function undoAnswer(answer: Answer): Promise<{ reverted: number; problem?: { title: string; message: string } }> {
  let rows
  try {
    rows = await api.getTransactions()
  } catch (e) {
    return { reverted: 0, problem: { title: 'Nothing was undone', message: `The payments could not be checked. ${describeApiError(e)}` } }
  }
  const byId = new Map(rows.map(t => [t.id, t]))
  const main = byId.get(answer.id)
  const mainIntact = !!main && main.confirmed && (answer.categoryId == null || main.category_id === answer.categoryId)
  const followers = answer.categoryId == null ? [] : answer.followed.filter(id => {
    const t = byId.get(id)
    return !!t && t.confirmed && t.category_id === answer.categoryId && t.categorised_by === 'rule'
  })
  const ids = [...(mainIntact ? [answer.id] : []), ...followers]
  const results = await Promise.allSettled(ids.map(id => api.patchTransaction(id, { confirmed: false })))
  const reverted = results.filter(r => r.status === 'fulfilled').length
  const total = 1 + answer.followed.length
  if (reverted === total) return { reverted }
  const left = total - reverted
  const plural = left === 1
  const message = `${left} ${plural ? 'was' : 'were'} changed since or didn't save, so ${plural ? 'it was' : 'they were'} left as ${plural ? 'it is' : 'they are'}.`
  return {
    reverted,
    problem: reverted === 0
      ? { title: 'Nothing was undone', message }
      : { title: `${reverted} of ${total} put back in the queue`, message },
  }
}
