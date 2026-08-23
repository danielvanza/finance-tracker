# F1 R-A — create money.ts + money.test.ts (write FIRST, no exploration)

FIRST ACTION: create `frontend/src/money.ts` from the spec below. SECOND:
`frontend/src/tests/money.test.ts`. THEN run vitest on just that file. Do NOT read
other source files; do NOT use agents/subagents; do NOT touch anything else. No git
commands. If a check fails, fix money.ts/tests until green.

## Spec (complete — implement exactly)

```ts
// frontend/src/money.ts
// Integer-cents money helpers (F1 S3). Decisions:
// D1: formatCents never emits '+', only '-'; call sites compose signs.
// D2: parseToCents treats bare digit input as WHOLE EUROS ("1250" -> 125000 cents).
// D3: HALF_UP rounding via string arithmetic; Number() never sees fractional strings.
const GROUP = new Intl.NumberFormat('nl-NL', { maximumFractionDigits: 0 })

export function formatCents(cents: number): string {
  // throws TypeError on non-integer input (dev tripwire)
  // output: "-€34,99" | "€1.234,56" | "€0,00"  (sign before €, no space,
  // nl-NL dot grouping for euros part, comma decimals, always 2 decimals)
}

export function parseToCents(raw: string): number | null {
  // trim; grammar ^[+-]?\d+([.,]\d*)?$ with AT MOST ONE separator -> else null
  // "" | "   " | "abc" | "-" | "." | "12,3,4" | "1.234,56" | "12a" => null
  // bare digits = whole euros; single separator = decimal point (either , or .)
  // missing frac digits pad right ("12,5" -> 1250); HALF_UP at 3rd decimal using
  // STRING comparison of the tail digits ("0,005"->1, "0,004"->0, "0,995"->100,
  // "-0,005"->-1 i.e. away from zero); sign applied last; return integer cents
}

export function centsToInputString(cents: number): string {
  // canonical EDITABLE form: always 2 decimals, NO grouping: 1234->"12.34",
  // -3499->"-34.99", 0->"0.00", 123456->"1234.56". Integer input required.
}

export function sumCents(values: readonly number[]): number {
  // plain integer reduce, [] -> 0
}

export function splitRemainingCents(
  totalCents: number,
  parts: readonly { amount_cents: number }[],
): number {
  // totalCents - sumCents(parts.map(p => p.amount_cents))
}
```

Implement formatCents with integer math only: `euros = (abs - abs % 100) / 100`,
`rem = String(abs % 100).padStart(2,'0')`, prefix `'-'` when negative, `'\u20AC'` symbol.
Implement parseToCents purely with string slicing/concat — build the cent integer as
`intPart * 100 + frac2 + roundUp` where `roundUp` compares the first discarded digit
char to '5' (any later nonzero digit cannot flip a decision because HALF_UP depends
only on the first discarded digit >= 5).

## Tests — `frontend/src/tests/money.test.ts`

Use `import { describe, it, expect } from 'vitest'` and import from '../money'.
Exactly these cases:

formatCents: (0)->'€0,00'; (123456)->'€1.234,56'; (-3499)->'-€34,99'; (5)->'€0,05';
(99)->'€0,99'; (-5)->'-€0,05'; (3499)->'€34,99' (no '+'); (586026)->'€5.860,26';
expect(() => formatCents(12.5)).toThrow(TypeError).

parseToCents: ('12,50')->1250; ('12.50')->1250; ('1250')->125000; ('-34,99')->-3499;
('+12,00')->1200; ('0,005')->1; ('0,004')->0; ('0,995')->100; ('-0,005')->-1;
('12,5')->1250; null for: '', '   ', 'abc', '-', '.', '12,3,4', '1.234,56', '12a'.

centsToInputString: 1234->'12.34'; 0->'0.00'; -3499->'-34.99'; 123456->'1234.56'.

Round-trip: for ['12.34','-34.99','0.00','1234.56']:
parseToCents(centsToInputString(parseToCents(s)!)) === parseToCents(s).

splitRemainingCents: (1000,[{amount_cents:400},{amount_cents:600}])->0;
(-3499,[{amount_cents:-3000}])->-499. sumCents: ([])->0; ([-5,5])->0.

## Verify

`cd frontend && npx vitest run src/tests/money.test.ts 2>&1 | tail -6`
Must be fully green. Also `npx tsc -b` clean. Report the real tail output.
