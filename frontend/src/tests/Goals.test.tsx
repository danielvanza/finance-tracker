import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import GoalsSection from '../components/goals/GoalsSection'
import { describeGoal } from '../components/goals/describe'
import { ApiError } from '../api'
import type { Goal, GoalsResponse } from '../components/goals/types'

const goal = (over: Partial<Goal> = {}): Goal => ({
  name: 'Holiday, Portugal', category_id: 15, category_name: 'Fun Account',
  target_cents: 300000, start_cents: 40000, started: '2026-08-01', by: '2027-07',
  saved_cents: 124000, status: 'on_track', needed_cents: 21944, pace_cents: 25000,
  short_cents: null, reach: null, tick_pct: 36, ...over,
})

const response = (goals: Goal[], over: Partial<GoalsResponse> = {}): GoalsResponse => ({
  goals,
  savings_categories: [{ id: 14, name: 'DEGIRO' }, { id: 15, name: 'Fun Account' }, { id: 16, name: 'Savings Transfer' }],
  max_goals: 5, current_month: '2026-11', today: '2026-11-09', ...over,
})

const mocks = vi.hoisted(() => ({ getGoals: vi.fn(), putGoals: vi.fn() }))
vi.mock('../components/goals/api', () => ({ goalsApi: mocks }))

function renderSection() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={qc}><GoalsSection /></QueryClientProvider>)
}

describe('describeGoal', () => {
  it('says on track with what is needed and the pace', () => {
    expect(describeGoal(goal())).toEqual({ says: 'On track for Jul 2027', facts: 'Needs €220 a month · saving about €250 a month' })
  })

  it('says how far short, rounded up to a whole euro', () => {
    const g = goal({ status: 'short', short_cents: 13450, needed_cents: 28500, pace_cents: 15000, by: '2027-12' })
    expect(describeGoal(g)).toEqual({ says: '€135 a month short of Dec 2027', facts: 'Needs €285 a month · saving about €150 a month' })
  })

  it("can't tell without a pace, and still says what the date needs", () => {
    const g = goal({ status: 'unknown', pace_cents: null, needed_cents: 37500 })
    expect(describeGoal(g)).toEqual({ says: "Can't tell yet", facts: 'Needs €375 a month · a pace shows after two months of saving' })
  })

  it('without a date it projects a month only when something is being added', () => {
    const open = goal({ status: 'open', by: null, needed_cents: null, tick_pct: null })
    expect(describeGoal({ ...open, pace_cents: 30000, reach: '2028-03' })).toEqual({
      says: 'No date set', facts: 'Saving about €300 a month, so about Mar 2028',
    })
    expect(describeGoal({ ...open, pace_cents: 0 }).facts).toBe('Nothing added lately')
    expect(describeGoal({ ...open, pace_cents: null }).facts).toBe('A pace shows after two months of saving')
  })

  it('knows when the target is reached or the date has passed', () => {
    expect(describeGoal(goal({ status: 'done', saved_cents: 300000 })).says).toBe('Target reached')
    const late = describeGoal(goal({ status: 'late', by: '2026-10', pace_cents: 20000, reach: '2027-06' }))
    expect(late.says).toBe('Was due Oct 2026')
    expect(late.facts).toBe('€1.760 to go · saving about €200 a month, so about Jun 2027')
  })
})

describe('GoalsSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.putGoals.mockImplementation(async () => response([]))
  })

  it('lists each goal with saved of target, a sentence and the facts', async () => {
    mocks.getGoals.mockResolvedValue(response([goal(), goal({ name: 'Buffer', category_id: 14, status: 'open', by: null, tick_pct: null, pace_cents: null, saved_cents: 410000, target_cents: 900000, needed_cents: null })]))
    renderSection()
    const row = await screen.findByRole('button', { name: /Holiday, Portugal/ })
    expect(screen.getByRole('heading', { name: 'Savings goals' })).toBeInTheDocument()
    expect(row).toHaveTextContent('€1.240 of €3.000')
    expect(row).toHaveTextContent('On track for Jul 2027')
    expect(row.querySelector('.meter b')).toHaveStyle({ left: '36%' })
    expect(row.querySelector('.meter i')).toHaveStyle({ width: '41.333333333333336%' })
    const buffer = screen.getByRole('button', { name: /Buffer/ })
    expect(buffer.querySelector('.meter b')).toBeNull() // no date, no tick
  })

  it('invites a first goal when there are none, and adds it', async () => {
    mocks.getGoals.mockResolvedValue(response([]))
    renderSection()
    expect(await screen.findByText(/No goals yet/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Add a goal' }))
    const sheet = screen.getByRole('dialog', { name: 'New goal' })
    fireEvent.change(within(sheet).getByLabelText('Name'), { target: { value: 'New car' } })
    fireEvent.change(within(sheet).getByLabelText('Saved into'), { target: { value: '16' } })
    fireEvent.change(within(sheet).getByLabelText('Target (€)'), { target: { value: '6000' } })
    fireEvent.change(within(sheet).getByLabelText('By (optional)'), { target: { value: '2027-12' } })
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(mocks.putGoals).toHaveBeenCalledWith([
      { name: 'New car', category_id: 16, target_cents: 600000, start_cents: 0, by: '2027-12' },
    ]))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('offers only the categories no other goal has taken', async () => {
    mocks.getGoals.mockResolvedValue(response([goal()]))
    renderSection()
    fireEvent.click(await screen.findByRole('button', { name: 'Add a goal' }))
    const options = within(screen.getByLabelText('Saved into')).getAllByRole('option').map(o => o.textContent)
    expect(options).toEqual(['DEGIRO', 'Savings Transfer'])
  })

  it('edits a goal in place, keeping its start, and sends the others as they were', async () => {
    mocks.getGoals.mockResolvedValue(response([goal(), goal({ name: 'Buffer', category_id: 14, by: null })]))
    renderSection()
    fireEvent.click(await screen.findByRole('button', { name: /Holiday, Portugal/ }))
    const sheet = screen.getByRole('dialog', { name: 'Edit goal' })
    expect(within(sheet).getByLabelText('Target (€)')).toHaveValue('3000')
    fireEvent.change(within(sheet).getByLabelText('Target (€)'), { target: { value: '3500,50' } })
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(mocks.putGoals).toHaveBeenCalled())
    expect(mocks.putGoals.mock.calls[0][0]).toEqual([
      { name: 'Holiday, Portugal', category_id: 15, target_cents: 350050, start_cents: 40000, by: '2027-07', started: '2026-08-01' },
      { name: 'Buffer', category_id: 14, target_cents: 300000, start_cents: 40000, by: null, started: '2026-08-01' },
    ])
  })

  it('starts afresh when a goal moves to another category', async () => {
    mocks.getGoals.mockResolvedValue(response([goal()]))
    renderSection()
    fireEvent.click(await screen.findByRole('button', { name: /Holiday, Portugal/ }))
    fireEvent.change(screen.getByLabelText('Saved into'), { target: { value: '16' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(mocks.putGoals).toHaveBeenCalled())
    expect(mocks.putGoals.mock.calls[0][0][0]).not.toHaveProperty('started')
  })

  it('removes a goal', async () => {
    mocks.getGoals.mockResolvedValue(response([goal(), goal({ name: 'Buffer', category_id: 14 })]))
    renderSection()
    fireEvent.click(await screen.findByRole('button', { name: /Holiday, Portugal/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(mocks.putGoals).toHaveBeenCalled())
    expect(mocks.putGoals.mock.calls[0][0].map((g: { name: string }) => g.name)).toEqual(['Buffer'])
  })

  it('keeps the sheet open and says why when the form is wrong or the save fails', async () => {
    mocks.getGoals.mockResolvedValue(response([goal()]))
    renderSection()
    fireEvent.click(await screen.findByRole('button', { name: /Holiday, Portugal/ }))
    fireEvent.change(screen.getByLabelText('Target (€)'), { target: { value: '0' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a target above zero')
    expect(mocks.putGoals).not.toHaveBeenCalled()

    fireEvent.change(screen.getByLabelText('Target (€)'), { target: { value: '3000' } })
    mocks.putGoals.mockRejectedValueOnce(new ApiError(422, 'x', 'One goal for each savings category'))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('One goal for each savings category')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('closes on Escape', async () => {
    mocks.getGoals.mockResolvedValue(response([goal()]))
    renderSection()
    fireEvent.click(await screen.findByRole('button', { name: /Holiday, Portugal/ }))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('hides Add at five goals and says why', async () => {
    const five = [14, 15, 16, 17, 18].map(id => goal({ name: `G${id}`, category_id: id }))
    mocks.getGoals.mockResolvedValue(response(five, { savings_categories: five.map(g => ({ id: g.category_id, name: g.name })) }))
    renderSection()
    expect(await screen.findByText('5 goals is the most.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add a goal' })).toBeNull()
  })

  it('shows an error when the goals cannot be loaded', async () => {
    mocks.getGoals.mockRejectedValue(new ApiError(500, 'x', null))
    renderSection()
    expect(await screen.findByRole('alert')).toHaveTextContent('Server error 500')
  })
})
