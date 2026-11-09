import { centsToInputString } from '../../money'
import type { CsvTransaction } from './types'

const BOM = '\uFEFF'
const SEPARATOR = ';'
const HEADER = ['date', 'description', 'amount', 'amount_cents', 'category', 'source', 'confirmed', 'refund', 'split']

/** 1234 -> "12,34": a decimal comma and no thousands mark, so a Dutch Excel reads it as a number. */
const decimalComma = (cents: number) => centsToInputString(cents).replace('.', ',')

/** Quote a field when it holds the separator, a quote or a line break. */
function field(value: string, isText = true) {
  // A text that starts like a formula would run in a spreadsheet: a leading apostrophe keeps it text.
  const safe = isText && /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
  return /[;"\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

const line = (cells: string[]) => cells.join(SEPARATOR)

/**
 * Transactions as a CSV text for a Dutch spreadsheet: `;` between fields, a decimal comma, a UTF-8 byte-order
 * mark first and CRLF line ends. `amount` is for reading, `amount_cents` is the same in every locale.
 * A split transaction lists its categories in `category` and each part and amount in `split`.
 * Text that begins with = + - @ gets a leading apostrophe, so a description can never run as a formula.
 */
export function toCsv(rows: readonly CsvTransaction[]): string {
  const body = rows.map(t => {
    const parts = t.splits.map(s => s.category_name ?? '').filter(Boolean)
    const category = t.splits.length > 0 ? parts.join(' + ') : (t.category_name ?? '')
    const split = t.splits.map(s => `${s.category_name ?? 'No category'} ${decimalComma(s.amount_cents)}`).join(' + ')
    return line([
      t.date,
      field(t.description),
      decimalComma(t.amount_cents),
      String(t.amount_cents),
      field(category),
      t.source,
      t.confirmed ? 'yes' : 'no',
      t.is_refund ? 'yes' : 'no',
      field(split),
    ])
  })
  return BOM + [line(HEADER), ...body].join('\r\n') + '\r\n'
}

/** Hands a text to the browser as a file download. */
export function downloadText(text: string, filename: string, type = 'text/csv;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export const downloadCsv = (rows: readonly CsvTransaction[], filename: string) =>
  downloadText(toCsv(rows), filename)

/** A file name for today's export, e.g. "finances-transactions-2026-11-09.csv". */
export const csvFilename = (what: string, date = new Date()) =>
  `finances-${what}-${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}.csv`
