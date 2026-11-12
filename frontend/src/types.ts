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

// Request payload for split parts — NO per-part refund on input (wire has none).
export interface SplitInput {
  category_id: number
  amount_cents: number
}

/** A yearly or irregular bill, spread over the months before it is due, as one month sees it. */
export interface SetAside {
  id: number
  name: string
  amount_cents: number
  start_month: string        // YYYY-MM
  due_month: string          // YYYY-MM
  yearly: boolean
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
}

export interface ChatFieldChange { label: string; before: string; after: string }
export interface ChatChange { title: string; fields: ChatFieldChange[] }
export interface ChatEffect {
  category: string
  when: string
  before_cents: number
  after_cents: number
  planned_before_cents: number | null
  planned_cents: number | null
}
export interface ChatTransactionRef {
  id: number
  date_label: string
  amount_label: string
  description: string
  category: string | null
}
export interface ChatCard {
  id: number
  status: 'pending' | 'applied' | 'failed' | 'rejected' | 'superseded'
  version: string
  summary: string
  note: string | null
  changes: ChatChange[]
  purchase: ChatTransactionRef | null
  effect: ChatEffect[]
  error: string | null
  result: { text: string; effect: ChatEffect[] } | null
  heading: string
  apply_label: string
  reject_label: string
  lines: string[]          // what the card says, in the app's words
  summed_up: boolean       // many rows, shown as a summary; the rows themselves on request
  rows: number
  effect_lines: string[]
  says: string | null      // Claude's words that came with the card
}
export interface ChatImportCounts { imported: number; skipped: number; by_rule: number; by_ai: number; doubtful?: number; uncategorised: number }
export interface ChatChart {
  type: 'line' | 'bars'
  title: string
  labels: string[]
  series: { name: string; values: number[] }[]
  unit: 'cents' | 'euros' | 'percent' | 'number'
}
export interface ChatMessage {
  id: number
  role: 'user' | 'assistant'
  kind: 'text' | 'file' | 'voice' | 'photo' | 'answer' | 'clarify' | 'proposal' | 'import' | 'error' | 'question' | 'nudge'
  text: string
  status: 'queued' | 'running' | 'waiting' | 'stopping' | 'done'
  reply_to: number | null
  created_at: string
  payload: (ChatImportCounts & { options?: undefined }) | { options: ChatTransactionRef[] } | { chart: ChatChart } | ChatWork | null
  card: ChatCard | null
}
/** On a person's message: the live log of the reply's steps, and how the reply ended if it was cut short. */
export interface ChatWork { steps?: string[]; ended?: 'stopped' | 'time' }
export interface ChatConversation { messages: ChatMessage[]; guesses_waiting: number; claude_busy: boolean }
