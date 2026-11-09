// Cleans a bank description to the shop it came from.
//
// The key is lowercase and is a PREFIX of the lowercase description (a SUBSTRING when the bank
// puts a "*" first), so it is also a valid rule pattern: rules match by substring (rules.py).
// "Albert Heijn 1403 Amsterdam NLD" and "Albert Heijn Amsterdam" both give "albert heijn".

export interface Merchant {
  /** Lowercase; what a rule would match. */
  key: string
  /** For people: the bank's own casing, or a short alias ("AMZN Mktp" is Amazon). */
  name: string
}

/** A shorter key would catch other shops, so no rule is offered for it. */
export const MIN_RULE_KEY = 4
export const ruleKeyOk = (key: string) => key.length >= MIN_RULE_KEY

const COUNTRIES = new Set(['nld', 'nl', 'deu', 'bel'])
const CITIES = new Set([
  'amsterdam', 'utrecht', 'rotterdam', 'den haag', 'the hague', 'eindhoven', 'zoetermeer',
  'haarlem', 'delft', 'leiden', 'groningen', 'almere',
])
const ALIASES: Array<[RegExp, string]> = [[/^amzn mktp/, 'Amazon']]

/** Words of `text` with where each one ends, so the cut stays a real prefix of the original. */
function cutTrailing(text: string): string {
  const words = [...text.matchAll(/\S+/g)].map(m => ({ w: m[0], end: (m.index ?? 0) + m[0].length }))
  let kept = 0
  for (const [i, { w }] of words.entries()) {
    if (i > 0 && /\d{3,}/.test(w)) break // a store or order number
    kept = i + 1
  }
  const lower = (i: number) => words[i].w.toLowerCase()
  while (kept > 1 && COUNTRIES.has(lower(kept - 1))) kept--
  while (kept > 1) {
    if (CITIES.has(lower(kept - 1))) kept--
    else if (kept > 2 && CITIES.has(`${lower(kept - 2)} ${lower(kept - 1)}`)) kept -= 2
    else break
  }
  return kept === 0 ? '' : text.slice(0, words[kept - 1].end)
}

const titleCase = (s: string) => s.replace(/(^|\s)\S/g, c => c.toUpperCase())

export function merchantFor(description: string): Merchant {
  const raw = description.trim()
  const star = raw.indexOf('*')
  let head = raw
  if (/^bck\*/i.test(raw)) head = raw.slice(4)
  else if (star >= 0) head = raw.slice(star === 0 ? 1 : 0, star === 0 ? undefined : star)
  head = head.trim()

  let shown = cutTrailing(head).replace(/\.nl$/i, '').replace(/[\s,;:-]+$/, '')
  if (!shown) shown = raw
  const key = shown.toLowerCase()
  let name = shown === key ? titleCase(shown) : shown
  for (const [pattern, alias] of ALIASES) if (pattern.test(key)) name = alias
  return { key, name }
}
