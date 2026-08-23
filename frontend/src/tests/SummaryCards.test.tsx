import { render, screen } from '@testing-library/react'
import SummaryCards from '../components/SummaryCards'

const mockData = {
  total_income_cents: 586026,
  total_expenses_cents: 342000,
  total_savings_cents: 40000,
  left_over_cents: 204026,
}

test('renders all four summary cards', () => {
  render(<SummaryCards {...mockData} />)
  expect(screen.getByText('Income')).toBeInTheDocument()
  expect(screen.getByText('Spent')).toBeInTheDocument()
  expect(screen.getByText('Saved')).toBeInTheDocument()
  expect(screen.getByText('Left Over')).toBeInTheDocument()
  expect(screen.getByText('€5.860,26')).toBeInTheDocument()
})
