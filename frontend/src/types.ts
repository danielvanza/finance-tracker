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
    actual: number    // legacy key, integer cents value
    planned: number   // legacy key, integer cents value
    type: CategoryType
  }>
  needs_wants_savings: { needs: number; wants: number; savings: number }  // cents
  monthly_trend: Array<{ month: string; total: number }>                  // total = cents
  income_breakdown: Array<{
    category_id: number
    category_name: string
    amount: number    // legacy key, integer cents value
  }>
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
