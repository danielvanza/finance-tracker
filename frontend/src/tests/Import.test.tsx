import { render, screen, fireEvent } from '@testing-library/react'
import Import from '../pages/Import'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const wrap = (ui: React.ReactElement) =>
  render(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>)

test('renders source selector and file upload', () => {
  wrap(<Import />)
  // Source is now a button group — check the ING button is present
  expect(screen.getByRole('button', { name: /^ING$/i })).toBeInTheDocument()
  // Other source buttons should also be present
  expect(screen.getByRole('button', { name: /^REVOLUT$/i })).toBeInTheDocument()
})

test('shows preview button after file selected', () => {
  wrap(<Import />)
  const input = screen.getByLabelText(/CSV file/i)
  const file = new File(['test'], 'test.csv', { type: 'text/csv' })
  fireEvent.change(input, { target: { files: [file] } })
  expect(screen.getByRole('button', { name: /preview/i })).toBeInTheDocument()
})
