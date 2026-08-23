import { describe, it, expect } from 'vitest'
import {
  formatCents,
  parseToCents,
  centsToInputString,
  sumCents,
  splitRemainingCents,
} from '../money'

describe('formatCents', () => {
  it('formats zero', () => {
    expect(formatCents(0)).toBe('€0,00')
  })

  it('groups thousands with dots and uses comma decimals', () => {
    expect(formatCents(123456)).toBe('€1.234,56')
  })

  it('puts sign before the euro symbol', () => {
    expect(formatCents(-3499)).toBe('-€34,99')
  })

  it('always shows two decimals for small values', () => {
    expect(formatCents(5)).toBe('€0,05')
    expect(formatCents(99)).toBe('€0,99')
    expect(formatCents(-5)).toBe('-€0,05')
  })

  it('never emits a plus sign', () => {
    expect(formatCents(3499)).toBe('€34,99')
  })

  it('formats six-digit cent values', () => {
    expect(formatCents(586026)).toBe('€5.860,26')
  })

  it('throws TypeError on non-integer input', () => {
    expect(() => formatCents(12.5)).toThrow(TypeError)
  })
})

describe('parseToCents', () => {
  it('accepts comma as decimal separator', () => {
    expect(parseToCents('12,50')).toBe(1250)
  })

  it('accepts dot as decimal separator', () => {
    expect(parseToCents('12.50')).toBe(1250)
  })

  it('treats bare digits as whole euros', () => {
    expect(parseToCents('1250')).toBe(125000)
  })

  it('parses negative amounts', () => {
    expect(parseToCents('-34,99')).toBe(-3499)
  })

  it('parses explicit plus sign', () => {
    expect(parseToCents('+12,00')).toBe(1200)
  })

  it('rounds HALF_UP at the third decimal', () => {
    expect(parseToCents('0,005')).toBe(1)
    expect(parseToCents('0,004')).toBe(0)
    expect(parseToCents('0,995')).toBe(100)
    expect(parseToCents('-0,005')).toBe(-1)
  })

  it('pads missing fraction digits on the right', () => {
    expect(parseToCents('12,5')).toBe(1250)
  })

  it('rejects invalid input with null', () => {
    expect(parseToCents('')).toBeNull()
    expect(parseToCents('   ')).toBeNull()
    expect(parseToCents('abc')).toBeNull()
    expect(parseToCents('-')).toBeNull()
    expect(parseToCents('.')).toBeNull()
    expect(parseToCents('12,3,4')).toBeNull()
    expect(parseToCents('1.234,56')).toBeNull()
    expect(parseToCents('12a')).toBeNull()
  })
})

describe('centsToInputString', () => {
  it('produces canonical editable form without grouping', () => {
    expect(centsToInputString(1234)).toBe('12.34')
    expect(centsToInputString(0)).toBe('0.00')
    expect(centsToInputString(-3499)).toBe('-34.99')
    expect(centsToInputString(123456)).toBe('1234.56')
  })
})

describe('round-trip', () => {
  it('input string -> cents -> input string is stable', () => {
    for (const s of ['12.34', '-34.99', '0.00', '1234.56']) {
      expect(centsToInputString(parseToCents(s)!)).toBe(s)
      expect(parseToCents(centsToInputString(parseToCents(s)!))).toBe(
        parseToCents(s),
      )
    }
  })
})

describe('splitRemainingCents', () => {
  it('returns zero when parts exactly cover the total', () => {
    expect(
      splitRemainingCents(1000, [{ amount_cents: 400 }, { amount_cents: 600 }]),
    ).toBe(0)
  })

  it('handles negative totals and partial coverage', () => {
    expect(splitRemainingCents(-3499, [{ amount_cents: -3000 }])).toBe(-499)
  })
})

describe('sumCents', () => {
  it('returns 0 for empty input', () => {
    expect(sumCents([])).toBe(0)
  })

  it('cancels opposite values', () => {
    expect(sumCents([-5, 5])).toBe(0)
  })
})
