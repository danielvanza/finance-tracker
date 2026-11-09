import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import CsvChip from '../components/reports/CsvChip'
import { toCsv } from '../components/reports/csv'
import type { CsvTransaction } from '../components/reports/types'

const tx = (over: Partial<CsvTransaction> = {}): CsvTransaction => ({
  date: '2026-10-05', description: 'Albert Heijn', amount_cents: -1234, source: 'ing', category_name: 'Food - Essential',
  confirmed: true, is_refund: false, splits: [], ...over,
})

describe('toCsv', () => {
  it('opens in a Dutch spreadsheet: BOM, semicolons, decimal comma, cents column, CRLF', () => {
    const text = toCsv([tx(), tx({ description: 'Salary', amount_cents: 420000, category_name: 'Salary', confirmed: false })])
    expect(text.startsWith('﻿date;description;amount;amount_cents;category;source;confirmed;refund;split\r\n')).toBe(true)
    const lines = text.split('\r\n')
    expect(lines[1]).toBe('2026-10-05;Albert Heijn;-12,34;-1234;Food - Essential;ing;yes;no;')
    expect(lines[2]).toBe('2026-10-05;Salary;4200,00;420000;Salary;ing;no;no;')
    expect(lines[3]).toBe('')
  })

  it('has just the header when nothing is listed', () => {
    expect(toCsv([])).toBe('﻿date;description;amount;amount_cents;category;source;confirmed;refund;split\r\n')
  })

  it('quotes fields with the separator, quotes or line breaks', () => {
    const line = toCsv([tx({ description: 'A; "B"\nC' })]).split('\r\n')
    expect(`${line[1]}\r\n${line[2]}`).toContain('"A; ""B""\nC"')
  })

  it('stops a description from running as a formula', () => {
    const text = toCsv([tx({ description: '=SUM(A1)' }), tx({ description: '-dash' })])
    expect(text).toContain(";'=SUM(A1);")
    expect(text).toContain(";'-dash;")
    // Numbers stay numbers.
    expect(text).toContain(';-12,34;-1234;')
  })

  it('lists the parts of a split transaction', () => {
    const text = toCsv([tx({
      amount_cents: -3050, category_name: null,
      splits: [{ category_name: 'Food - Essential', amount_cents: -2025 }, { category_name: null, amount_cents: -1025 }],
    })])
    expect(text).toContain(';Food - Essential;ing;yes;no;Food - Essential -20,25 + No category -10,25\r\n')
  })

  it('writes cents under a euro with a leading zero', () => {
    expect(toCsv([tx({ amount_cents: -5 })])).toContain(';-0,05;-5;')
  })
})

describe('CsvChip', () => {
  let click: ReturnType<typeof vi.fn>
  let blobs: Blob[]

  beforeEach(() => {
    blobs = []
    URL.createObjectURL = vi.fn((b: Blob) => { blobs.push(b); return 'blob:x' })
    URL.revokeObjectURL = vi.fn()
    click = vi.fn()
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(click)
  })
  afterEach(() => vi.restoreAllMocks())

  it('downloads exactly the rows it was given', async () => {
    render(<CsvChip rows={[tx(), tx({ description: 'Jumbo' })]} filename="listed.csv" />)
    fireEvent.click(screen.getByRole('button', { name: 'CSV' }))
    expect(click).toHaveBeenCalledOnce()
    const text = await new Promise<string>(res => {
      const r = new FileReader()
      r.onload = () => res(String(r.result))
      r.readAsText(blobs[0])
    })
    expect(text.split('\r\n').filter(Boolean)).toHaveLength(3)
    expect(text).toContain('Jumbo')
  })

  it('is flat and does nothing without rows', () => {
    render(<CsvChip rows={[]} />)
    const chip = screen.getByRole('button', { name: 'CSV' })
    expect(chip).toBeDisabled()
    fireEvent.click(chip)
    expect(click).not.toHaveBeenCalled()
  })
})
