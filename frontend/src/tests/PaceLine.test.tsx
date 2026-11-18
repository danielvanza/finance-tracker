import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import PaceLine from '../pages/month/PaceLine'
import type { Pace } from '../types'

// A 30-day month with a €3.000 plan: €100 a day by plan.
const daily = (days: number, perDay: number) =>
  Array.from({ length: days }, (_, i) => ({ date: `2026-11-${String(i + 1).padStart(2, '0')}`, cumulative_cents: perDay * (i + 1) }))

const pace = (over: Partial<Pace>): Pace => ({
  month: '2026-11', current_month: '2026-11', status: 'ok',
  start_date: '2026-11-01', end_date: '2026-11-30', today: '2026-11-20',
  days_total: 30, day_number: 20, days_left: 10,
  plan_cents: { needs: 200000, wants: 100000, savings: 0 }, actual_cents: { needs: 0, wants: 0, savings: 0 },
  spendable_plan_cents: 300000, spendable_actual_cents: 0, pace_delta_cents: null, daily: [], data_through: null,
  last_import_by_bank: [], behind_months: [], to_review: 0, to_review_in_month: 0, free: null, money_in_cents: 0,
  ordinary_day: null, newest_bank_date: null, ...over,
} as Pace)

describe('PaceLine', () => {
  it('says the verdict for the last day the files show when they stop before today', () => {
    // Ten days at €120 a day against €100 a day planned: €200 over by 10 Nov.
    render(<PaceLine pace={pace({ daily: daily(10, 12000), data_through: '2026-11-10' })} />)
    expect(screen.getByText('€200 over pace by 10 Nov')).toBeInTheDocument()
    expect(document.querySelector('.pace')!.classList.contains('is-over')).toBe(true)
    expect(screen.getByText('today')).toBeInTheDocument()
  })

  it('uses the app\'s own delta when the files reach today', () => {
    render(<PaceLine pace={pace({ daily: daily(19, 9000), data_through: '2026-11-19', pace_delta_cents: -21000 })} />)
    expect(screen.getByText('€210 under pace')).toBeInTheDocument()
    expect(document.querySelector('.pace')!.classList.contains('is-over')).toBe(false)
  })

  it('reads day by day with the arrow keys', () => {
    render(<PaceLine pace={pace({ daily: daily(10, 12000), data_through: '2026-11-10' })} />)
    const plot = screen.getByRole('group')
    fireEvent.keyDown(plot, { key: 'Home' })
    expect(plot.querySelector('[aria-live]')!.textContent).toBe('1 Nov: spent €120, plan by then €100')
  })
})
