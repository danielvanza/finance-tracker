---
date: 2026-08-02
git_commit: f363e22022f7379d2073687687f42961d9552c17
branch: main
repository: household-finance
phase: 0-brainstorm
status: converged
---

# Brainstorm — UX/UI rework, rollover budgeting, and DEGIRO tracking

## Starting Point

> "I want to improve this application and make the UX/UI and everything a lot better but I
> don't know how. Research best practices in budgeting, UX/UI, and whatever other relevant
> field could benefit this application. Then let's together make a list of features to start
> implementing."

Open-ended. No specific pain named up front — the ask was to find out what was worth doing.

## Conversation Highlights

**The three real pains** (from the opening question, all named at once):

1. The import + review grind
2. It tells you what happened, not what to do
3. The dashboard and front end contain a lot that doesn't earn its place

Plus a secondary one raised unprompted: things are spread across pages that could be together.

**Data is already fresh.** Imports happen multiple times a month, not once. This was
load-bearing — it means forward-looking views ("what's left to spend") are viable rather than
misleading, and it means the friction is entirely in the *review* flow, not the import cadence.
It also removes any argument for a paid bank-sync integration.

**Why review is slow** — three causes named, and notably *not* click-count:

- Rules don't generalise, so the same merchants come back forever
- Many decisions are genuinely hard (which category, refund or income, split or not)
- The AI suggestions aren't trusted, so every one gets checked anyway

**The root cause is that the app has no learning loop.** The AI prompt sends a bare list of
category names and asks for a category plus a confidence number. It never sees a single one of
the user's past decisions — every import is a cold start. Rules are the only memory in the
system, and they're brittle by construction. Chosen fix: feed the user's own confirmed history
into the prompt, require a one-line reason, and give the review card more context. Explicitly
*not* chosen: fuzzy similarity matching, and the app auto-proposing rules — the user wants to
stay in control of the decision, with better assistance rather than more automation.

**50/30/20 stays.** The user likes the frame and likes that each category carries a
needs/wants/savings type. Presented evidence that their own default budgets are 57/37/7 rather
than 50/30/20 did not change this — the frame is a lens they value, not a target they're
failing to hit. So: keep the model, present it better, don't lead the dashboard with a pie.

**The whole dashboard gets rebuilt.** Every element was marked for rework, with the note "all
of these need to be fully reworked according to whatever best practices."

**Irregular expenses were the hardest part of the conversation** and needed real research. The
user's constraint: *"we often only know when the bill comes when that extra cost for e.g. a tax
comes, and only then we also know the price to pay."* Unknown amount, unknown timing — which
rules out classic sinking funds. A buffer pot was proposed and explicitly rejected.

Research resolved it. Every serious tool converges on one primitive: **category balances that
persist across months.** A sinking fund, an emergency buffer and an ordinary category are the
same object; they differ only in whether you spend the balance down each month or let it
accumulate. This dissolves the objection entirely — no pot, no forecast, nothing to predict.
Budget Insurance at €400/month, skip three months, and the category simply *has* €1,200 when
the bill lands.

- Actual Budget: unspent money "will simply roll over into the category's balance next month";
  overspending is by default taken out of next month's total, with carrying-the-negative as an
  opt-in — <https://actualbudget.org/docs/budgeting/>
- Monarch: sinking funds are not a feature, they are "the rollover option, which allows you to
  roll over any unspent funds into the next month if you enable it on the category" —
  <https://www.monarch.com/blog/flex-budgeting-simplify-your-spending-with-just-one-number>
- YNAB on unknown amounts: "it's absolutely okay to give it your best guess at first. Over time,
  you'll get better and better at this. And as you track your expenses, you'll have better and
  better data to guide you." — <https://www.ynab.com/blog/how-to-embrace-your-true-expenses>

**Scope was then deliberately held down.** After being shown the full landscape of what
comparable apps layer on top of rollover — YNAB's five target types, Actual's schedules and
auto-budget templates, Lunch Money's recurring detection, Firefly's rule engine and piggy
banks, Monarch's Fixed/Non-Monthly/Flexible axis, accounts and net worth — the decision was:
**"for now I think the rollover is fine by itself, we expand later."** This is a deliberate
scope decision, not an oversight, and the deferred items are catalogued below.

**DEGIRO came in late and changed the shape.** Raised mid-conversation: investment tracking
matters. Scoped to portfolio *value over time* — total value, contributions vs. growth — rather
than position-level accounting. The key finding that made this cheap: DEGIRO's Portfolio export
already contains value in EUR, so periodic dated snapshots give a value-over-time curve with no
external price feed, no API key and no new integration pattern.

**Visual direction, in the user's words:** *"I'm not sure, be creative. I want it to not look
AI sloppish with all the gradients/shadows that AI likes adding in everywhere. Make it a
beautiful original design."* Treated as a hard constraint on the design phase.

## Alternatives Considered

| Considered | Outcome | Why |
|---|---|---|
| Paid bank-sync aggregator | Rejected | Free EU open-banking (Nordigen/GoCardless) tier wound down and closed to new signups; the user already imports frequently, so cadence isn't the problem |
| Buffer / contingency pot for irregular bills | Rejected by user | Disliked as a concept; rollover balances solve the same problem without a separate envelope |
| Classic sinking funds (annual ÷ 12) | Rejected | Requires a known amount and date; the user has neither |
| "Maintain a balance / refill up to" targets | Deferred | Genuinely fits the unknown-amount case, but folded into "expand later" |
| App auto-proposing rules from patterns | Not chosen | User wants to stay in control of the decision |
| Fuzzy/similarity matching instead of substring rules | Not chosen | Less predictable, harder to debug when wrong |
| Mobile-first rebuild | Rejected | Desktop-first, must not break on phone |
| Full Tailwind migration before any features | Rejected | Long stretch with nothing visible; would port pages about to be redesigned |
| Backend-first sequencing | Rejected | The loudest complaints are front-end; they'd stay unfixed longest |
| Hand-rolled component system on existing CSS vars | Rejected | Would mean hand-building the accessible primitives that have already gone wrong |
| Keeping all seven nav pages | Rejected | Duplication and the review→rules round trip stay in place |
| Position-level DEGIRO accounting (cost basis, dividends, realised gains) | Deferred | Bigger build; value-over-time answers the actual question |
| Full accounts + net worth dimension | Deferred | Least connected to stated pains; a second project |

## Grounding Notes

Findings from a full read of the codebase at `f363e22`.

**The backend is in good shape and is not the problem.** The financial model is genuinely
well-built: financial months anchored to payday (`backend/financial_month.py`), refunds as
contra-expense, splits, standing adjustments, and a shared `effective_parts()` helper so no
aggregate double-counts (`backend/aggregate.py`). ~1,100 lines of source against ~1,000 lines
of tests.

**Front end — measured, not impressionistic:**

- 407 inline `style={{}}` objects across the app; a 120-variable token set in
  `frontend/src/index.css` that components largely ignore
- 19 ARIA attributes in the entire application
- Two hand-rolled dropdowns with manual `document.addEventListener('mousedown')` click-outside
  handling (`components/CategorySelect.tsx:100`, `pages/Budget.tsx:31`);
  `CategorySelect.tsx:185-186` reimplements popover positioning against scroll and resize
- Zero working responsive breakpoints — `frontend/src/App.css` has media queries but is never
  imported, making it dead Vite-template code. The live layout is a fixed `maxWidth: 1320` with
  hardcoded `gridTemplateColumns: '2fr 1fr'`
- `--text-muted` (#3a4f6a) on `--bg-card` measures **2.2:1** contrast, well under the WCAG AA
  minimum of 4.5:1 — and it's used for real content, including the percentages in chart legends
- The financial-month date-range label is reimplemented three times, slightly differently
  (Dashboard, Analytics, Settings)

**Specific defects behind the stated pains:**

- `backend/routers/transactions.py:222` — "Create rule" during review uses the transaction's
  *entire* description verbatim as the pattern, with no chance to shorten it. A rule made from
  "Albert Heijn 1234" will never match "Albert Heijn 5678". Getting a general pattern requires
  leaving the review flow for the Rules page. **This is the mechanical cause of "rules don't
  generalise."**
- `backend/categorizer/ai.py:81-87` — the prompt contains only a comma-separated list of
  category names. No category descriptions, no few-shot examples, no user history, no reasoning
  requested. The `ai_confidence` float it returns is therefore ungrounded.
- `frontend/src/pages/Analytics.tsx:76` — calls `api.getDashboard(month)`, the exact same
  endpoint as the Dashboard, and renders one pie from `category_breakdown`. An entire nav item
  that adds no new information.
- `backend/routers/budget.py:78-84` — actuals are recomputed from scratch inside each
  financial-month window. **There is no persistent category balance anywhere in the model**;
  every month starts at zero by construction. This is the structural gap rollover must fill.
- `backend/importers/degiro.py:14-22` — keeps only `Date`, `Product`, `Change` from the account
  statement, discarding ISIN, quantity, price and balance. DEGIRO is currently cash movements
  in a savings category and nothing more.
- Unconfirmed transactions are excluded from every total (`routers/dashboard.py:37`), so
  mid-period figures silently understate spending with nothing on screen saying so.
- `backend/seed.py` default budgets total 57/37/7 (needs €3,250 / wants €2,100 / savings €400),
  not 50/30/20 — and €1,200 of that "wants" is the Personal Allowance standing adjustment, a
  bookkeeping construct rather than a spending decision.

**In flight, do not re-propose:** category add / rename / delete / reorder is being built in
parallel — `createCategory`, `deleteCategory`, `reorderCategories` and a name-aware
`patchCategory` are already in `frontend/src/api.ts`, with a `CategoryManager` component wired
into Settings.

## Converged Direction

Rework Household Finance from a correct-but-cluttered tracker into a tool that answers
questions rather than displaying data. Three strands, one project:

1. **A real front end.** Migrate to Tailwind + shadcn/ui, collapse seven nav pages to four
   (Overview / Transactions / Budget / Settings), and rebuild the dashboard from scratch. The
   visual direction is deliberately restrained and original — no decorative gradients, no glow
   shadows — with the contrast failures fixed. Desktop-first, must not break on a phone.
2. **A review flow that learns.** Feed the user's own confirmed history into the AI prompt,
   require a one-line reason per suggestion, give the review card real context, and make rule
   patterns editable inline where they're created.
3. **Rollover balances, opt-in per category** — the one primitive that makes lumpy, unpredictable
   bills survivable without forecasting anything. Plus DEGIRO portfolio-value tracking via dated
   snapshots of the Portfolio export.

The needs/wants/savings model, the financial-month-anchored-to-payday design, and the existing
refund/split/standing-adjustment logic all stay as they are. This is not a rewrite of the
backend model — it's a front end worth the model's quality, plus two targeted additions.

## Slice Sequence

Agreed approach: a thin foundation step, then vertical slices. Each slice rebuilds one page on
the new foundation *and* ships its backend feature together, so each is independently shippable
and the project can stop cleanly after any of them.

**Slice 0 — Foundation.** Tailwind + shadcn/ui wired up, the existing token set ported to Tailwind
theme tokens, contrast failures fixed, and the primitives built: Card, Button, Table, Select,
Dialog, StatTile. Nav collapsed to four routes. No page rewrites. Deliberately small.

**Slice 1 — Review flow + learning AI.** Rebuild the review card on the new primitives with real
context (similar past transactions and how they were filed, the category's month-to-date spend,
refund/income/transfer and split visible rather than hidden). Rebuild the AI prompt from the
user's confirmed history with category descriptions and a required one-line reason. Make the
rule pattern editable inline with a live count of how many existing transactions it would match.
Fold rule management into Transactions. *Attacks the loudest daily pain first.*

**Slice 2 — Budget + rollover.** Persistent per-category balances carried across financial months,
opt-in per category, with the overspend-carry policy decided. Rebuild the Budget page on the new
primitives. *The largest backend change in the project.*

**Slice 3 — Overview rebuild.** Merge Dashboard and Analytics into one page designed from scratch
to answer "are we on track", "how much is left", "where did it go" and "did anything unusual
happen" — with a decision made about how unconfirmed transactions are surfaced.

**Slice 4 — DEGIRO.** Portfolio export parsed and stored as dated snapshots; value over time and
contributions vs. growth; the share-purchase double-counting risk resolved.

Remaining pages (Import, Settings) migrate opportunistically as they're touched.

## Carried-Forward Uncertainties

**For Research / Design to resolve:**

- **Rollover semantics.** Does an overspent category carry its negative into next month, or get
  zeroed and absorbed by the overall budget? Actual defaults to the latter with carry as opt-in.
  The blunt option is the one most likely to produce the red-dashboard guilt cycle the retention
  research warns about. Not yet decided.
- **Rollover storage.** Balances become persistent state rather than a value recomputed from
  transactions — a genuine departure from the current model, where everything derives from
  transactions in a window. Needs a deliberate decision about whether balances are stored or
  derived-with-carry, and there is **no migration tool** in this project (tables are auto-created
  via `Base.metadata.create_all()`, plus a `run_migrations()` hook in `db.py`).
- **Unconfirmed transactions.** Currently invisible in all totals. Should the rebuilt Overview
  show them separately, include them provisionally, or keep excluding them with an explicit
  on-screen note?
- **DEGIRO double-counting.** Whether share purchases from the account statement currently
  masquerade as household expenses alongside the €300/month already counted as savings. Needs
  checking against real data before designing the fix.
- **DEGIRO snapshot cadence and storage.** How often the Portfolio export gets imported, and
  what happens to the value-over-time curve when snapshots are irregular.
- **The visual direction itself.** Deliberately left open — "be creative, make it a beautiful
  original design, not AI-sloppish." Needs a real design proposal, not a menu of options.

**Explicitly deferred (wanted, but "expand later"):**

- "Maintain a balance / refill up to" targets, and YNAB's other target types
- Scheduled / expected transactions and bills
- Automatic recurring detection (same amount, same date) — flagged in research as the highest
  value-per-unit-of-work item on the whole landscape; it feeds the forward view, anomaly
  detection, and fixed-vs-flexible classification simultaneously
- Auto-filling the month's budget from targets
- A real rule engine (multi-condition triggers + actions, if/then/finally)
- Monarch's Fixed / Non-Monthly / Flexible predictability axis
- Accounts, balances, transfers as first-class, and full net worth
- Position-level DEGIRO accounting
- Per-person attribution ("who contributed what to the shared pot") — still unresolved from the
  original `thoughts/task.md`
- Tags as a second axis alongside categories
- Bulk actions and keyboard shortcuts in review — explicitly *not* a stated pain

## Suggested Task Description

Rework the Household Finance front end and add two targeted capabilities. Migrate the UI to
Tailwind + shadcn/ui with an original, restrained visual design, collapse the seven nav pages
to four (Overview / Transactions / Budget / Settings), and rebuild the dashboard and review
flow from scratch — including feeding the user's own confirmed categorisation history into the
AI prompt so the app finally learns from its own data. Add opt-in per-category rollover
balances so unpredictable lumpy bills stop wrecking a month, and track DEGIRO portfolio value
over time via dated snapshots of the Portfolio CSV export. The existing backend model
(financial months, needs/wants/savings, refunds, splits, standing adjustments) stays as-is.

---

## Sources

Budgeting mechanics:
[Actual Budget — How Budgeting Works](https://actualbudget.org/docs/budgeting/) ·
[Actual Budget — Schedules](https://actualbudget.org/docs/schedules/) ·
[Actual Budget — Goal Templates](https://actualbudget.org/blog/2023-12-15-automate-your-budget-with-goal-templates/) ·
[YNAB — True Expenses](https://www.ynab.com/blog/how-to-embrace-your-true-expenses) ·
[YNAB — Getting Started with Targets](https://support.ynab.com/en_us/getting-started-with-targets-ryAEP08xC) ·
[Monarch — Flex Budgeting](https://www.monarch.com/blog/flex-budgeting-simplify-your-spending-with-just-one-number) ·
[Lunch Money — Recurring Items](https://lunchmoney.app/features/recurring-expenses/) ·
[Firefly III — Recurring Transactions](https://docs.firefly-iii.org/how-to/firefly-iii/finances/recurring/)

UX and retention:
[Why 67% quit budgeting apps within 30 days](https://www.strategia-x.com/blog/2026-04-12-why-budgeting-apps-fail-30-days-fintech-ux-data/) ·
[Budget app design and retention](https://www.onething.design/post/budget-app-design) ·
[Fintech UX practices 2026](https://www.onething.design/post/top-10-fintech-ux-design-practices-2026)

Open banking:
[Free open banking APIs 2026](https://www.openbankingtracker.com/guides/free-open-banking-apis)
