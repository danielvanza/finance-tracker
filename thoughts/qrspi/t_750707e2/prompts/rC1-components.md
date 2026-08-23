# F1 R-C1 — components to integer cents + is_refund surfacing (write-first)

State: `frontend/src/money.ts` (formatCents/parseToCents/centsToInputString/sumCents/
splitRemainingCents) and the cents-typed `types.ts`/`api.ts` have landed. Your job:
convert ALL components to integer cents and fix their test fixtures. tsc currently
reports these counts you must drive to zero: SplitModal 14, CategoryManager 9,
AddTransactionModal 9, StandingAdjustments 7, ReviewCard 7, tests/ReviewCard.test.tsx 18,
tests/SummaryCards.test.tsx (fixture updates).

Allowed files (nothing else): frontend/src/components/{ReviewCard,SplitModal,SplitEditor,
AddTransactionModal,StandingAdjustments,SummaryCards,CategoryManager}.tsx,
frontend/src/tests/{ReviewCard.test.tsx,SummaryCards.test.tsx}.
Read those files as needed, then edit. No git commands, no agents, touch no other file.

## Global conventions

- Render money: `formatCents(...)` never emits '+'; call sites compose explicit signs:
  `{isExpense ? '-' : '+'}{formatCents(Math.abs(x.amount_cents))}`.
- Parse user input: `const cents = parseToCents(text)` → number|null; validate before use;
  NEVER parseFloat/Number on amount text anywhere.
- Input seeded values: `centsToInputString(...)` (magnitude: wrap with Math.abs).
- Integer comparisons only — no Math.round(*100)/100 epsilon tricks.
- DO NOT TOUCH ai_confidence percent code (Math.round(x*100) stays).

## Per-file work

### SplitEditor.tsx (rewrite core, keep markup/styles)
- Keep `SplitRow {category_id: number|null; amount: string}`.
- `splitRowsTotalCents(rows)` = sumCents(rows.map(r => parseToCents(r.amount) ?? 0)).
- `splitRowsValid(rows, totalAmountCents)`: >=2 rows; every category_id set; every amount
  parses to > 0 cents; `sumCents(magnitudes) === Math.abs(totalAmountCents)` (exact int).
  Export BOTH under these names (callers import them).
- Component props: `totalAmount: number` stays (now cents); ADD optional
  `seededRefunds?: boolean[]` (parallel to rows; display-only).
- `remaining = Math.abs(totalAmount) - splitRowsTotalCents(rows)` (int).
- Chip: `{balanced ? 'Balanced ✓' : \`Remaining: ${formatCents(remaining)}\`}`.
- assignRemaining: `next = (parseToCents(rows[idx].amount) ?? 0) + remaining`;
  `update(idx, { amount: centsToInputString(next) })`.
- Row rendering: when `seededRefunds?.[idx]`, render a small pill next to the input:
  `<span title="This part nets against its category (refund)" style={{fontSize:9.5,
  fontWeight:700,color:'var(--cyan)',background:'var(--cyan-bg)',border:'1px solid var(--cyan-border)',padding:'1px 6px',borderRadius:'var(--radius-xs)',textTransform:'uppercase',letterSpacing:'0.06em'}}>refund</span>`.

### ReviewCard.tsx
- Sign checks on `tx.amount_cents`; header amount:
  `{isExpense ? '-' : '+'}{formatCents(Math.abs(tx.amount_cents))}`.
- Seeded split rows: `centsToInputString(Math.abs(s.amount_cents))`;
  pass `seededRefunds={tx.splits.map(s => s.is_refund)}` to SplitEditor (only meaningful
  when seeded; empty rows default false).
- splitsPayload: `{ category_id: r.category_id!, amount_cents: parseToCents(r.amount)! * sign }`
  (validity already gated by splitRowsValid).
- canConfirm: splitMode ? splitRowsValid(splitRows, tx.amount_cents) : selectedCategory != null.

### SplitModal.tsx
- Same conversions: isPositive on amount_cents; seeded rows via centsToInputString +
  pass seededRefunds; payload `amount_cents: parseToCents(r.amount)! * sign`;
  header `{tx.amount_cents < 0 ? '-' : '+'}{formatCents(Math.abs(tx.amount_cents))}`;
  valid = splitRowsValid(rows, tx.amount_cents).

### AddTransactionModal.tsx
- Replace `parsedAmount` float with `const parsedCents = parseToCents(amount || '0')`
  (number|null). Validation: `if (!parsedCents || parsedCents <= 0)`.
- createTransaction body: `amount_cents: parsedCents * sign`.
- Pair legs: `amount_cents: parsedCents` / `-parsedCents`.
- Leg labels: `(+€${parsedCents && parsedCents > 0 ? formatCents(parsedCents) : '…'})`
  and the − variant.

### StandingAdjustments.tsx
- saveAmount: `const value = parseToCents(raw)`; skip when `value == null || value <= 0 ||
  value === sa.amount_cents`; send `{ amount_cents: value }`.
- add(): `const value = parseToCents(amount || '0')`; validation `!value || value <= 0`;
  createStandingAdjustment({ ..., amount_cents: value }).
- Input value: `editedAmounts[sa.id] ?? centsToInputString(sa.amount_cents)`.
- Comparison previously `value === sa.amount` → cents equality as above (exact int).

### SummaryCards.tsx
- Props rename to `total_income_cents,total_expenses_cents,total_savings_cents,left_over_cents`
  and `income_breakdown?: Array<{category_id:number;category_name:string;amount:number}>`
  (amount = cents, legacy key).
- Delete local fmt; `value={formatCents(total_income_cents)}` etc.
- Subtext: `${b.category_name}: ${formatCents(b.amount)}` joined by ' | '.
- left_over gradient check on left_over_cents.

### CategoryManager.tsx
- Fix its 9 tsc errors MINIMALLY (likely CategoryType union fallout). Preserve behaviour;
  no restyle. Report what each error was.

### tests/ReviewCard.test.tsx (fixtures only — same assertions spirit)
- Amounts to cents: -34.99→-3499; -45→-4500; 3400→340000; -250→-25000.
- Split payload assertion: `{category_id:1,amount:-125}` → `{category_id:1,amount_cents:-12500}`
  (and id 3 / -12500).
- 'Remaining: €150.00' → 'Remaining: €150,00' (formatter output).
- /34.99/ regex still matches '-€34,99' — keep.

### tests/SummaryCards.test.tsx
- Fixture: 586026 / 342000 / 40000 / 204026; expectation stays '€5.860,26'.

## Verify (run, report real output)

1. `cd frontend && npx tsc -b 2>&1 | tail -25` — expect ONLY remaining errors in
   src/pages/*.tsx (Budget/Transactions/Dashboard/Analytics) which R-C2 owns; ZERO in
   components/, zero in your two test files.
2. `cd frontend && npx vitest run 2>&1 | tail -8` — everything EXCEPT possibly page-level
   failures green; ReviewCard + SummaryCards suites MUST be fully green.
Report: files changed, final tsc error summary (file:count), vitest pass/fail counts.
