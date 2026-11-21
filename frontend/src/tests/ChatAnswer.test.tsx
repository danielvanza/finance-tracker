import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { RendererProps } from 'bot-kit/bubble'
import type { Message } from 'bot-kit/client'
import { Answer } from '../chat/kinds'

const message = (payload: Record<string, unknown>, text = 'Here are the groceries of this year.') =>
  ({ id: 9, conversation_id: 1, channel: 'bubble', role: 'assistant', kind: 'answer', text, payload, buttons: [] }) as unknown as Message

const props = (m: Message) => ({
  message: m,
  bot: { messages: [m], sending: false, inFlight: false, busyActions: new Set(), actionErrors: {}, choose: vi.fn(), action: vi.fn() },
  client: { imageUrl: (id: number, theme = 'day') => `/api/chat/messages/${id}/image?theme=${theme}` },
}) as unknown as RendererProps

describe('an answer in the bubble', () => {
  it('offers the file it made as a download under the words', () => {
    render(<>{Answer(props(message({ export: { id: 4, filename: 'Groceries 2026.csv', rows: 1234, columns: ['date'] } })))}</>)
    expect(screen.getByText('Here are the groceries of this year.')).toBeInTheDocument()
    const link = screen.getByRole('link', { name: /Groceries 2026\.csv/ })
    expect(link).toHaveAttribute('href', '/api/exports/4')
    expect(link).toHaveAttribute('download', 'Groceries 2026.csv')
    expect(link).toHaveTextContent('1.234 rows')
  })

  it('says when the file holds only the first rows', () => {
    render(<>{Answer(props(message({ export: { id: 5, filename: 'All.csv', rows: 20000, columns: [], cut_off: true } })))}</>)
    expect(screen.getByRole('link')).toHaveTextContent('first 20.000 rows')
  })

  it('is drawn as before without a file: words, choices and a chart', () => {
    const m = message({ options: [{ id: 3, label: 'Jumbo', detail: '3 Nov · -€4,50' }], image: { alt: 'Groceries per month' } })
    render(<>{Answer(props(m))}</>)
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.getByRole('button', { name: /Jumbo/ })).toBeEnabled()
    expect(screen.getByRole('img', { name: 'Groceries per month' })).toHaveAttribute('src', '/api/chat/messages/9/image?theme=day')
  })
})
