import { describe, it, expect } from 'vitest'
import { categoryStatus, elapsedShare, paymentsByCategory, projectMonthEnd } from '../pages/month/projection'
import type { Pace, Transaction } from '../types'

// Day 17 of 31, plan 5.350, files reach yesterday. Rent (1.868) and a second big payment sit in the first days.
const spentPerDay = [99.35, 0, 1868.14, 92.5, 212.64, 14.69, 32.37, 40.64, 1217.99, 31.3, 109.67, 82.75, 0, 67.63, 57.86, 35.68]
const cumulative = (amounts: number[]) => {
  let sum = 0
  return amounts.map((a, i) => ({ date: `2026-10-${24 + i}`, cumulative_cents: (sum += Math.round(a * 100)) }))
}
const pace = (over: Partial<Pace> = {}): Pace => {
  const daily = cumulative(spentPerDay)
  return {
    month: '2026-11', current_month: '2026-11', status: 'ok',
    start_date: '2026-10-24', end_date: '2026-11-23', today: '2026-11-09',
    days_total: 31, day_number: 17, days_left: 14,
    plan_cents: { needs: 0, wants: 0, savings: 0 },
    actual_cents: { needs: 0, wants: 0, savings: 0 },
    spendable_plan_cents: 535000, spendable_actual_cents: daily[daily.length - 1].cumulative_cents,
    pace_delta_cents: 0, daily, data_through: '2026-11-08',
    last_import_by_bank: [], behind_months: [], to_review: 0, to_review_in_month: 0, free: null, newest_bank_date: null, ...over,
  }
}

describe('projectMonthEnd', () => {
  it('leaves big payments out of the average and does not repeat them', () => {
    const p = pace()
    const ordinary = spentPerDay.filter(a => a < 535)
    const rate = ordinary.reduce((s, a) => s + a, 0) / ordinary.length
    const result = projectMonthEnd(p)!
    expect(result.ordinaryDayCents).toBe(Math.round(rate * 100))
    const end = p.spendable_actual_cents + rate * 100 * 15
    expect(result.gapCents).toBe(Math.round((end - 535000) / 1000) * 1000)
    expect(Math.abs(result.gapCents) % 1000).toBe(0)
  })

  it('says nothing in the first five days, after a gap, in another month, or with nothing to project', () => {
    expect(projectMonthEnd(pace({ day_number: 5 }))).toBeNull()
    expect(projectMonthEnd(pace({ status: 'gap' }))).toBeNull()
    expect(projectMonthEnd(pace({ day_number: null, days_left: null }))).toBeNull()
    expect(projectMonthEnd(pace({ spendable_plan_cents: 0 }))).toBeNull()
    expect(projectMonthEnd(pace({ daily: [] }))).toBeNull()
    expect(projectMonthEnd(pace({ daily: cumulative(Array(31).fill(10)) }))).toBeNull()
  })

  it('has no ordinary day to go by when every day was a big one', () => {
    expect(projectMonthEnd(pace({ daily: cumulative([900, 800, 700, 600, 560, 570]), day_number: 8 }))).toBeNull()
  })
})

describe('elapsedShare', () => {
  it('counts the days that are over, and only once the month is known and past the first days', () => {
    expect(elapsedShare(pace())).toBeCloseTo(16 / 31)
    expect(elapsedShare(pace({ day_number: 5 }))).toBeNull()
    expect(elapsedShare(pace({ status: 'empty' }))).toBeNull()
  })
})

describe('paymentsByCategory', () => {
  const tx = (over: Partial<Transaction>): Transaction => ({
    id: 1, date: '2026-11-01', description: 'x', amount_cents: -1000, source: 'ing', category_id: 5, category_name: 'A',
    confirmed: true, categorised_by: 'rule', ai_confidence: null, is_refund: false, set_aside_id: null, set_aside_name: null, splits: [], ...over,
  })

  it('counts payments, parts of a split by their own category, and not refunds or income', () => {
    const counts = paymentsByCategory([
      tx({}), tx({ id: 2 }), tx({ id: 3, amount_cents: 500, is_refund: true }), tx({ id: 4, amount_cents: 250000, category_id: 9 }),
      tx({ id: 5, category_id: null, amount_cents: -3000, splits: [
        { id: 1, category_id: 5, category_name: 'A', amount_cents: -1000, is_refund: false },
        { id: 2, category_id: 6, category_name: 'B', amount_cents: -2000, is_refund: false },
      ] }),
    ])
    expect(counts).toEqual({ 5: 3, 6: 1 })
  })
})

describe('categoryStatus', () => {
  const elapsed = 16 / 31
  it('calls a bill settled in one or two payments paid', () => {
    expect(categoryStatus(120000, 120000, 2, elapsed)).toEqual({ kind: 'paid' })
    expect(categoryStatus(110000, 120000, 1, null)).toEqual({ kind: 'paid' })
    expect(categoryStatus(110000, 120000, 3, elapsed)).not.toEqual({ kind: 'paid' })
  })

  it('flags a row well past the month that is on course to go over', () => {
    const status = categoryStatus(7900, 10000, 3, elapsed)
    expect(status).toEqual({ kind: 'ahead', endCents: 15000, overCents: 5000 })
  })

  it('stays quiet when spending is not ahead of the month, has too few payments, or the month is too early', () => {
    expect(categoryStatus(5000, 10000, 3, elapsed)).toBeNull()
    expect(categoryStatus(7900, 10000, 1, elapsed)).toBeNull()
    expect(categoryStatus(7900, 10000, 3, null)).toBeNull()
    expect(categoryStatus(0, 10000, 0, elapsed)).toBeNull()
  })

  it('leaves a row over plan to the row itself', () => {
    expect(categoryStatus(12000, 10000, 3, elapsed)).toBeNull()
  })
})
