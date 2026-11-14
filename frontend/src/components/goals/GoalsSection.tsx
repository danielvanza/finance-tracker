import '../../styles/goals.css'
import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { formatEuros } from '../../money'
import ErrorBanner, { describeApiError } from '../ErrorBanner'
import { goalsApi } from './api'
import { describeGoal } from './describe'
import GoalSheet from './GoalSheet'
import type { Goal, GoalInput, GoalsResponse } from './types'

const toInput = (g: Goal): GoalInput => ({
  name: g.name,
  category_id: g.category_id,
  target_cents: g.target_cents,
  start_cents: g.start_cents,
  by: g.by,
  started: g.started,
})

const percent = (cents: number, of: number) => Math.max(0, Math.min(100, (cents / of) * 100))

function Row({ goal, onOpen }: { goal: Goal; onOpen: () => void }) {
  const { says } = describeGoal(goal)
  return (
    <li className="goal">
      <button type="button" className="goal-btn" aria-haspopup="dialog" onClick={onOpen}>
        <span className="goal-top">
          <span className="goal-name">{goal.name}</span>
          <span className="goal-amount num">
            {formatEuros(goal.saved_cents)}<small> of {formatEuros(goal.target_cents)}</small>
          </span>
        </span>
        <span className="meter" aria-hidden="true">
          <i style={{ width: `${percent(goal.saved_cents, goal.target_cents)}%` }} />
          {goal.tick_pct !== null && <b style={{ left: `${goal.tick_pct}%` }} />}
        </span>
        <span className="goal-says">{says}</span>
      </button>
    </li>
  )
}

/**
 * Savings goals for Trends: `<GoalsSection />` inside `.trends-grid`. It fetches and saves by itself
 * (GET and PUT /api/goals) and renders its own `<section className="section">` with a heading.
 */
export default function GoalsSection() {
  const qc = useQueryClient()
  const goalsQuery = useQuery({ queryKey: ['goals'], queryFn: goalsApi.getGoals })
  const [editing, setEditing] = useState<number | 'new' | null>(null)

  const data = goalsQuery.data
  const close = () => setEditing(null)

  const replace = async (goals: GoalInput[]) => {
    const next: GoalsResponse = await goalsApi.putGoals(goals)
    qc.setQueryData(['goals'], next)
    close()
  }

  const canAdd = !!data && data.goals.length < data.max_goals
    && data.savings_categories.some(c => !data.goals.some(g => g.category_id === c.id))
  const addButton = canAdd && (
    <button type="button" className="btn btn-sm" onClick={() => setEditing('new')}>Add a goal</button>
  )

  let body
  if (goalsQuery.error) {
    body = <ErrorBanner message={describeApiError(goalsQuery.error)} />
  } else if (!data) {
    body = <span className="skeleton goals-skeleton" aria-busy="true" aria-label="Loading savings goals" />
  } else {
    const { goals, savings_categories: cats, max_goals: max } = data
    const taken = (except?: Goal) => new Set(goals.filter(g => g !== except).map(g => g.category_id))
    const free = (except?: Goal) => cats.filter(c => !taken(except).has(c.id))
    const editedGoal = typeof editing === 'number' ? goals[editing] : undefined
    const limit = !canAdd && (
      <p className="goal-hint">
        {goals.length >= max ? `${max} goals is the most.` : cats.length === 0 ? 'Mark a category as savings in Setup to add a goal.' : 'Every savings category has a goal.'}
      </p>
    )

    body = (
      <>
        {goals.length === 0 ? (
          <div className="panel goal-empty">
            <p>No goals yet. Give money you are setting aside a name and a target, and it shows how long it will take.</p>
            {limit}
          </div>
        ) : (
          <div className="panel goals-panel">
            <ul className="goals-list">
              {goals.map((g, i) => <Row key={g.category_id} goal={g} onOpen={() => setEditing(i)} />)}
            </ul>
            {limit && <div className="goals-foot">{limit}</div>}
          </div>
        )}

        {editing === 'new' && (
          <GoalSheet
            categories={free()}
            onClose={close}
            onSave={input => replace([...goals.map(toInput), input])}
          />
        )}
        {editedGoal && (
          <GoalSheet
            key={editedGoal.category_id}
            goal={editedGoal}
            summary={describeGoal(editedGoal)}
            categories={free(editedGoal)}
            onClose={close}
            onSave={input => replace(goals.map(g => (g === editedGoal ? input : toInput(g))))}
            onRemove={() => replace(goals.filter(g => g !== editedGoal).map(toInput))}
          />
        )}
      </>
    )
  }

  return (
    <section className="section">
      <div className="goals-head">
        <h2>Savings goals</h2>
        {addButton}
      </div>
      {body}
    </section>
  )
}
