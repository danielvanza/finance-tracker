import { Download } from 'lucide-react'
import type { CsvTransaction } from './types'
import { csvFilename, downloadCsv } from './csv'
import '../../styles/reports.css'

/**
 * A chip that saves the transactions listed right now as a CSV file. Props: `rows` is exactly the list the page is
 * showing (filters applied); `filename` is optional. It goes on the Payments count line:
 * `<CsvChip rows={transactions} />`. With no rows it is a flat, disabled chip.
 */
export default function CsvChip({ rows, filename, className = 'btn' }: { rows: readonly CsvTransaction[]; filename?: string; className?: string }) {
  return (
    <button
      type="button"
      className={`${className} rep-csv`}
      disabled={rows.length === 0}
      title="The rows listed now, as a file"
      onClick={() => downloadCsv(rows, filename ?? csvFilename('transactions'))}
    >
      <Download size={15} aria-hidden="true" />
      CSV
    </button>
  )
}
