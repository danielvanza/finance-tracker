# F1 R-C1b — finish the component sweep (continuation; split trio already done)

State: ReviewCard.tsx, SplitEditor.tsx, SplitModal.tsx are DONE (integer cents, 0 tsc
errors, committed). Remaining work — same conventions as before:

Allowed files ONLY: frontend/src/components/{AddTransactionModal,StandingAdjustments,
SummaryCards,CategoryManager}.tsx + frontend/src/tests/{ReviewCard.test.tsx,
SummaryCards.test.tsx}. No git commands, no agents. Read each file, edit it, move on.
money helpers live in `frontend/src/money.ts` (formatCents/parseToCents/
centsToInputString/sumCents). Conventions: formatCents never emits '+'; compose signs at
call sites (`{x < 0 ? '-' : '+'}{formatCents(Math.abs(x.amount_cents))}`); parse user
input with parseToCents (number|null) — never parseFloat/Number on amount text;
seed inputs with centsToInputString; integer comparisons only; DO NOT TOUCH
ai_confidence percent code.

## AddTransactionModal.tsx
- `const parsedCents = parseToCents(amount || '0')` replaces the float parsedAmount.
- Validation `if (!parsedCents || parsedCents <= 0)`; createTransaction body gets
  `amount_cents: parsedCents * sign`; pair legs `amount_cents: parsedCents` /
  `-parsedCents`.
- Pair-leg labels: `(+€${parsedCents && parsedCents > 0 ? formatCents(parsedCents) : '…'})`
  and the − variant.

## StandingAdjustments.tsx
- saveAmount: `const value = parseToCents(raw)`; skip when `value == null || value <= 0 ||
  value === sa.amount_cents`; patch `{ amount_cents: value }`.
- add(): parse the same way; validation unchanged semantics; body `amount_cents: value`.
- Input display value: `editedAmounts[sa.id] ?? centsToInputString(sa.amount_cents)`.

## SummaryCards.tsx
- Props rename: total_income_cents / total_expenses_cents / total_savings_cents /
  left_over_cents; income_breakdown item amount stays named `amount` but is cents now.
- Delete local fmt(); use formatCents everywhere incl. subtext:
  `${b.category_name}: ${formatCents(b.amount)}` joined ' | '.
- left_over gradient/color checks use left_over_cents.

## CategoryManager.tsx — drive its 9 tsc errors to zero MINIMALLY
(Likely CategoryType union fallout from types.ts v2. Preserve behaviour exactly; no
restyle, no logic change. Report each error you fixed.)

## tests/ReviewCard.test.tsx — fixtures only
- Amounts → cents: -34.99→-3499; -45→-4500; 3400→340000; -250→-25000.
- Split payload assertion: {category_id:1,amount:-125} → {category_id:1,amount_cents:-12500}
  and {category_id:3,amount:-125} → {category_id:3,amount_cents:-12500}.
- 'Remaining: €150.00' → 'Remaining: €150,00'.
- /34.99/ regex keeps matching '-€34,99' — no change needed there.
Do not weaken or delete any assertion.

## tests/SummaryCards.test.tsx
- Fixture cents: 586026 / 342000 / 40000 / 204026; expected '€5.860,26' stays.

## Verify (run both, report real tails)
1. `cd frontend && npx tsc -b 2>&1 | grep -oE "src/[^(]+" | sort | uniq -c | sort -rn`
   — expect ONLY src/pages/* counts left (Transactions 6, Budget 6, Dashboard 5,
   Analytics 2); ZERO in components/ and tests/.
2. `cd frontend && npx vitest run 2>&1 | tail -8` — ReviewCard + SummaryCards suites
   fully green; page-level suites may still fail (R-C2 owns them) — report honestly.
