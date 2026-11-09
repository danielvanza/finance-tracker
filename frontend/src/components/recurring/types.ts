/** One repeating payment found in the bank history (GET /recurring). Money is integer cents. */
export type RecurringState = 'paid' | 'due' | 'expected' | 'later' | 'stopped'

export interface RecurringItem {
  key: string
  name: string
  category_name: string
  category_type: 'needs' | 'wants' | 'savings'
  cadence: 'weekly' | 'fortnightly' | 'monthly' | 'quarterly' | 'yearly'
  amount_cents: number
  last_date: string
  /** The next payment; null once it has stopped. */
  next_date: string | null
  state: RecurringState
  /** Payments still to come before the month ends. */
  remaining: number
  price_change: { from_cents: number; to_cents: number } | null
  /** The last four payments, newest first. */
  history: { date: string; amount_cents: number }[]
}

export interface Recurring {
  month: string
  start_date: string
  end_date: string
  today: string
  /** The latest bank file date, or null when there is none. */
  data_through: string | null
  /** none: nothing repeats yet; gap: the bank files are behind, so nothing can be matched. */
  status: 'ok' | 'gap' | 'none'
  due_cents: number
  expected_cents: number
  items: RecurringItem[]
}
