# Tasks

Budgeting-correctness work items. Both come from the same underlying problem: the
current model assumes every transaction is exactly one category and that the sign
of a transaction determines which category types are legal. Real household
budgeting breaks both assumptions — shared costs need splitting, and money coming
back needs to reduce the category it originally left.

---

## Task 2 — Split transactions

### Problem

`Transaction` carries a single `category_id` (`backend/models.py:40`), so one bank
line can only ever land in one category. That is wrong for the two most common
household cases:

- **Shared purchases.** You pay €250 at the supermarket, €125 of which is your
  partner's share. Today the whole €250 hits `Food - Essential`, overstating your
  own consumption by €125.
- **Mixed baskets.** One payment covers both a Need and a Want (groceries + wine,
  hardware + decoration). Currently you pick one and the 50/30/20 split is off.

It also blocks the clearing-account pattern that Task 3 and the "who owes whom"
workflow depend on: you cannot put €125 into a real category and €125 into an
`Owed by <partner>` clearing category from the same transaction.

### Desired behaviour

A transaction can be either:

- **Simple** — one category, as today. This must stay the default and must not get
  slower or more clicks.
- **Split** — two or more parts, each with its own category and amount. The parts
  must sum exactly to the parent amount. All parts share the parent's date,
  description, and source.

Every aggregation (dashboard totals, category breakdown, budget actuals,
needs/wants/savings, trend) must read the split parts, not the parent, so a split
transaction never double-counts and never disappears.

### Design questions to settle first

- **Model shape.** Child rows (`TransactionSplit` table with
  `transaction_id`, `category_id`, `amount`) versus self-referencing child
  transactions with a `parent_id`. Child rows are simpler to keep summing to the
  parent; child transactions reuse existing query paths. Pick one deliberately —
  every aggregate query in `routers/` has to follow.
- **Where `category_id` lives** once a transaction is split. Options: null it out
  on the parent and treat splits as the only truth, or keep it as a denormalised
  "primary" category. Nulling is cleaner but every existing query that filters on
  `Transaction.category_id` needs updating (`routers/budget.py:66-78`,
  `routers/dashboard.py:30-108`, `routers/transactions.py:48-49`).
- **Sign handling.** Must every part share the parent's sign, or can a split
  contain both a positive and a negative part? Allowing mixed signs makes Task 3
  easier but complicates validation.
- **Rules and AI.** Should a rule be able to produce a split (e.g. always split
  this recurring payment 50/50)? Probably out of scope for v1 — but the AI
  categoriser (`backend/categorizer/ai.py`) needs to keep returning a single
  category and not silently break on already-split transactions.
- **Rounding.** Odd amounts split evenly (€125.01 in two) need a defined rule for
  where the remaining cent goes.

### Touch points

- `backend/models.py` — new table or `parent_id`, relationship, cascade on delete.
- `backend/schemas.py` — split payload on the transaction patch endpoint.
- `backend/routers/transactions.py` — create/edit/delete splits; validate the sum.
- `backend/routers/dashboard.py`, `backend/routers/budget.py` — aggregate over
  parts instead of parent rows.
- `frontend/src/components/ReviewCard.tsx` — a way to split during review.
- `frontend/src/pages/Transactions.tsx` — display and edit existing splits.
- `frontend/src/types.ts`, `frontend/src/api.ts`.
- Note: there is **no migration tool** — tables are auto-created via
  `Base.metadata.create_all()`. Adding a table is fine; changing existing columns
  on a live `data/finance.db` is not automatic and needs a manual plan.

### Done when

- A transaction can be split into N parts that must sum to the parent amount;
  a non-summing split is rejected with a clear error.
- Dashboard totals, category breakdown, budget actuals, and the 50/30/20 split all
  reflect the parts.
- Splitting and un-splitting are both possible from the UI.
- Simple (unsplit) transactions behave exactly as before.

---

## Task 3 — Refund as contra-expense

### Problem

Money coming back into an account is currently forced to be *income*.
`_is_sign_compatible` (`backend/categorizer/rules.py:5-13`) and
`_get_categories_for_sign` (`backend/categorizer/ai.py:18-25`) both hard-block a
positive amount from attaching to a `needs`/`wants`/`savings` category, and the
frontend applies the same filter in the review card. The only escape hatch is the
`Refunds` income category seeded in `backend/seed.py:25`.

That is the wrong shape for a genuine reimbursement. If you spend €300 on
groceries and get €150 back, the truth is that groceries cost you €150. The
current model reports **€300 spent + €150 income**, which:

- overstates the `Food - Essential` category and makes it look over budget when it
  is not,
- overstates `total_income`, so `left_over` and the savings rate are both wrong,
- distorts the 50/30/20 pie, since the €300 counts fully as a Need.

It gets worse across month boundaries: pay in one financial month, get reimbursed
in the next, and both months are wrong in opposite directions.

### Desired behaviour

An incoming amount can be marked as a **refund of a category** rather than income.
When it is, it **subtracts from that category's actual spend** instead of adding to
income.

Concretely: €300 to `Food - Essential`, then €150 refund against
`Food - Essential`, should report `actual = €150` for that category, and should not
appear anywhere in income.

The distinction that must stay visible in the UI:

- **Refund / reimbursement** → contra-expense, reduces a category. (Returned item,
  expense claim paid back, partner paying their share of something you already
  categorised, cashback on a specific purchase.)
- **Real income** → `income` type as today. (Salary, interest, gifts, anything that
  genuinely increases household money.)
- **Internal transfer** → `exclude` type as today. (Money between your own
  accounts.)

Getting a user to pick correctly between these three is the actual design problem;
the arithmetic is easy.

### Design questions to settle first

- **How to represent it.** A `is_refund` boolean on the transaction plus the normal
  `category_id`, versus signing the amount within the existing category, versus
  making it a special case of a split. The boolean is the smallest change and keeps
  the category link explicit.
- **Sign filter policy.** The sign filter should become a *default suggestion*
  rather than a hard block: expense categories stay hidden for a positive amount
  until the user marks it as a refund, then they become selectable. Keep the
  guardrail, drop the wall.
- **Should actuals be allowed to go negative?** If a category is refunded more than
  it was spent in a given financial month (refund lands in the month *after* the
  spend), its actual goes below zero. Decide whether to clamp at zero, show the
  negative honestly, or match refunds back to the original month.
- **Cross-month matching.** Optionally link a refund to the specific original
  transaction. Powerful (it makes the previous question disappear) but a much
  bigger feature — likely v2.
- **What happens to `Refunds`?** The seeded income category becomes redundant for
  true reimbursements. Decide whether to keep it for unattributable refunds,
  repurpose it, or retire it — and what happens to existing transactions already
  filed under it.
- **AI prompt.** `backend/categorizer/ai.py` currently only ever offers income and
  exclude categories for positive amounts. It would need to be able to propose
  "this looks like a refund of category X", which is a meaningfully harder
  judgement than plain categorisation.

### Touch points

- `backend/models.py` — refund flag (or chosen representation).
- `backend/categorizer/rules.py:5-13` — relax `_is_sign_compatible`.
- `backend/categorizer/ai.py:18-25` — allow refund suggestions for positives.
- `backend/routers/dashboard.py:41-80` — exclude refunds from income; net them
  against the category breakdown.
- `backend/routers/budget.py:66-80` — actuals must net refunds
  (currently filters `Transaction.amount < 0`, so positives are simply invisible).
- `backend/routers/transactions.py:104-118` — the retroactive rule application is
  sign-aware and needs to understand refunds.
- `frontend/src/components/ReviewCard.tsx`, `frontend/src/components/CategorySelect.tsx`
  — the three-way choice (refund / income / transfer).
- Existing tests assert the current strict sign behaviour
  (`frontend/src/tests/ReviewCard.test.tsx`, backend categoriser tests) and will
  need updating.

### Done when

- A positive transaction can be filed against an expense category as a refund.
- That refund reduces the category's actual spend and does not appear in
  `total_income`, `left_over`, or the needs/wants/savings split.
- Salary and internal transfers are unaffected.
- The UI makes the refund / income / transfer choice obvious rather than implicit.

---

## Task 4 — Manual transactions and standing adjustments

### Problem

Both partners take a fixed **€600/month personal budget** that never reaches the
shared account. Salary lands in the personal account (say €3600), €3000 is
transferred to the shared account, and €600 stays behind.

The app only ever imports the shared account, so it sees €3000 of income. In
reality €3600 of household income was earned and €600 of it was allocated to
personal spending. Consequences:

- `total_income` understates real household income by €1200/month (€600 × 2).
- The €1200/month allocated to personal spending is invisible — it can never be
  budgeted, shown as a Want, or compared year over year.
- The 50/30/20 split is computed against the wrong denominator.

This is the income-side twin of the `Internal Transfer` problem: the same scope
boundary, seen from the other direction.

### Desired behaviour

Allow **manually created transactions** that did not come from a CSV, so the
household picture can be grossed up to reality.

The critical constraint: **an adjustment must always be a net-zero pair** in the
same financial month.

- `+€600` — income, e.g. `Salary (retained personal)`
- `−€600` — expense, e.g. `Personal Allowance` (Wants)

Net effect on `left_over` is exactly zero: €3600 − €600 = €3000, which is what
physically arrived in the shared account. Income and the Wants bucket become
truthful while the shared account still reconciles against the bank.

Per month that is four rows (two per person), or two if the pair is netted per
person.

**Explicitly rejected approach:** editing the imported €3000 up to €3600. That
destroys per-row reconciliation against the bank statement, and `import_hash`
deduplication will re-add the original €3000 on the next import. Imported rows
stay immutable; adjustments are always separate, visibly-adjustment rows.

### Then: standing adjustments

€600 × 2 is fixed every month, so hand-entering four rows monthly is a chore that
will be abandoned within a few months. The durable shape is a **standing
adjustment**: a stored template that auto-materialises into each financial month.

There is precedent in the codebase — `Budget` already uses `month = NULL` to mean
"default template", auto-populated per month by `_auto_populate`
(`backend/routers/budget.py:19-41`). The same pattern fits here.

Build the one-off manual transaction first; recurrence is a thin layer on top.

### Blockers in the current code

The app has **no concept of a manual transaction at all**:

- `Transaction.import_hash` is `nullable=False, unique=True`
  (`backend/models.py:44`) — every row must originate from a file.
- There is no create endpoint. `backend/routers/transactions.py` has GET,
  GET `/review`, PATCH, and POST `/{id}/create-rule` — nothing that creates a
  transaction.
- `TransactionSource` is `ing | revolut | degiro` (`backend/models.py:13-16`) —
  there is no `manual` member.

### Design questions to settle first

- **`import_hash` for manual rows.** Make it nullable, or generate a synthetic
  hash. Nullable is honest but the column is `unique=True`, so multiple NULLs need
  checking against the SQLite behaviour actually in use.
- **Review queue.** Manual rows should almost certainly be auto-confirmed and skip
  the review queue entirely — the user just typed the category.
- **Pair enforcement.** Should the API enforce that adjustments come in balanced
  pairs, or is that a UI convention? Enforcing it in the model prevents the single
  worst failure mode (adding only the income leg and silently inflating
  `left_over` by €1200/month).
- **Visual distinction.** Manual/adjustment rows must be obviously distinct from
  imported rows in the transactions list, and ideally filterable, so the household
  can always answer "what did the bank actually say".
- **Double counting on scope change.** The day the personal accounts start being
  imported, these adjustments must be switched off or income doubles. Prefer an
  explicit scope setting over relying on memory.
- **Symmetry between partners.** Open question: does the partner's salary also land
  in a personal account with a transfer to shared, or does it go straight into the
  shared account? If the latter, the two people need different treatments — one
  grossed up, one already correct.
- **Per-person attribution (out of scope, note only).** Once "my €600" and
  "partner's €600" are recorded, the next question is "who contributed what to the
  shared pot this month", which needs a person dimension on transactions. Real, but
  a separate feature — do not let it creep into this one.

### Touch points

- `backend/models.py` — `manual` member on `TransactionSource`; `import_hash`
  nullability.
- `backend/schemas.py` — create payload.
- `backend/routers/transactions.py` — `POST /transactions`, auto-confirm manual
  rows.
- New: standing-adjustment template model + per-month materialisation, mirroring
  `_auto_populate` in `backend/routers/budget.py:19-41`.
- `backend/seed.py` — new categories: `Personal Allowance` (wants) and an income
  category for retained salary.
- `frontend/src/pages/Transactions.tsx` — manual entry form; visually distinguish
  adjustment rows.
- `frontend/src/api.ts`, `frontend/src/types.ts`.

### Done when

- A transaction can be created by hand, without a CSV, and is marked as manual.
- A €600 income / €600 Personal Allowance pair can be recorded per person per
  month, leaving `left_over` unchanged while correcting `total_income` and the
  Wants bucket.
- Manual rows are visually distinguishable from imported rows.
- The monthly pairs materialise automatically rather than being retyped.

---

## Relationship between the tasks

Task 2 is a prerequisite for the full version of the shared-cost workflow: without
splits you can only mark a transaction as *entirely* someone else's. Task 3 is
independently useful and does not depend on Task 2, but the two combine — a split
where one part is a refund is how "I paid €250, you owe me €125, you paid me back
next month" gets recorded truthfully in both months.

Task 4 is independent of both. It shares a theme with Task 3 — both are about the
app's totals telling the truth about money that moves in ways the imported CSV does
not show — but touches different code.

All three are consequences of the same root decision: **where the household draws
its scope boundary.** Task 4 in particular only makes sense under a "shared pot,
grossed up" model. If the personal accounts were imported directly instead, Task 4
becomes unnecessary and actively harmful (double counting).

Suggested order:

1. **Task 3** — refund as contra-expense. Smallest, self-contained, immediate
   accuracy win.
2. **Task 4** — manual transactions, then standing adjustments. Independent, and
   removes a recurring monthly distortion of €1200.
3. **Task 2** — splits. Largest, touches every aggregate query, and unlocks the
   full shared-cost workflow.
