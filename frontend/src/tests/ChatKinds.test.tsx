import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { Message } from 'bot-kit/client'
import { Reminder } from '../chat/kinds'

describe('Reminder message kind', () => {
  it('shows the household\'s words after "Reminder:"', () => {
    const message = { id: 5, kind: 'reminder', role: 'assistant', text: 'Move money to savings', payload: { reminder_id: 1 } } as unknown as Message
    render(<Reminder {...({ message } as unknown as Parameters<typeof Reminder>[0])} />)
    expect(screen.getByText('Reminder: Move money to savings')).toBeTruthy()
  })
})
