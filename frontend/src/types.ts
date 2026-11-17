export type CategoryType = 'needs' | 'wants' | 'savings' | 'income' | 'exclude'
export type TransactionSource = 'ing' | 'manual'
export type CategorisedBy = 'rule' | 'ai' | 'manual'

export interface TransactionSplit {
  id: number
  category_id: number | null
  category_name: string | null
  amount_cents: number      // renamed from `amount`; integer cents
  is_refund: boolean        // v2: per-part refund flag (NULL-inherit resolved server-side)
}

export interface Transaction {
  id: number
  date: string
  description: string
  amount_cents: number      // renamed from `amount`
  source: TransactionSource
  category_id: number | null
  category_name: string | null
  confirmed: boolean
  categorised_by: CategorisedBy | null
  ai_confidence: number | null
  is_refund: boolean
  set_aside_id: number | null
  set_aside_name: string | null
  splits: TransactionSplit[]
}

/** A likely category for a payment waiting to be sorted, most likely first (Claude's guess leads). */
export interface ReviewOption {
  category_id: number
  label: string
  /** Money coming back on an earlier purchase in this category. */
  refund: boolean
}

/** The next payment to sort, with the answers to offer as one tap. */
export interface ReviewTransaction extends Transaction {
  options?: ReviewOption[]
}

// Request payload for split parts — NO per-part refund on input (wire has none).
export interface SplitInput {
  category_id: number
  amount_cents: number
}

/** A bill that does not come monthly, spread over the months before it is due, as one month sees it. */
export interface SetAside {
  id: number
  name: string
  amount_cents: number
  start_month: string        // YYYY-MM
  due_month: string          // YYYY-MM
  every_months: number | null // how often it comes back (3: quarterly, 12: yearly); null: once
  monthly_cents: number      // this month's share, which lowers what is free to spend
  saved_cents: number        // set aside so far for the bill that is coming
  /** The payment that settled the bill; `counted_cents` of it had not been set aside yet and counts as spending. */
  payment: { transaction_id: number; date: string; description: string; amount_cents: number; counted_cents: number } | null
  over: boolean              // a one-off whose due month has passed
}
export interface SetAsides { month: string; items: SetAside[]; set_aside_cents: number }

/** What can still be spent freely this month: the Month page's headline. */
export interface FreeToSpend {
  free_cents: number
  per_day_cents: number | null
  left_in_plan_cents: number
  bills_cents: number
  bills: Array<{ key: string; name: string; amount_cents: number; next_date: string | null; category_name: string }>
  set_aside_cents: number
  set_asides: Array<{ id: number; name: string; monthly_cents: number }>
  // The money's view: in + still expected in - out - saved - still to save - bills - set-asides.
  money_in_cents: number
  income_expected_cents: number
  income_expected: Array<{ key: string; name: string; amount_cents: number; next_date: string | null }>
  spent_cents: number
  saved_cents: number
  to_save_cents: number
  cash_left_cents: number
  outside_plan_cents: number           // cash_left less free: income above the plan
  still_to_come_cents: number          // bills + set-asides + still to save
  avg_day_cents: number | null         // null: too early, or no ordinary day yet
  avg_day_days: number | null
  avg_day_spent_cents: number | null
  days_ahead: number                   // days the average is carried over, today's part day included only if unseen
  month_end_cents: number | null
}

export interface Category {
  id: number
  name: string
  type: CategoryType
  sort_order: number
}

export interface BudgetRow {
  id: number
  category_id: number
  category_name: string
  category_type?: CategoryType   // OPTIONAL: routers omit it pre-B2
  month: string | null
  planned_amount_cents: number       // renamed from planned_amount
  actual_amount_cents: number | null // renamed from actual_amount
}

export interface Rule { id: number; pattern: string; category_id: number; category_name: string }
/** A shop that sells a bit of everything: its payments are always asked about. */
export interface AskShop { pattern: string }

// NOTE: nested keys keep their LEGACY names by wire contract; the VALUES are
// integer cents since B1 (see contracts api-contracts money_wire_format_v2).
export interface DashboardSummary {
  month: string
  total_income_cents: number
  total_expenses_cents: number
  total_savings_cents: number
  left_over_cents: number
  category_breakdown: Array<{
    category_id: number
    category_name: string
    actual_cents: number   // integer cents (B2 wire: *_cents nested keys)
    planned_cents: number  // integer cents
    type: CategoryType
  }>
  needs_wants_savings: { needs_cents: number; wants_cents: number; savings_cents: number } // integer cents
  income_breakdown: Array<{
    category_id: number
    category_name: string
    amount_cents: number // integer cents
  }>
}

export interface Pace {
  month: string
  current_month: string
  status: 'ok' | 'gap' | 'empty'
  start_date: string
  end_date: string
  today: string
  days_total: number
  day_number: number | null
  days_left: number | null
  plan_cents: { needs: number; wants: number; savings: number }
  actual_cents: { needs: number; wants: number; savings: number }
  spendable_plan_cents: number
  spendable_actual_cents: number
  free: FreeToSpend | null            // the current month with bank data only
  money_in_cents: number              // confirmed income in the month
  ordinary_day: { avg_cents: number; days: number; spent_cents: number } | null  // finished days only
  newest_bank_date: string | null
  pace_delta_cents: number | null
  daily: Array<{ date: string; cumulative_cents: number }>
  data_through: string | null
  last_import_by_bank: Array<{ source: string; last_date: string | null }>
  behind_months: string[]
  to_review: number
  to_review_in_month: number
}

export interface TrendMonth {
  month: string
  total_expenses_cents: number
  needs_cents: number
  wants_cents: number
  savings_cents: number
  total_income_cents: number
}

export interface DashboardTrends {
  months_requested: number
  start_month: string
  end_month: string
  series: TrendMonth[] // oldest first
}

export interface SettingsMap { [key: string]: string }

export interface ImportPreviewRow {
  date: string
  amount_cents: number
  description: string
  source: string
  import_hash: string
  duplicate: boolean
}

export interface ImportPreviewResponse {
  rows: ImportPreviewRow[]
  total: number
  duplicates: number
}

export interface ImportConfirmResponse {
  imported: number
  skipped_duplicates: number
  categorised_by_rule: number
  categorised_by_ai: number   // Claude was sure: counted already
  doubtful: number            // Claude was not sure: waiting for an answer
  uncategorised: number
  notes_added?: number        // rows already in that got the bank's note they were imported without
}

// The chat's own kinds and card data (docs/bot.md); the rest of a chat message is bot-kit's Message.
export interface ChatFieldChange { label: string; before: string; after: string }
export interface ChatChange { title: string; fields: ChatFieldChange[] }
export interface ChatTransactionRef {
  id: number
  date_label: string
  amount_label: string
  description: string
  category: string | null
}
/** A card's `data`: the app's preview, and how a chat shows it. */
export interface ChatCardData {
  changes: ChatChange[]
  purchase: ChatTransactionRef | null
  effect_lines: string[]   // what it does to this month's budget lines, before → after
  summed_up: boolean       // many rows, shown as a summary; the rows themselves on request
  rows: number
  payments: number
}
/** An applied card's `result`. */
export interface ChatCardResult {
  applied_text?: string
  effect_lines?: string[]  // the budget lines as they stand now
  waiting?: number         // payments still waiting for an answer, when the card sorted waiting ones
  offer?: { transaction_ids: number[]; label: string } | null
}
export interface ChatImportCounts { imported: number; skipped: number; by_rule: number; by_ai: number; doubtful?: number; uncategorised: number; noted?: number }
/** A question about payments Claude was not sure of (`kind: question`). */
export interface ChatQuestion {
  status: 'open' | 'answered'
  name: string
  incoming: boolean
  count: number
  total_cents: number
  examples: { date_label: string; amount_label: string; description: string; note: string }[]
  options: { category_id: number; label: string; refund: boolean }[]
  result?: string
}
/** Every row of a card (`kind: all_rows`): grouped by what changes. */
export interface ChatRowGroup { heading: string; rows?: { when: string; amount: string; name: string }[]; lines?: string[] }
