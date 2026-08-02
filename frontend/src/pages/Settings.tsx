import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../api'
import StandingAdjustments from '../components/StandingAdjustments'
import CategoryManager from '../components/CategoryManager'

export default function Settings() {
  const queryClient = useQueryClient()
  const { data: settings, isLoading } = useQuery({
    queryKey: ['settings'],
    queryFn: api.getSettings,
  })

  const [startDay, setStartDay] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (settings?.financial_month_start_day) {
      setStartDay(settings.financial_month_start_day)
    }
  }, [settings])

  const mutation = useMutation({
    mutationFn: (value: string) => api.patchSetting('financial_month_start_day', value),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      queryClient.invalidateQueries({ queryKey: ['budget'] })
      queryClient.invalidateQueries({ queryKey: ['transactions'] })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    },
  })

  const handleSave = () => {
    const num = parseInt(startDay, 10)
    if (isNaN(num) || num < 1 || num > 28) return
    mutation.mutate(startDay)
  }

  // Compute example period for current month
  const now = new Date()
  const dayNum = parseInt(startDay, 10)
  let exampleText = ''
  if (!isNaN(dayNum) && dayNum >= 1 && dayNum <= 28) {
    if (dayNum === 1) {
      exampleText = `${now.toLocaleString('en', { month: 'short' })} 1 – ${now.toLocaleString('en', { month: 'short' })} ${new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()}`
    } else {
      const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, dayNum)
      const endDay = dayNum - 1
      exampleText = `${prevMonth.toLocaleString('en', { month: 'short' })} ${dayNum} – ${now.toLocaleString('en', { month: 'short' })} ${endDay}`
    }
  }

  if (isLoading) return (
    <div style={{ color: 'var(--text-secondary)', padding: 40, textAlign: 'center' }}>
      Loading settings...
    </div>
  )

  return (
    <div className="animate-fade-in">
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ marginBottom: 4 }}>Settings</h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: 13 }}>Configure your financial preferences</p>
      </div>

      <div style={{
        background: 'var(--bg-card)',
        borderRadius: 'var(--radius-lg)',
        padding: '24px 28px',
        border: '1px solid var(--border)',
        boxShadow: '0 4px 32px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.035)',
        maxWidth: 520,
      }}>
        <h3 style={{
          fontSize: 14, fontWeight: 700, color: 'var(--text-h)',
          letterSpacing: '-0.02em', marginBottom: 4,
        }}>Financial Month Start Day</h3>
        <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 18 }}>
          The day of the month your salary arrives. This defines the start of each financial period.
        </p>

        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 14 }}>
          <input
            type="number"
            min={1}
            max={28}
            value={startDay}
            onChange={e => setStartDay(e.target.value)}
            style={{
              background: 'var(--bg-input)', color: 'var(--text-h)',
              border: '1px solid var(--border-strong)',
              borderRadius: 'var(--radius)',
              padding: '9px 14px',
              fontSize: 14, fontFamily: 'var(--sans)',
              width: 80, textAlign: 'center',
            }}
          />
          <button
            onClick={handleSave}
            disabled={mutation.isPending}
            style={{
              background: 'linear-gradient(135deg, #4f46e5, #6366f1)',
              color: '#fff', border: 'none',
              borderRadius: 'var(--radius)',
              padding: '9px 20px',
              cursor: 'pointer', fontWeight: 600, fontSize: 13,
              fontFamily: 'var(--sans)',
              opacity: mutation.isPending ? 0.6 : 1,
            }}
          >
            {mutation.isPending ? 'Saving...' : 'Save'}
          </button>
          {saved && (
            <span style={{ fontSize: 12, color: 'var(--green)', fontWeight: 500 }}>
              Saved
            </span>
          )}
        </div>

        {exampleText && (
          <div style={{
            fontSize: 12, color: 'var(--text-muted)',
            background: 'var(--bg-input)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-sm)',
            padding: '8px 12px',
          }}>
            Example period for {now.toLocaleString('en', { month: 'long', year: 'numeric' })}: <strong style={{ color: 'var(--text-secondary)' }}>{exampleText}</strong>
          </div>
        )}

        <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 12 }}>
          Value must be between 1 and 28. Changing this will retroactively redefine all financial periods.
        </p>
      </div>

      <StandingAdjustments />
      <CategoryManager />
    </div>
  )
}
