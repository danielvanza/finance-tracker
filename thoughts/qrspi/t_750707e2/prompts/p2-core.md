# F1 P2 — implement CORE slice (qrspi 7_implement, round 1 of 2)

Implement exactly the core money slice from the approved design
`thoughts/qrspi/t_750707e2/design.md` (read it fully first). This round touches ONLY:
`frontend/src/money.ts` (NEW), `frontend/src/tests/money.test.ts` (NEW),
`frontend/src/types.ts` (rewrite), `frontend/src/api.ts` (rewrite). Do NOT touch pages/,
components/, or existing test files — that is round 2.

## ORCHESTRATOR CORRECTIONS to the design (binding, override the design where they differ)

C1. `CategoryType = 'needs' | 'wants' | 'savings' | 'income' | 'exclude'` (design §2
    dropped income/exclude — wrong, backend enum has all five; components filter on
    'income'/'exclude'). `TransactionSource = 'ing' | 'revolut' | 'degiro' | 'manual'`
    (design dropped 'manual'). `CategorisedBy = 'rule' | 'ai' | 'manual'`.
C2. `SplitInput` stays `{ category_id: number; amount_cents: number }` — do NOT add
    is_refund to request payloads (api-contracts transaction-patch request has no
    per-part refund; per-part display comes from `TransactionSplit.is_refund`).
C3. Design §4 line numbers are shifted — irrelevant this round anyway.
C4. (applies round 2) chart formatters guard with Math.round before formatCents.
C5. (applies round 2) percent/KB sites swap off toFixed for the grep gate.
C6. Define `ImportPreviewRow` concretely:
    `{ date: string; amount_cents: number; description: string; source: string;
       import_hash: string; duplicate: boolean }` and an `ImportPreviewResponse`
    `{ rows: ImportPreviewRow[]; total: number; duplicates: number }`; type
    previewImport/confirmImport with them.
C7. Verify command is `npx tsc -b` (project references; `tsc --noEmit` checks nothing
    on the solution tsconfig).

## Work items

1. `frontend/src/money.ts` — implement design §1 exactly (formatCents, parseToCents,
   centsToInputString, sumCents, splitRemainingCents). Integer-only; formatCents throws
   TypeError on non-integer; parseToCents = string-arithmetic HALF_UP, grammar
   `^[+-]?\d+([.,]\d*)?$` at most one separator, bare digits = whole euros, null on
   garbage; centsToInputString always 2dp no grouping; nl-NL grouping for formatCents.
   Doc comments carry the D1/D2/D3 decisions.
2. `frontend/src/tests/money.test.ts` — all 19 cases from design §5.1 (exact-equality).
3. `frontend/src/types.ts` — full rewrite per design §2 + corrections C1/C2/C6. Keep
   interface names (`DashboardSummary` etc). Legacy nested keys kept with cents values +
   doc comment. BudgetRow.category_type optional. Rule/SettingsMap untouched.
4. `frontend/src/api.ts` — rewrite per design §3: ApiError class (status, detail,
   message; network failure → status 0), apiFetch wrapper (JSON bodies stringified +
   Content-Type; FormData passthrough; non-OK → ApiError with detail extraction),
   every existing member preserved: same names, same `${BASE}` template literals
   (getTransactions/getNextReview query idioms VERBATIM), same literal
   `method: '<VERB>'` lines, response types imported from './types'. Money-bearing
   request payloads renamed to *_cents ints: createTransaction body {date, amount_cents,
   description, category_id, is_refund?}; createAdjustmentPair legs {amount_cents,
   category_id, description?}; patchBudget(id, planned_amount_cents) sends
   {planned_amount_cents}; createStandingAdjustment/patchStandingAdjustment bodies use
   amount_cents (patch: amount_cents may be undefined). patchTransaction keeps its body
   shape but SplitInput[] now carries amount_cents. Export ApiError.

## Verify (run yourself, report real output)

- `cd frontend && npx vitest run 2>&1 | tail -8`
  EXPECT: money.test.ts fully green (19+ assertions); contract.test.ts green;
  Settings/CategoryManager/Import green; ReviewCard + SummaryCards test files RED
  (euro fixtures vs cents components come in round 2 — that is the expected
  intermediate state, report the exact failing count, do not fix them now).
- `cd frontend && npx tsc -b` → must be CLEAN (types.ts + api.ts are the type
  foundation; pages still compile because vitest/tsc tolerate their now-wrong runtime
  math — if tsc fails inside pages/ because of the types flip, fix MINIMALLY by
  adjusting only what tsc forces (field renames at use sites may be forced); report
  any such forced page edits explicitly).
- Do NOT run git commands. Do NOT commit. Report: files written, vitest counts
  (pass/fail per file), tsc result, any forced edits outside the four files.
