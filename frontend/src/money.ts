// Integer-cents money helpers (F1 S3). Decisions:
// D1: formatCents never emits '+', only '-'; call sites compose signs.
// D2: parseToCents treats bare digit input as WHOLE EUROS ("1250" -> 125000 cents).
// D3: HALF_UP rounding via string arithmetic; Number() never sees fractional strings.
const GROUP = new Intl.NumberFormat('nl-NL', { maximumFractionDigits: 0 })

export function formatCents(cents: number): string {
  if (!Number.isInteger(cents)) {
    throw new TypeError(`formatCents: expected integer cents, got ${cents}`)
  }
  const abs = Math.abs(cents)
  const euros = (abs - (abs % 100)) / 100
  const rem = String(abs % 100).padStart(2, '0')
  return `${cents < 0 ? '-' : ''}\u20AC${GROUP.format(euros)},${rem}`
}

export function parseToCents(raw: string): number | null {
  const s = raw.trim()
  if (!/^[+-]?\d+([.,]\d*)?$/.test(s)) return null

  let sign = 1
  let body = s
  if (s[0] === '+' || s[0] === '-') {
    if (s[0] === '-') sign = -1
    body = s.slice(1)
  }

  const sepIdx = body.search(/[.,]/)
  const intPart = sepIdx === -1 ? body : body.slice(0, sepIdx)
  const fracPart = sepIdx === -1 ? '' : body.slice(sepIdx + 1)

  // Pad frac right to 2 digits; HALF_UP on the first discarded (3rd) digit,
  // decided purely by char comparison against '5'.
  const f0 = fracPart.length > 0 ? fracPart[0] : '0'
  const f1 = fracPart.length > 1 ? fracPart[1] : '0'
  const f2 = fracPart.length > 2 ? fracPart[2] : undefined
  const frac2 = Number(f0) * 10 + Number(f1)
  const roundUp = f2 !== undefined && f2 >= '5' ? 1 : 0

  return sign * (Number(intPart) * 100 + frac2 + roundUp)
}

export function centsToInputString(cents: number): string {
  if (!Number.isInteger(cents)) {
    throw new TypeError(`centsToInputString: expected integer cents, got ${cents}`)
  }
  const abs = Math.abs(cents)
  const euros = (abs - (abs % 100)) / 100
  const rem = String(abs % 100).padStart(2, '0')
  return `${cents < 0 ? '-' : ''}${euros}.${rem}`
}

export function sumCents(values: readonly number[]): number {
  return values.reduce((acc, v) => acc + v, 0)
}

export function splitRemainingCents(
  totalCents: number,
  parts: readonly { amount_cents: number }[],
): number {
  return totalCents - sumCents(parts.map((p) => p.amount_cents))
}
