import type { Transaction } from '../../types'

/** One financial month in the sheet's bars. `label` is the month the period is named after ("2026-11"). */
export interface MerchantMonth {
  label: string
  short: string
  /** Net spend in cents, refunds netted off. */
  cents: number
  purchases: number
  /** Still running, or the bank files may not reach it yet: drawn with a dashed track. */
  partial: boolean
  /** No bank data yet (listed in pace.behind_months) and nothing recorded: empty track and a dash. */
  noData: boolean
}

export interface MerchantModel {
  key: string
  name: string
  /** Every transaction under this key, newest first. */
  history: Transaction[]
  /** Distinct bank descriptions, most used first. */
  raws: string[]
  months: MerchantMonth[]
  windowCents: number
  windowPurchases: number
  /** Categories the purchases are sorted into, most used first. */
  categories: Array<{ id: number; name: string; count: number }>
  /** Purchases with no category yet. */
  unsorted: number
  /** The category most purchases are in, or null. */
  topCategoryId: number | null
  /** Unconfirmed purchases a new rule would settle. */
  waiting: Transaction[]
  /** Spend and purchase count for every financial month the merchant appears in. */
  byMonth: Record<string, { cents: number; purchases: number }>
}

export interface RankedMerchant {
  key: string
  name: string
  /** A bank description to open the sheet with. */
  sample: string
  cents: number
  purchases: number
}

export type MerchantScope = 'month' | 'six' | 'all'
export type MerchantView = 'transactions' | 'merchants'
