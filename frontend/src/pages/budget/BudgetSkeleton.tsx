// ── Loading skeleton ──────────────────────────────────────────────────────────
export function LoadingSkeleton() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {[0, 1, 2].map(i => (
        <div key={i} style={{
          height: 28, borderRadius: 'var(--radius)',
          background: 'var(--bg-input)',
          animation: 'pulse 1.5s ease-in-out infinite',
          opacity: 0.6 - i * 0.15,
        }} />
      ))}
    </div>
  )
}
