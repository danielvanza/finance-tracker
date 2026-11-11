export type CategoryType = 'needs' | 'wants' | 'savings' | 'income' | 'exclude'
export type TransactionSource = 'ing' | 'revolut' | 'degiro' | 'manual'
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
  standing_adjustment_id: number | null
  splits: TransactionSplit[]
}

// Request payload for split parts — NO per-part refund on input (wire has none).
export interface SplitInput {
  category_id: number
  amount_cents: number
}

export interface StandingAdjustment {
  id: number
  name: string
  amount_cents: number     // renamed from `amount`; positive cents
  income_category_id: number
  expense_category_id: number
  active: boolean
  start_month: string
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

export interface Rule { id: number; pattern: string; category_id: number; category_name: string; priority: number }

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
  monthly_trend: Array<{ month: string; total_cents: number }> // total = integer cents
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
  pace_delta_cents: number | null
  daily: Array<{ date: string; cumulative_cents: number }>
  data_through: string | null
  last_import_by_bank: Array<{ source: string; last_date: string | null }>
  behind_months: string[]
  to_review: number
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
  categorised_by_ai: number
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
}
export interface ChatImportCounts { imported: number; skipped: number; by_rule: number; by_ai: number; uncategorised: number }
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
  kind: 'text' | 'file' | 'answer' | 'clarify' | 'proposal' | 'import' | 'error'
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
