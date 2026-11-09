import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import '../../styles/reports.css'

/**
 * The "Month report" link-row for Month. Props: `month` is the financial month being shown ("2026-10"); `children`
 * are the link-rows already in that spot (the "to review" row), which stay above it, so both sit in one column.
 * Render it in place of the review row inside `.side-stack`: `<ReportLink month={month}>{reviewRow}</ReportLink>`.
 */
export default function ReportLink({ month, children }: { month: string; children?: ReactNode }) {
  return (
    <div className="rep-links">
      {children}
      <Link to={`/report?month=${month}`} className="link-row rep-entry">
        <span>Month report</span>
        <ChevronRight size={16} aria-hidden="true" />
      </Link>
    </div>
  )
}
