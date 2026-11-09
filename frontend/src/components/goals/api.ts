import { apiFetch, BASE } from '../../api'
import type { GoalInput, GoalsResponse } from './types'

export const goalsApi = {
  getGoals: (): Promise<GoalsResponse> => apiFetch(`${BASE}/goals`),

  /** Replaces the whole list; the answer is the fresh GET. */
  putGoals: (goals: GoalInput[]): Promise<GoalsResponse> =>
    apiFetch(`${BASE}/goals`, { method: 'PUT', body: { goals } }),
}
