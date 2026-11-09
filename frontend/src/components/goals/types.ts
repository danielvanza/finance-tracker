export type GoalStatus = 'done' | 'late' | 'on_track' | 'short' | 'unknown' | 'open'

/** One goal as GET /api/goals returns it. Money is integer cents; `by` and `reach` are financial months, YYYY-MM. */
export interface Goal {
  name: string
  category_id: number
  category_name: string
  target_cents: number
  start_cents: number // in the pot when the goal started
  started: string // YYYY-MM-DD
  by: string | null
  saved_cents: number
  status: GoalStatus
  needed_cents: number | null // a month, to reach the target by `by`
  pace_cents: number | null // a month, null until two finished months have bank data
  short_cents: number | null // a month, when the pace is under what is needed
  reach: string | null // projected month at the current pace
  tick_pct: number | null // where an even path from the start to `by` would be today
}

export interface SavingsCategory {
  id: number
  name: string
}

export interface GoalsResponse {
  goals: Goal[]
  savings_categories: SavingsCategory[]
  max_goals: number
  current_month: string
  today: string
}

/** One goal as PUT /api/goals takes it. Leave `started` out for a new goal. */
export interface GoalInput {
  name: string
  category_id: number
  target_cents: number
  start_cents: number
  by: string | null
  started?: string
}
