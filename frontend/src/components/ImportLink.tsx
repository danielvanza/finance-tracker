import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Upload } from 'lucide-react'
import { api } from '../api'
import { dayLabel } from '../dates'

/** The way to Import, always there, with how far the bank data runs. */
export default function ImportLink() {
  const { data: pace } = useQuery({ queryKey: ['pace', 'current'], queryFn: () => api.getPace() })
  const newest = pace?.newest_bank_date ?? null
  return (
    <Link to="/import" className="btn import-link">
      <Upload size={15} aria-hidden="true" />
      <span>Import</span>
      {pace && <small className="num">{newest ? `bank data to ${dayLabel(newest)}` : 'no bank data yet'}</small>}
    </Link>
  )
}
