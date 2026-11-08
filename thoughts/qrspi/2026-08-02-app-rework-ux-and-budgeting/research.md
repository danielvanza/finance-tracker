---
date: 2026-08-02
git_commit: 18c3530
branch: main
repository: household-finance
phase: 2-research
---

# Research Findings

Scope: `backend/` (FastAPI + SQLAlchemy, SQLite) and `frontend/` (React 19 + Vite). ~7k lines of
source excluding lockfiles. A live dev DB exists at `backend/data/finance.db` (gitignored via
`.gitignore:1`) and was queried read-only for the dataset figures in Q4.

---

## Q1: How is the front end structured — styling and data flow?

### Findings — styling

- **Tokens** live in one `:root` block, `frontend/src/index.css:6-134`: backgrounds (`:8-14`),
  borders (`:17-20`), text (`:23-27`), accent (`:30-35`), gradients (`:38-44`), 8 semantic colour
  families (`:47-81`), 13 shadows (`:84-96`), 7 radii (`:99-105`), z-index (`:112-116`), motion
  (`:119-123`). **No spacing scale and no font-size/weight scale exist** — only `--sans`/`--mono`
  at `:108-109`; sizes are set ad hoc (`index.css:126`, `:170-172`). Dark-only: `color-scheme: dark`
  at `index.css:143`, no light theme.
- **Consumption is inline, not class-based.** 428 inline `style={{…}}` objects across 17 `.tsx`
  files; 7 `className` usages total, all the same string `"animate-fade-in"` (`Dashboard.tsx:106`,
  `Rules.tsx:48`, `Analytics.tsx:155`, `Settings.tsx:62`, `Import.tsx:67`, `Transactions.tsx:76`,
  `Budget.tsx:468`). Tokens are referenced 702 times but always as inline strings.
- **Bypass is substantial**: 110 hardcoded hex literals (31 distinct, all duplicating `index.css`
  values), 141 raw `rgba()`, ~520 px literals including fractional one-offs (`CategorySelect.tsx:159`,
  `SummaryCards.tsx:62`). ~40 defined tokens have zero `.tsx` consumers — all 7 `--grad-*`, all 5
  `--shadow-glow-*`, `--shadow-card`, `--bg-surface`, `--bg-overlay`, all `--dur-*`.
  `Budget.tsx:8-12` defines a second colour map in raw hex duplicating the token-based
  `TYPE_META` at `CategorySelect.tsx:47-53`.
- Hover/focus are imperative DOM mutations in handlers, not CSS: `Nav.tsx:134-149`,
  `Transactions.tsx:257-258`, `Budget.tsx:330-331`, `CategorySelect.tsx:310-311`.
- **Build tooling**: `frontend/vite.config.ts` is 17 lines — only `@vitejs/plugin-react` (`:6`), an
  `/api` dev proxy (`:9`), and inlined Vitest config (`:12-16`). **No Tailwind, PostCSS, CSS Modules,
  or CSS-in-JS**; no config files for any of them. Deps (`package.json:12-19`): react-query, lucide,
  react, react-dom, react-router-dom, recharts — **no headless/UI component library**. ESLint
  (`eslint.config.js:8-22`) has **no `jsx-a11y` plugin**. `package.json:6-11` defines no `test` script.
- **Live vs dead stylesheets**: `index.css` is live (sole import, `main.tsx:3`). **`frontend/src/App.css`
  is dead** — the untouched Vite starter template; zero of its selectors (`.counter` `:1`, `.hero`
  `:20`, `#docs` `:98`) match anything, and it references two never-defined vars (`App.css:123,131`).
  Its six `@media` rules are the only breakpoints in the repo. Inside the live sheet, `slideDown`
  (`index.css:246`) is unused, and `shimmer`/`pulseGlow`/`spin`/`fadeIn` are each shadowed by inline
  re-declarations (`Budget.tsx:664-666`, `Transactions.tsx:468`, `Dashboard.tsx:90`,
  `Analytics.tsx:149`, `Import.tsx:399`) — 5 separate `<style>` blocks injected from render output.
- **Primitives**: only `CategorySelect.tsx` (433 lines) and `SplitEditor.tsx` are genuinely shared.
  **No `Button`, `Card`, `Table`, `Input`, `Modal`, `EmptyState`, `Spinner`, `Badge` or error
  component exists.** Counted duplicates: card container ×12 with subtly differing shadow strings
  (`Dashboard.tsx:51-58`, `Analytics.tsx:177-184`, `Settings.tsx:68-75`, `CategoryManager.tsx:105-113`,
  `StandingAdjustments.tsx:93-101`, `Import.tsx:75-83`, `:237-244`, `Rules.tsx:56-63`, `:139-145`,
  `Transactions.tsx:224-230`, `Budget.tsx:589-595`, `ReviewCard.tsx:96-103`) while `--shadow-card`
  goes unused; primary gradient button ×9; `<th>` style ×4; `labelStyle` const declared 3× and
  `inputStyle` 2×; modal shell byte-equivalent between `SplitModal.tsx:68-86` and
  `AddTransactionModal.tsx:114-133`; 4 incompatible loading treatments; 4 empty-state variants.
  `Budget.tsx:21-115` (`TypeCell`) is a second independent dropdown alongside `CategorySelect`.
- **Responsive: zero breakpoints ship.** The only `@media (max-width:…)` rules are the six in dead
  `App.css`; `index.css`'s single media query is `prefers-reduced-motion` (`:290-296`). Grids are
  fixed (`SummaryCards.tsx:106` `repeat(4,1fr)`, `Dashboard.tsx:149` `'2fr 1fr'`, `Budget.tsx:491`),
  tables have no scroll wrapper, `Nav.tsx:74-84` is a non-collapsing 7-link row. Only modals carry
  `maxWidth: calc(100vw - 32px)`.
- **Keyboard/focus/ARIA**: 18 `aria-*`/`role=` attributes app-wide; **5 keyboard handlers total**
  (4 are "Enter → blur"); **1 programmatic focus call** (`CategorySelect.tsx:113`); **0 `tabIndex`**.
  - `CategorySelect.tsx` is the most complete: arrow/Enter/Escape at `:124-153`, `role="listbox"`
    (`:318`), `role="option"` + `aria-selected` (`:370-371`). But it has **no focus trap** (portaled
    to body, `:429`), **no focus restore**, no `aria-activedescendant` — so `highlightIdx` (`:362`)
    is visual only — and no Home/End/type-ahead.
  - Both modals have **no `role="dialog"`, no `aria-modal`, no Escape handling, no focus trap, no
    initial focus, no focus restore** (`SplitModal.tsx:68-86`, `AddTransactionModal.tsx:114-133`).
    Backdrop-click close works. Tab walks straight into the page behind.
  - Drag-reorder (`CategoryManager.tsx:145-150`) is HTML5 drag events with **no keyboard
    alternative** — the grip (`:157-162`) has an `aria-label` but is not a button, has no `tabIndex`
    and no key handler. No live region announces the new order.
  - `outline: 'none'` at 8 sites cancels the one global focus ring (`index.css:189-193`). Of 20
    `<label>`s, exactly one has `htmlFor` (`Import.tsx:136`). Budget's two advertised primary
    interactions are click handlers on a `<tr>` (`Budget.tsx:320`) and a `<span>` (`:370`), neither
    keyboard-reachable. `ReviewCard.tsx:184-207` does implement `role="radiogroup"` correctly — the
    pattern exists but was not reused in `AddTransactionModal.tsx:149-233`.

### Findings — data flow

- **Routes** (`App.tsx:22-28`): `/`→Dashboard, `/analytics`, `/import`, `/transactions`, `/budget`,
  `/rules`, `/settings`. No catch-all, no nested routes. `Nav.tsx:115` matches `pathname ===` exactly.
- **API client** `frontend/src/api.ts` — 26 methods, `BASE = '/api'` hardcoded at `:1` (no env var
  anywhere; `vite.config.ts:9` rewrites `/api`→`localhost:8000`, and backend routers carry no `/api`
  prefix, so the rewrite is load-bearing). **No method checks `response.ok`** — every one is
  `.then(r => r.json())`, so a FastAPI 4xx resolves successfully as `{"detail": …}`. No throw, no
  AbortController, no timeout, no auth.
- Per page (endpoint cross-refs to `backend/routers/`):
  - **Dashboard** — `['dashboard', month]`→`dashboard.py:20`, `['settings']`→`settings.py:15`
    (`Dashboard.tsx:69-76`). Renders SummaryCards, a bar chart over `category_breakdown`, a pie over
    `needs_wants_savings`, an area chart over `monthly_trend`. No mutations.
  - **Analytics** — the same two queries (`Analytics.tsx:74-81`), renders one donut over
    `category_breakdown` filtered `actual > 0` with a 2%-of-total "Other" bucket (`:89-116`).
  - **Budget** — `['budget',month]`→`budget.py:45`, `['categories']`→`categories.py:25`,
    `['dashboard',month]`→`dashboard.py:20` (used *only* for `total_income`, `Budget.tsx:269`), plus
    per-expanded-row `['transactions',{category_id,month}]`→`transactions.py:93` (`:179-186`).
  - **Import** — **uses no React Query at all**; plain `useState` + direct await (`Import.tsx:39-62`).
  - **Rules** — `['rules']`, `['categories']`; edit-save uses a **raw inline `fetch`** bypassing
    `api.ts` entirely (`Rules.tsx:37-40`).
  - **Settings** — `['settings']` + child `StandingAdjustments` and `CategoryManager` components.
  - **Transactions** — `['transactions',sourceFilter]`, `['categories']`, `['review',skippedIds]`
    (`enabled: showReview`, `Transactions.tsx:38-42`).
- **Overlaps**: `/dashboard/summary` is read by **three** pages (Dashboard, Analytics, Budget — same
  key `['dashboard',month]`, so shared only when months coincide); `/settings` by three;
  `/categories` by **five** (`Budget`, `Transactions`, `Rules`, `StandingAdjustments`,
  `CategoryManager`); `/standing-adjustments` by two. `GET /transactions` is read by two pages under
  **different keys**, so two cache entries. `PATCH /transactions/{id}` is called from four sites;
  `PATCH /categories/{id}` from two (Budget sends `{type}`, CategoryManager sends `{name}`).
  Planned-vs-actual is computed twice by two independent backend endpoints and rendered three ways.
- **Server state**: TanStack Query v5, one `QueryClient` created with **zero configuration**
  (`App.tsx:12`) — library defaults (`staleTime: 0`, refetch-on-mount, 3 retries). No Redux/Zustand/
  Context/localStorage (grep returns zero hits). `useMutation` is used in only 2 places
  (`Budget.tsx:281-290`, `Settings.tsx:23-33`); everywhere else is `await api.x()` then
  `invalidateQueries`. **No optimistic updates or `setQueryData` anywhere.**
  Invalidation gaps: **Import invalidates nothing** despite writing the most rows
  (`Import.tsx:39-62`); `Transactions.tsx:46-49` invalidates only `['transactions']`+`['review']`,
  not `['dashboard']`/`['budget']`; `Budget.tsx:285-288` doesn't invalidate the `['dashboard']` query
  the same page reads. Cross-page freshness relies on `staleTime: 0`.
- **Selected month**: component-local `useState` in **three** pages, each with its own copy of an
  identical `currentMonth()` helper (`Dashboard.tsx:23-26,68`; `Analytics.tsx:21-24,72`;
  `Budget.tsx:241-244,247`). Not a URL param, not context, not persisted — grep for
  `useSearchParams|useParams|localStorage|createContext` returns **zero hits**. Navigating between
  pages destroys the selection and resets to the current calendar month. Transactions/Import/Rules/
  Settings have no month state at all.
- **Errors**: not a single `useQuery` destructures `isError`; there are no error boundaries. A failed
  fetch shows a permanent spinner (Dashboard/Analytics) or a permanent empty state (Budget/
  Transactions/Rules — which also can't distinguish loading from empty, since `Budget.tsx:252-265`
  never takes `isLoading`). Mutation errors use the `res.detail` idiom inconsistently: checked in
  `CategoryManager`/`AddTransactionModal`/`SplitModal`, unchecked in all of `Rules.tsx:22-43`,
  `Transactions.tsx:51-73`, `Budget.tsx:274`, and both Import calls (`try/finally`, **no catch**).
- **Tests** (`frontend/src/tests/`, 5 files, ~463 lines): `Settings.test.tsx` is the only page-level
  data-flow test; `CategoryManager.test.tsx:80-138` is the only place the missing-`response.ok`
  contract is pinned; `ReviewCard.test.tsx:74-92` is the only ARIA assertion. **Untested**: `api.ts`
  itself, routing, Nav, Dashboard, Analytics, Budget, Transactions, Rules, every `invalidateQueries`
  call, month state, all modal behaviour, `CategorySelect`'s keyboard handler. `@testing-library/
  user-event` is installed but imported by zero tests.

---

## Q2: Transaction lifecycle, import → confirmed

### Findings

1. **Parse** — `POST /import/preview` (`imports.py:24-38`) and `POST /import/confirm`
   (`imports.py:40-92`), both `source: str = Form(...)` + `UploadFile`. Dispatch via a static dict
   (`imports.py:15`), unknown source → 422 (`:19`). Whole file read into memory, decoded
   `errors="replace"` (`:21-22`). Row DTO is `ParsedTransaction` with exactly 5 fields
   (`importers/base.py:8-14`) — no category, confirmed, or refund flag at parse time.
2. **Dedup** — hash at `importers/base.py:16-26`:
   `sha256("{source}|{date}|{amount}|{description}" + "|{extra}"…)`. ING passes `Notifications` +
   `Resulting balance` as extras (`ing.py:34`); **Revolut and DeGiro pass none** (`revolut.py:27`,
   `degiro.py:29`), so two identical Revolut rows hash identically. Three layers: (a) intra-batch,
   `deduplicate_hashes` (`base.py:28-42`) re-hashes the 2nd+ occurrence as `sha256(f"{hash}|{count}")`
   deterministically — so a single upload can never self-skip; (b) Python set loaded from the whole
   `import_hash` column (`imports.py:27`, `:43`) with in-loop `.add()`; (c) DB `unique=True`
   (`models.py:45`) — with **no `try/except IntegrityError`** around the single commit (`imports.py:87`).
   Preview flags `duplicate: true` and counts (`:37`); confirm skips silently and reports
   `skipped_duplicates` (`:52`). Pinned by `test_imports.py:36-42`.
3. **Rules** — applied only inside `/import/confirm`, per row, before insert (`imports.py:59`).
   `apply_rules` (`categorizer/rules.py:16-23`) loads all rules `ORDER BY priority DESC` (no
   tiebreak), lowercased Python substring `in` (no regex, no word boundary), **first match wins**.
   A sign-incompatible match falls through to the next rule rather than aborting
   (`rules.py:5-13,19-22`; pinned `test_categorizer.py:156-171`). On hit: sets `category_id`,
   **`confirmed = True`** (rule hits bypass review entirely), `categorised_by = "rule"`
   (`imports.py:60-64`).
4. **AI** — runs after the whole rule pass, on rows with no rule match, in one call site
   (`imports.py:66,71-83`). Writes `category_id`, `ai_confidence`, `categorised_by = "ai"` but
   **leaves `confirmed = False`** — AI rows *are* the review queue. A miss leaves all provenance NULL.
5. **Review queue** — `GET /transactions/review` (`transactions.py:126-134`).
   **"Needs review" is `confirmed == False` and nothing else** — confidence and category presence are
   irrelevant. Order is `ORDER BY transactions.date ASC` + `.first()` (LIMIT 1): **oldest first, one
   at a time, no secondary sort key**, so same-date rows are arbitrary. `skip_ids` is a client-held
   `NOT IN` exclusion list (`:129-130`), not persisted. Returns bare `null` when empty.
6. **Confirm patch** — `PATCH /transactions/{id}` (`transactions.py:190-212`), body `TransactionPatch`
   (`schemas.py:55-60`), all fields optional, `None` = leave alone (so `category_id` can never be
   nulled). Writes at most `category_id`, `categorised_by`, `is_refund`, `confirmed`, plus split rows.
   **The only downgrade in the system**: `if tx.categorised_by == "ai": → "manual"` (`:198-199`);
   a `"rule"` value is deliberately preserved. Confirming stamps no timestamp (no such column) and
   touches no other row.
7. **Rule from transaction** — `POST /transactions/{id}/create-rule` (`transactions.py:229-267`), no
   body. **Pattern = `tx.description.lower().strip()`** (`:241`) — the *entire* description, no
   truncation, tokenisation, merchant heuristic, or regex escaping. Rule-dedup is exact
   case-sensitive equality (`:242-245`); new rules always `priority=0`. Matching afterwards uses
   **three different mechanisms**: Python `in` at import (`rules.py:20`), Python `in` in the backfill
   (`transactions.py:251`), and SQL `ilike(f"%{pattern}%")` in `POST /rules/test` (`rules.py:51-53`,
   where `%`/`_` act as wildcards). Retroactive effect (`:247-266`): scans **every unconfirmed row in
   the table** (no date/source scoping), sets `confirmed=True`, `category_id`, `categorised_by="rule"`.
   **Human-confirmed rows are never overwritten.** Skips `is_refund` or split rows (`:253-255`).
   The sign gate is re-implemented inline (`:257-261`) rather than reusing `_is_sign_compatible`.
   The source transaction is confirmed only incidentally by self-matching the loop — the docstring
   at `:231-233` claims otherwise. Split rows can't be a rule source (`category_id` is NULL → 400).
   Note `POST /rules` (`rules.py:17-23`) stores the pattern **verbatim with no normalisation** and
   triggers no backfill — a different contract from create-rule.
8. **Variants**
   - **Refunds** — `is_refund` (`models.py:48`), set only via PATCH (`:200-201`) or manual create
     (`:144-145`); **imports never set it**. Validated positive-amount + expense-type category
     (`_validate_refund`, `:56-66`), re-validated across split parts (`:206-209`). **No FK to the
     original expense** — netting works purely by shared category via `is_spend_part`.
   - **Splits** — created only via PATCH `splits` (`_apply_splits`, `:69-90`): ≥2 parts, must sum
     exactly to parent, non-zero, same sign, categories must exist. **Parent's `category_id` is set
     to `None`** (`:90`), and because `category_id` is applied before splits in the handler
     (`:195` vs `:204`), a patch setting both ends with the category nulled. `[]` unsplits.
     Provenance is untouched by splitting. `TransactionSplit` carries **no provenance columns at all**.
   - **Transfers** — **no transfer entity, endpoint, column, or code path exists.** The only
     representation is a seeded `exclude`-typed category (`seed.py:32-34`). The two legs are ordinary
     unlinked rows that enter review and confirm normally. Because `exclude` bypasses both sign gates
     (`rules.py:8-9`, `transactions.py:259`), an exclude rule sweeps both legs regardless of sign.
   - **Manual** — `POST /transactions` (`:137-155`) and `POST /transactions/adjustment-pair`
     (`:158-187`, exactly 2 legs netting to zero). Both set `source=manual`, **`confirmed=True` (never
     enter review)**, `categorised_by="manual"`, and a uuid-salted `import_hash` (`:150`) that can
     never dedup. Pair legs are **not linked by any FK**. `DELETE` is manual-only (`:215-226`).
     Standing-adjustment legs (`adjustments.py:38-48`) are the one exception: a deterministic hash
     (`:46`) makes re-materialisation idempotent, and `standing_adjustment_id` is **the only
     row-to-row FK link in the system**.

---

## Q3: AI categorisation and what bounds prompt size

### Findings

- Everything is in `backend/categorizer/ai.py` (118 lines). **System prompt** (`ai.py:92`), verbatim
  and un-interpolated: `"You are a financial transaction categoriser. Respond with JSON only."`
  **User prompt** (`ai.py:81-87`) interpolates `group_label` (`"income"`/`"expense"`), a comma-joined
  list of **category names only**, and one line per transaction (`ai.py:76-79`):
  `f'{global_idx}: "{tx.description}" ({sign_label}, €{abs(tx.amount):.2f})'`.
- **Sent**: description (raw) and `abs(amount)`. **Not sent**: date, source, id, signed amount,
  category *types*, existing rules, budgets, prior categorisations, or any few-shot examples.
  Categories are sign-filtered per prompt (`_get_categories_for_sign`, `:18-25`).
- **Response**: bare JSON array of `{index, category, confidence}`. Parsed via
  `_strip_markdown_fences` (`:11-15`) then `json.loads` (`:97`). Unknown names dropped (`:104-105`),
  confidence outside [0,1] dropped (`:107-108`). All errors caught per-batch and `print`ed
  (`:110-115`); a missing result leaves the row uncategorised in the review queue. **No fallback
  category.** Notable: `cat_by_name` is built from *all* categories (`:49`), not the sign-filtered
  subset, so a wrong-sign name is still accepted; `stop_reason` is never checked, so a `max_tokens`
  truncation would fail `json.loads` and silently drop all 50 rows.
- **Batching**: `BATCH_SIZE = 50` (`ai.py:8`), applied after partitioning by sign (`:60-61,74`).
  Calls = `ceil(n_income/50) + ceil(n_expense/50)`. **No concurrency** — nested sync `for` loops
  calling `client.messages.create` (`:89`) from an `async def` handler (`imports.py:41,73`) with no
  threadpool, so the whole import blocks the event loop.
- **Config**: model `claude-haiku-4-5-20251001` (`ai.py:7`), `max_tokens=4096` (`:91`).
  **No temperature, no timeout, no retry config** — SDK defaults apply (600s timeout, 2 retries).
  Key from `ANTHROPIC_API_KEY` via SDK default; client rebuilt on every call (`:52`).
- **Persistence**: `category_id` / `ai_confidence` / `categorised_by` at `imports.py:78-80`.
- **Size**: prompt length scales with exactly two inputs — (a) transactions per batch, **capped at
  50**; (b) **the category list, which is unbounded** (`ai.py:48,72,83`; `POST /categories` caps
  nothing). Descriptions are interpolated raw with **no length truncation**. Critically, the prompt
  **never reads the `transactions` table** — no history, no examples, no rule list. So database
  accumulation does *not* make individual prompts larger; it only produces more calls per import.
- **Caps that exist**: `BATCH_SIZE` and sign-filtering. **Absent**: character cap, description
  truncation, category-list cap, upload-size limit, row limit on `/import/confirm`, cost ceiling.
- **Observability: none.** No `import logging` anywhere in `backend/`; the only diagnostics are five
  bare `print()` calls in `ai.py`. `response.usage` is never read (`:95` touches only `content[0].text`).
  No timing, counters, metrics, or APM. The sole user-visible signal is the `categorised_by_ai` count
  (`schemas.py:23` → `Import.tsx:387`).
- **Prompt caching: none.** The system prompt is a plain string (`:92`), not a content-block list, so
  it cannot carry a `cache_control` breakpoint. No memoisation of the category list, no response
  cache, no dedup of identical descriptions within a batch.
- **Verified directly**: `backend/tests/test_imports.py` mocks nothing, `main.py:1-2` calls
  `load_dotenv()` at import, `backend/.env` contains a real `ANTHROPIC_API_KEY`, and the seed creates
  no rules — so `test_confirm_saves_transactions` and `test_confirm_deduplicates_on_reimport` each
  issue live Haiku calls when pytest runs from `backend/`.

---

## Q4: Categorisation provenance, and the data as a dataset

### Findings — what is recorded

- Two orthogonal axes on `Transaction`: **`source`** (`TransactionSource` = ing|revolut|degiro|manual,
  `models.py:13-17,40`) and **`categorised_by`** (`CategorisedBy` = **rule|ai|manual only**,
  `models.py:19-22,43`, nullable — NULL means never categorised or AI failed). There is **no `seed`
  member** (seeding creates no transactions). Plus `confirmed` (`:42`, nullable, Python-side default
  only, **no server_default**) and `ai_confidence` (`:44`, Float, nullable).
- **`TransactionSplit` (`models.py:61-70`) carries no provenance whatsoever** — no `categorised_by`,
  no confidence, no confirmed flag. For a split row, provenance lives only on the parent, whose
  `category_id` has been nulled.
- **No `updated_at`, no audit table, no record of the previous category.**
- Write sites: `imports.py:55-58` (init), `:61-63` (rule → confirmed+rule), `:78-80` (ai, stays
  unconfirmed); `transactions.py:146-151` and `:174-181` (manual, confirmed); `adjustments.py:38-48`;
  `transactions.py:198-199` (**the only downgrade**, ai→manual); `:203` (confirmed, accepts `False`
  too); `:262-264` (backfill **overwrites `ai` and NULL → `rule`**).
- Two consequences of the write ordering: **`ai_confidence` is never cleared** — after an ai→manual
  downgrade or a rule backfill, a stale confidence value remains, so rows can read
  `categorised_by="rule"` with a non-NULL `ai_confidence`. And **splitting leaves provenance
  untouched**, so a hand-split AI row still reads `"ai"`.
- Tests pin very little: `test_manual_transactions.py:31-33` is the **only** test asserting a
  `categorised_by` value from the API. Unpinned: the ai→manual downgrade, the backfill's `"rule"`
  write, confidence survival, split provenance, and every import-path provenance write
  (`test_imports.py` asserts only counts).

### Findings — the dataset

- **Live DB `backend/data/finance.db`**, 110 KB, untracked. Actual counts: **transactions 222**,
  categories 21 (exactly the seed), budgets 78, rules 16, standing_adjustments 2, settings 1,
  **transaction_splits 0**. Dates 2026-03-24 → 2026-08-01, 64 distinct dates.
- Per **financial** month: 2026-04 = 102 rows, 2026-05 = 84, 2026-07 = 4, 2026-08 = 32. **A full month
  is ~85–102 rows**, ≈1 row per bank-statement line, plus exactly 4 synthetic rows/month
  (2 adjustments × 2 legs, `adjustments.py:34-48`).
- Distributions: `source` = ing 214 / manual 8 (**no revolut or degiro rows at all**);
  `categorised_by` = manual 165 / rule 57 / **ai 0** / NULL 0; `confirmed` = **all 222 true** (so the
  review queue currently returns `None`); `category_id IS NULL` = 0; `is_refund` = 1.
  Descriptions: **86 distinct over 222 rows** (2.6× repetition), avg 24 chars, max 40; top repeats
  `Oranje Spaarrekening` ×15, `DA VAN ZIEL` ×14, `Thuisbezorgd.nl…` ×11.
- **Indexes**: `models.py` contains **no `index=True` and no `Index(...)` anywhere**. The only key
  structures are three `unique=True` (`Category.name` `:27`, `Transaction.import_hash` `:45`,
  `StandingAdjustment.name` `:77`) and one `UniqueConstraint` on `Budget(category_id, month)` (`:103`).
  Live `sqlite_master` confirms **5 auto-indexes and zero explicit indexes**. SQLite does not
  auto-index FK columns, so `category_id`, `date`, `confirmed`, `categorised_by`, `source`,
  `description` are all unbacked.
- **Cheap vs scan** (verified with `EXPLAIN QUERY PLAN`): **exactly two cheap shapes exist** —
  `import_hash = ?` and `Category.name = ?`. Everything the UI drives is a full scan: month range
  + confirmed, `category_id`, description LIKE, `categorised_by`, and both ORDER BYs add a temp
  B-tree. At 222 rows this is unobservable. Ironically the one useful index is never probed — dedup
  pulls the whole column into a Python set (`imports.py:27,43`).
- **Ranked/capped queries**: `group_by`, `.distinct(`, `.offset(`, and `func.count` appear **zero
  times** in `backend/`. There is **no top-N, no frequency ranking, no most-recent-N query anywhere.**
  The only two capped reads of `transactions` are (a) `POST /rules/test` — `.limit(20)` hardcoded
  with **no ORDER BY**, then a further Python slice `matches[:5]` (`rules.py:48-54`; note the
  reported `matches` count is itself capped at 20 and is not a true count); and (b) `.first()`
  (LIMIT 1) for the review queue (`transactions.py:131`) and the adjustment existence probe
  (`adjustments.py:27-31`). SQL aggregation is limited to one `func.max` (`categories.py:51`) and
  five `COUNT(*)` (`categories.py:119-125`, `seed.py:48`).
- **Full-window loads**: `GET /transactions` with no `month` returns the **entire table** unlimited
  (`transactions.py:101-123`); create-rule loads all unconfirmed rows and matches in Python
  (`:248-251`); every dashboard/budget total loads the whole month and aggregates in Python.
  **All financial aggregation is structurally Python-side** — `aggregate.py` operates on ORM objects.
  `_to_out` reads `tx.category.name` without eager-loading it (`transactions.py:34`), so listing N
  rows issues N extra category SELECTs.
- **Pagination: none anywhere.** No `limit`/`offset`/`page` param on any endpoint. `skip_ids`
  (`transactions.py:127-130`) is a monotonically growing client-held `NOT IN` exclusion set, not a cursor.

---

## Q5: Categories, budgets, and how "actual" is computed

### Findings

- **Category** (`models.py:24-32`): `name` unique NOT NULL, `type` enum NOT NULL, `sort_order` int
  (Python default 0, no server_default, not unique). CRUD in `routers/categories.py`: list ordered by
  `sort_order` (`:27`); create assigns `max(sort_order)+1` (`:51-52`) and **also inserts a
  `month=None` default budget row for needs/wants/savings only** (`:58-59`); rename/retype (`:85-109`);
  reorder is a **permutation of existing sort_order values among the submitted ids only**
  (`:77-79`) so untouched rows never shift; delete (`:112-138`).
- **Delete is RESTRICT enforced in application code**, not by the DB: it counts transactions, splits,
  rules and standing adjustments and 422s if any is non-zero (`categories.py:118-133`). Budgets are
  **not** a blocker — they are hard-deleted first (`:135-137`). The declared `ondelete=` clauses
  (`models.py:41,67,79-80,93,100`) are **inert: no `PRAGMA foreign_keys=ON` is set anywhere**
  (`db.py:7` passes only `check_same_thread`). Pinned by `test_categories.py:88-150`.
- **Budget** (`models.py:97-104`): `month` is **nullable, with NULL as the "default template"
  sentinel** — there is no separate template table. Per-month rows use the **label month's 1st**,
  never the financial start day. `UniqueConstraint(category_id, month)` (`:103`) — but SQLite treats
  NULLs as distinct, so the template row is not uniqueness-protected.
- **A month's rows are created lazily on the first `GET /budget`**, copied from the `month IS NULL`
  templates, skipping income/exclude types (`_auto_populate`, `budget.py:20-42`, called at `:54`).
  Not copy-forward from the previous month. **`GET /dashboard/summary` does not call it**
  (`dashboard.py:53-54` reads whatever exists), so a month never opened in the Budget page shows
  `planned: 0` on the Dashboard. Editing a template never retro-edits materialised months and vice
  versa (`budget.py:104-127`).
- **Financial month** (`financial_month.py:4-43`): inclusive both ends. `start_day == 1` → calendar
  month with an explicit December branch (`:24-32`). Otherwise **payday-anchored and backward-looking**:
  window is `date(prev_year, prev_month, start_day)` → `date(year, month, start_day - 1)` (`:41-42`),
  with January rolling back to the prior December (`:36-39`). The `1 <= start_day <= 28` guard (`:21-22`)
  is what makes the arithmetic total — it can never overflow February. Window length varies 28–31 days.
  `start_day` comes from the `financial_month_start_day` setting, **defaulting to 24**, via a helper
  **copy-pasted verbatim into three routers** (`budget.py:15-17`, `dashboard.py:15-17`,
  `transactions.py:20-22`). Pinned by 8 cases in `test_financial_month.py`; leap-year February is uncovered.
- **Budget-vs-actual** (`budget.py:45-101`): parse month → `_auto_populate` → read start_day →
  **`materialise_standing_adjustments` (a write during a GET)** → derive window → build the exclusion
  set → query → accumulate. The query has **exactly three predicates** (`:70-74`):
  `date >= start`, `date <= end`, **`confirmed == True`**. Accumulation (`:76-82`) skips
  `cid is None` and income/exclude categories, then adds `-amount` when `is_spend_part`.
  So: **unconfirmed rows are invisible to every total**, and since imports leave AI-categorised rows
  unconfirmed, nothing an AI suggested counts until a human confirms it.
- **Emission is per budget row, not per category with spend** (`:84-87`), so spend on a category with
  no budget row for that month is computed and then silently dropped from the response.
- **Shared helpers** — `aggregate.py` provides exactly two: `effective_parts` (`:12-20`, split rows
  replace the parent entirely; `is_refund` propagates parent→children) and `is_spend_part` (`:23-27`,
  `amount < 0 or is_refund`, contribution always `-amount`, so refunds can push a category negative).
  Both are per-transaction, so **the month-window query itself is duplicated three times, not shared**
  (`budget.py:70-74`, `dashboard.py:33-37`, `dashboard.py:106-110`).
- **Standing adjustments** fold in by *becoming real rows*, not by being added at aggregation time
  (`adjustments.py:8-51`): future months never materialise (`:17-18`), months before `start_month` are
  skipped (`:25-26`), and any month already holding a row for that adjustment is skipped entirely, so
  **deleting a leg is treated as opting out for that month** (`:27-33`).
- **Persisted**: `planned_amount` per (category, month) incl. template; standing-adjustment legs as
  ordinary rows; splits; `is_refund`; the start-day setting. **Recomputed every request**: every
  `actual_amount` and every dashboard figure, including a 6-month trend that issues **six additional
  full-window queries per request**. **No caching or memoisation anywhere on the backend** — no
  `lru_cache`, no cache table, no ETag/Cache-Control.
- Consequence worth noting: three read endpoints have **write side effects** (`budget.py:54,57`,
  `dashboard.py:30`, `transactions.py:109`), so which rows exist in the DB depends on which months
  have been viewed.

---

## Q6: Schema creation, evolution, seeding

### Findings

- **Models** — 7 tables in `backend/models.py`, all on `Base` from `db.py:10-11`: `categories`
  (`:24`), `transactions` (`:34`), `transaction_splits` (`:61`), `standing_adjustments` (`:72`),
  `rules` (`:89`), `budgets` (`:97`), `settings` (`:106`, with `key` as the PK). Three `str`-enums
  (`:6-22`) emitted as plain `VARCHAR`. Only `Transaction.splits` declares a cascade
  (`all, delete-orphan`, `:53-58`). No self-referential FKs; the one multi-FK-to-same-table case is
  `StandingAdjustment` → `categories` twice, disambiguated with explicit `foreign_keys=` (`:79-80,86-87`).
- **Creation** — `Base.metadata.create_all(bind=engine)` at **`main.py:27`, at module import time**
  (not a startup event or lifespan), guaranteed by the side-effect `import models` at `:7`. Order:
  create_all → `run_migrations` (`:28`) → routers (`:30-37`) → `run_seed` (`:39-40`). Engine from
  `DATABASE_URL`, default `sqlite:///./data/finance.db` (`db.py:5`), resolved against CWD.
- **Evolution — no Alembic and no migration tool** (zero occurrences of `alembic` anywhere, nothing
  in `pyproject.toml`). **But a hand-rolled `run_migrations` does exist** at `db.py:13-42`: a
  hardcoded `{table: [(column, ddl)]}` dict (`:20-28`), `PRAGMA table_info` introspection (`:35`),
  `ALTER TABLE … ADD COLUMN` for missing columns (`:39-40`), all in one transaction. Tables that
  don't exist yet are skipped on the assumption `create_all` builds them complete (`:36-37`).
  `create_all` itself is a **complete no-op on an existing table** — it never adds/drops columns,
  changes types, or reconciles constraints.
- **This produces real, observable drift.** The DDL fragments are hand-written and not derived from
  the models, so a migrated DB differs from a fresh one: live `transactions.standing_adjustment_id`
  lacks the `ON DELETE SET NULL` that `models.py:50` declares (fragment at `db.py:23` omits it), and
  live `standing_adjustments.start_month` is nullable while `models.py:84` declares `nullable=False`
  (SQLite cannot ADD COLUMN NOT NULL without a default). **`run_migrations` has zero test coverage**,
  and since tests build schemas from the models directly, the drift is structurally invisible to the suite.
- **Backfills** — exactly one, inline in the same function (`db.py:29-32`): a `WHERE start_month IS
  NULL` UPDATE, run unconditionally on every startup (`:41-42`) and idempotent by predicate. No
  one-off scripts exist anywhere (`scripts/`, `Makefile`, `Dockerfile`, `.github/` are all absent).
- **Seeding** — `run_seed` (`seed.py:47-95`), called at import time from `main.py:39-40` and by ~11
  test modules. The guard is a **single early return on "any category exists"** (`:48-49`).
  Consequence: seeding is all-or-nothing on a virgin DB — **newly added seed entries will never
  appear on any DB that already has one category**, and the per-name checks downstream (`:53-57`
  etc.) are unreachable in that case. Seeds 16 budgeted categories + their template budget rows,
  4 income categories (no budgets), 1 exclude category, `financial_month_start_day = "24"`, and
  2 × €600 standing adjustments wired by category *name* (`:81-93`, silently skipped if lookup fails).
  Pinned by 8 tests in `test_seed.py`, including idempotency (`:26-34`) and the rename case (`:68-78`).
- **Test DB** (`tests/conftest.py`, 21 lines): in-memory SQLite with `StaticPool`, fresh engine +
  `create_all` **per test function**, `drop_all` teardown. **`run_migrations` is never called**;
  **`run_seed` is not run by the fixture** (each API module calls it itself); `get_db` is overridden
  per-module, not in conftest. Note that merely importing `app` from `main` executes `main.py:27-28,
  39-40` against the **real file DB** as an import side effect.
- **Adding a table today**: define the model — `create_all` (`main.py:27`) issues CREATE TABLE on next
  start, tests pick it up via `conftest.py:15`, and `run_migrations` needs no entry (`db.py:36-37`
  skips absent tables). **Adding a column today: two edits** — the `Column(...)` on the model (covers
  fresh DBs and all tests) *and* a hand-written `(name, ddl)` entry in `db.py:20-28` (covers the
  existing file DB). That second fragment is where model and DB can disagree, as they already do.
  SQLite's ADD COLUMN cannot add NOT NULL without a default, cannot add UNIQUE, and cannot alter or
  drop a column — none of those cases has any mechanism in the repo.
- **Doc drift**: `README.md:20`, `SETUP.md:333`, and `AGENTS.md:42` all state no migration mechanism
  exists. `run_migrations` arrived later, in commit `f363e22`.

---

## Q7: CSV importers per source, and what the reporting endpoints compute

### Findings — importers

- The base class (`importers/base.py`) provides only the DTO, `make_hash`, `deduplicate_hashes`, and
  `_read_content` (`:47-52`). **Each subclass overrides only `source` and `parse()`** — there is no
  shared row loop, date parser, amount parser, or filter helper; all three re-implement them.

| | ING (`ing.py`) | Revolut (`revolut.py`) | DeGiro (`degiro.py`) |
|---|---|---|---|
| Delimiter | `;` (`:11`) | `,` (`:11`) | `,` (`:11`) |
| Date | `%Y%m%d` (`:17`) | `fromisoformat` on `Started Date`, time dropped (`:19`) | **`%d-%m-%Y` day-first** (`:17`) |
| Description | `Name / Description` (`:19`) | `Description` (`:20`) | **`Product`** — instrument name, not `Description` (`:18`) |
| Amount | `Amount (EUR)`, `,`→`.` (`:21`) | `Amount` as-is, **no separator handling** (`:21`) | `Change`, `,`→`.` (`:23`) |
| Sign | **separate `Debit/credit` column**; only lowercase `"debit"` negates (`:23-24`) | single signed column | single signed column |
| Skips | blank `Date` (`:14-16`) | `State == "REVERTED"` (case-sensitive exact, `:14-15`) + blank date (`:16-18`) | blank `Date` (`:14-16`) + **blank `Change`** (`:20-22`) |
| Hash extras | `Notifications`, `Resulting balance` (`:34`) | **none** (`:27`) | **none** (`:29`) |

- Discarded columns: ING drops `Account`, `Counterparty`, `Code`, `Transaction type`, `Tag`; Revolut
  drops `Type`, `Product`, `Completed Date`, **`Fee`** (so fees are not netted), `Currency`, `Balance`;
  DeGiro drops `Time`, `ISIN`, `Description`, `FX`, `Balance`, `Order ID` and both unnamed currency
  columns (`DictReader` collapses the duplicate empty headers to one `""` key — acknowledged at
  `degiro.py:19`).
- **Currency is never read by any importer** and there is no conversion or currency filter. **No
  importer applies a zero-amount filter**; DeGiro's is a blank-string check, so `0.00` imports as a
  zero row. Revolut has no blank-amount guard, so an empty `Amount` reaches `Decimal("")` and raises.
- **Dispatch is user-selected, never sniffed** — `IMPORTERS` dict (`imports.py:15`), `source` as a
  form field from three buttons (`Import.tsx:4,107-130`). The importer stamps `source=self.source`,
  so a CSV uploaded under the wrong bank button is parsed *and labelled* as that bank with no
  header cross-check.
- `make_hash` applies **no normalisation** — `Decimal.__str__` preserves trailing zeros, so
  `67.40` and `67.4` hash differently; descriptions are not lowercased or whitespace-collapsed.
  Dedup layers and duplicate handling are as described in Q2 §2.

### Findings — reporting endpoints

- There are exactly **two**: `GET /dashboard/summary` (`dashboard.py:20-134`) and `GET /budget`
  (`budget.py:45-101`). **Neither declares a `response_model`** — both return bare dicts, and the
  schemas `DashboardSummary` (`schemas.py:157-166`) and `BudgetRow` (`schemas.py:122-130`) are
  **defined but never imported anywhere in the backend**. Dashboard ships floats, not Decimals;
  budget ships Decimals. `BudgetRow` also lacks the `category_type` key the handler actually emits.
- **All aggregation is Python loops over ORM objects** — `func` is imported at `dashboard.py:3` and
  never used. One eager-loaded query, flattened to `parts` (`:44`), then every total derived in memory.
- **The trend is 6 separate queries in a Python loop**, N hardcoded by the literal `range(5, -1, -1)`
  (`dashboard.py:98-118`), with year rollback via `while m <= 0` (`:101-104`). No client-controllable
  window. So one `/dashboard/summary` request runs **7 full-window transaction queries** (the
  requested month is queried twice, at `:33` and again as the last trend iteration). Standing
  adjustments are materialised **only for the requested month** (`:30`), so the five earlier trend
  months omit those legs unless a prior request materialised them.
- Both endpoints share **byte-for-byte identical** filter clauses: `date >= start`, `date <= end`,
  `confirmed == True`. Universally: unconfirmed excluded, window inclusive both ends, split parents
  never double-counted, refunds never income and always negative spend, zero-amount parts counted as
  neither, and **no `source` filter** (manual and standing-adjustment rows count like imported ones).
- **Where totals agree and where they diverge** — the precise version:
  - Dashboard `category_breakdown` actuals vs `/budget` `actual_amount`: **predicates are equivalent**
    (`needs/wants/savings` is exactly the complement of `income/exclude` given the 5-member enum), so
    the earlier framing of "different exclusion sets" is a difference in expression, not in result.
    The real difference is **emission**: dashboard emits per category with spend; budget emits per
    budget row, dropping spent-on categories that lack one.
  - Dashboard `total_expenses` vs the trend's last element: **identical** (`:49-50` vs `:112-113`).
  - **`total_expenses` vs the sum of `category_breakdown`: these differ.** `total_expenses` excludes
    only `exclude`-typed categories, while the breakdown additionally requires a truthy `cid` and a
    `needs/wants/savings` type. So `total_expenses` counts, and the breakdown does not: (1)
    **uncategorised parts** (`cid is None`, since `None not in exclude_cat_ids`), reachable via the
    create-rule backfill which sets `confirmed=True`; (2) negative amounts sitting on an
    income-typed category. The same gap applies to `/budget`.
  - **`total_income` vs `income_breakdown`: differ symmetrically** — `total_income` counts any
    positive non-refund part not on an `exclude` category, including uncategorised ones and positives
    on expense categories; the breakdown requires a truthy `cid` and `type == "income"`.
  - `left_over` = `total_income - total_expenses` (`:125`), so it inherits both divergences.
  - `needs_wants_savings`: same predicate as the breakdown slices, but **different arithmetic** —
    `savings` sums Decimals then casts once (`:90-93`), while `needs`/`wants` sum already-cast floats
    off `category_breakdown` (`:94-95`), so sibling keys of one dict have different rounding behaviour.
- Unpinned by any test: the uncategorised leakage into `total_expenses`/`total_income`, and `/budget`
  dropping spent-on categories with no budget row.

---

## Cross-Cutting Observations

- **Duplication is the dominant structural pattern, on both sides.** Backend: `_get_start_day` ×3,
  the month-window query ×3, the sign-compatibility gate ×2 (`rules.py:5-13` vs
  `transactions.py:257-261`), the `type.value if hasattr(...)` idiom ~12×, three different
  pattern-matching mechanisms for one rule concept. Frontend: card shell ×12, gradient button ×9,
  `currentMonth()` ×3, `labelStyle` ×3, category colour maps ×3, two independent dropdowns, four
  loading treatments. `aggregate.py` is the one place duplication was deliberately factored out —
  and its docstring states the invariant explicitly (`aggregate.py:1-7`).
- **`confirmed` is the single gate on all money.** Every total filters `confirmed == True`, and
  imports leave AI rows unconfirmed. So the AI's output has zero effect on any number until a human
  confirms it — and the live DB shows `categorised_by = 'ai'` on **0 of 222 rows**.
- **Reads write.** `GET /budget` materialises budget rows *and* standing adjustments; `GET /dashboard/
  summary` and `GET /transactions?month=` materialise adjustments. Which rows exist depends on
  browsing history.
- **Schemas are declared but largely unenforced.** Neither reporting endpoint nor any transactions
  route wires a `response_model`; `TransactionOut`, `BudgetRow` and `DashboardSummary` are dead code.
  Likewise the DB's `ondelete=` clauses are inert without `PRAGMA foreign_keys=ON`, and referential
  integrity is enforced in application code instead (`categories.py:118-133`).
- **Everything is sized for the current dataset.** 222 rows, no indexes beyond three unique
  constraints, no pagination, no caching, Python-side aggregation, a 6× query fan-out per dashboard
  load, and the whole `import_hash` column pulled into a set on every import.
- **Observability is absent end to end** — no `logging` import in the backend, five `print()` calls
  total, no token/cost/latency measurement, and no frontend error boundaries or query error handling.
- **Test coverage is asymmetric.** The backend suite is broad (15 files) and pins financial semantics
  well — refunds, splits, transfers, the financial-month window, seeding. The frontend has 5 files
  covering 3 components and 1 page. Unpinned on both sides: `run_migrations` and its drift, all
  provenance transitions, the aggregation divergences in Q7, `api.ts`, routing, and all modal behaviour.

## Open Areas

- **Row-volume projection is based on ~2 complete months** of one bank (ING only; the live DB holds
  **zero Revolut and zero DeGiro rows**), so the Revolut and DeGiro importers are unexercised against
  real data, and `transaction_splits` is empty — the split code paths are inert against production data.
- **Leap-year February** is not covered by `test_financial_month.py`, and `start_day=1` end-of-month
  handling is tested only for April (30 days).
- The **`ai_confidence` distribution and AI accuracy cannot be characterised** — no row in the live DB
  has ever been categorised by AI, and no telemetry was ever recorded.
- Whether the two `test_imports.py` tests issuing live API calls is intentional is not determinable
  from the code; the mechanism is confirmed, the intent is not.
- Cost and latency of the AI path **cannot be quantified from the codebase** — nothing measures either.
