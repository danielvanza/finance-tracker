# F1 R-C2 — pages to integer cents (final sweep)

State: money.ts/types.ts/api.ts + ALL components are on integer cents (committed);
vitest 49/49 green; remaining tsc errors are exactly: Transactions.tsx 6,
Dashboard.tsx 6 (incl. SummaryCards prop rename fallout), Budget.tsx 6,
Analytics.tsx 2. Your job: drive them to zero WITHOUT breaking tests or visuals.

Allowed files ONLY: frontend/src/pages/{Transactions,Budget,Dashboard,Analytics}.tsx.
(Import.tsx needs one tiny change too — see below.) No git commands, no agents.

Helpers in `frontend/src/money.ts`: formatCents / parseToCents / centsToInputString /
sumCents. Conventions: formatCents never emits '+' — compose signs at call sites
(`{x < 0 ? '-' : '+'}{formatCents(Math.abs(x.amount_cents))}`); parse input via
parseToCents; seed inputs via centsToInputString; integer math only; DO NOT TOUCH
ai_confidence percent code or ratio/percent logic (they are unit-free) EXCEPT where the
grep gate requires swapping formatting primitives (see GATE note).

## Per-page work

### Transactions.tsx (6 errors)
- Sign checks `tx.amount_cents`; row amount cell:
  `{tx.amount_cents < 0 ? '-' : '+'}{formatCents(Math.abs(tx.amount_cents))}`.
- Delete-confirm string uses same composition.
- Split chips: `{s.category_name ?? '—'} {formatCents(Math.abs(s.amount_cents))}` inside
  the existing mono span.
- ADD per-part refund surfacing (task requirement): in the split chip span, when
  `s.is_refund` render a tiny pill BEFORE the category name:
  `<span title="Refund part — nets against its category" style={{marginRight:4,
  fontSize:9,fontWeight:700,color:'var(--cyan)',background:'var(--cyan-bg)',
  border:'1px solid var(--cyan-border)',padding:'0 5px',borderRadius:'var(--radius-xs)',
  textTransform:'uppercase',letterSpacing:'0.06em'}}>R</span>` (keep chip layout intact).

### Budget.tsx (6 errors)
- TransactionDrillRow amount: sign + formatCents(Math.abs(tx.amount_cents)).
- Totals: `totalPlanned = sumCents(rows.map(r => r.planned_amount_cents))`,
  `totalActual = sumCents(rows.map(r => r.actual_amount_cents ?? 0))`.
- handleSave: `const val = parseToCents(editing[id])`; skip null;
  `api.patchBudget(id, val)` (patchBudget now takes cents).
- Edit input value: `editing[row.id] ?? centsToInputString(row.planned_amount_cents)`;
  click-to-edit seeds `centsToInputString(row.planned_amount_cents)`.
- Renders: planned cell `formatCents(row.planned_amount_cents)`; actual cell
  `{(row.actual_amount_cents ?? 0) < 0 ? '-' : ''}{formatCents(Math.abs(row.actual_amount_cents ?? 0))}`.
- Summary cards + footer totals + 'of €X income' line: formatCents over the cents totals
  (`of ${formatCents(totalIncome)} income`). Percent/ratio math untouched.
- pct(actual,planned) helper: keep ratios but base them on the cents fields.

### Dashboard.tsx (6 errors)
- SummaryCards call site: rename props to total_income_cents/total_expenses_cents/
  total_savings_cents/left_over_cents passing data.total_income_cents etc.
- Ratio denominators (100-103): keep formulas but read data.total_expenses_cents etc.
- Chart formatters: values arriving are cents ints BUT recharts may pass fractional
  ticks — GUARD: `tickFormatter={v => \`€${Math.round(Number(v) / 100)}\`}` for axes;
  tooltips: `formatter={(v) => [formatCents(Math.round(Number(v))), …]}`.
- Pie legend rows (line ~250): `formatCents(value)` replacing the toLocaleString euro
  rendering; needs/wants/savings values come from data.needs_wants_savings.* (cents).
- Trend tooltip: formatCents(Math.round(Number(v))).
- Pie percent labels (renderPieLabel) untouched.

### Analytics.tsx (2 errors)
- Legend value: `formatCents(item.value)` (drop toLocaleString); item.value derives from
  c.actual (cents) — keep threshold math as-is (ratios unit-free).
- Tooltip formatter: formatCents(Math.round(Number(v))).
- percent labels untouched.

### Import.tsx (tiny)
- Preview amount cell: `{r.amount_cents < 0 ? '-' : '+'}{formatCents(Math.abs(r.amount_cents))}`
  (row field renamed by contract). NOTHING else changes in Import.

## GATE note (grep gate: no `toFixed(` outside money.ts outside tests)
After your edits, `grep -rn "toFixed(" frontend/src --include=*.tsx --include=*.ts | grep -v tests/`
must return ZERO lines. The percent labels currently use `.toFixed(0)`/`.toFixed(1)`
(Dashboard renderPieLabel ~42 + 101-103, Analytics ~53/102/113) — swap those exact sites
to `String(Math.round(x))` / `(Math.round(x*10)/10).toFixed` NO — use plain String forms:
- `((percent ?? 0) * 100).toFixed(0)` → `String(Math.round((percent ?? 0) * 100))`
- `(c.actual / total * 100).toFixed(1)` → `String(Math.round(c.actual / total * 1000) / 10)`
Identical output; keeps the mechanical gate honest. Same for any other non-money
toFixed site you encounter in these four pages (Import KB line is in Import.tsx — swap
`(file.size / 1024).toFixed(1)` to `String(Math.round(file.size / 102.4) / 10)`).

## Verify (run both, report real output)
1. `cd frontend && npx tsc -b 2>&1 | tail -5` — MUST be fully clean (exit 0).
2. `cd frontend && npx vitest run 2>&1 | tail -8` — MUST stay fully green (49+/49+).
3. Run the toFixed grep above — must be empty outside tests/.
Report: files changed, all three check outputs.
