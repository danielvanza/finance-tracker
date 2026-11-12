import { api } from '../../api'
import type { Transaction } from '../../types'
import { waitingFor } from './merchantData'
import { ruleKeyOk } from './merchantKey'

export interface RuleResult {
  /** Purchases waiting for review that now carry the category and are confirmed. */
  settled: number
  failed: number
}

/**
 * One always-categorise rule for a merchant, by its cleaned key (POST /rules), then the
 * purchases of that merchant still waiting for review are settled (PATCH /transactions/{id}).
 * Not POST /transactions/{id}/create-rule: that pins the whole description, order number and all.
 * Past, already confirmed purchases stay as they are. The caller invalidates the query caches.
 */
export async function createMerchantRule(
  key: string,
  categoryId: number,
  transactions: Transaction[],
): Promise<RuleResult> {
  if (!ruleKeyOk(key)) throw new Error(`"${key}" is too short for a rule`)
  await api.createRule({ pattern: key, category_id: categoryId })
  let settled = 0
  let failed = 0
  for (const tx of waitingFor(key, transactions)) {
    try {
      await api.patchTransaction(tx.id, { category_id: categoryId, confirmed: true })
      settled += 1
    } catch {
      failed += 1
    }
  }
  return { settled, failed }
}
