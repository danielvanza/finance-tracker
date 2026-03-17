import { render, screen } from '@testing-library/react'
import SummaryCards from '../components/SummaryCards'

const mockData = {
  total_income: 5860.26,
  total_expenses: 3420.00,
  total_savings: 400.00,
  left_over: 2040.26,
}

test('renders all four summary cards', () => {
  render(<SummaryCards {...mockData} />)
  expect(screen.getByText('Income')).toBeInTheDocument()
  expect(screen.getByText('Spent')).toBeInTheDocument()
  expect(screen.getByText('Saved')).toBeInTheDocument()
  expect(screen.getByText('Left Over')).toBeInTheDocument()
  expect(screen.getByText('€5.860,26')).toBeInTheDocument()
})
