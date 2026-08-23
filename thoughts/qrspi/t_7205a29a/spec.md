# FIN-G contract-seam tests — design spec (branch G)

Task t_7205a29a · repo /home/hermes/finance-tracker

REBASE NOTE (2026-08-22 late): branch B1 landed on main mid-run (commits
73b89d2, 6495e17). All shapes below were RE-PROBED against current HEAD
6495e17 via live TestClient calls. This version supersedes the earlier draft.

## Goal

Two new test files anchor the re-platform quality floor:

1. `backend/tests/test_contract_seams.py` — for EVERY endpoint id in
   `contracts/api-contracts.json`: (a) the route exists in the FastAPI app,
   (b) a real request/response round-trips through TestClient matching the
   declared shape. Contract file loaded as fixture data; failures name the
   endpoint id.
2. `frontend/src/tests/contract.test.ts` — every call in `frontend/src/api.ts`
   maps to a declared endpoint id in the same contract file.

Acceptance: pytest + vitest green with the files present; deleting either file
OR `contracts/` fails at least one suite (suppression guard). No production
code edits — owned surfaces only (manifest G-contract-tests).

## Ground truth probed live at HEAD 6495e17 (post-B1)

REQUESTS: every money-bearing request body now accepts integer cents
(`amount_cents`) thanks to B1's AliasChoices validators. Seam tests SEND
v2-style cents bodies everywhere. This half of the contract HOLDS today.

RESPONSES split by router implementation:
- Routers with `response_model` emit v2 cents ALREADY (Pydantic
  serialization_alias): import-preview (`rows[].amount_cents`),
  standing-adjustments list/create/patch (`amount_cents`). These seams
  PASS against the contract NOW.
- Routers returning hand-built dicts still emit legacy euro floats under old
  field names: transactions (`amount`, splits `amount`, no splits is_refund),
  budget (`planned_amount`/`actual_amount`), dashboard (`total_income`,
  breakdown `actual/planned/amount`, trend `total`). These seams CANNOT pass
  until B2 rewires the routers → xfail(strict).

## Endpoint inventory (28 ids) — status at HEAD

PASS today (assert full contract shape, NO xfail):
  health; import-preview (rows[].{date,amount_cents,description,source,
  import_hash,duplicate}, total, duplicates); import-confirm (counts quintet);
  standing-adjustments-list / -create / -patch ({id,name,amount_cents>0,
  income_category_id,expense_category_id,active,start_month});
  standing-adjustment-delete; categories-list/-create/-reorder/-delete;
  rules-list/-create/-update/-delete; rule-test; settings-get; setting-patch;
  transaction-delete ({"deleted":id}; 422 imported-immutable);
  transaction-create-rule ({rule_created,transactions_updated}; 400 no-category)

xfail(strict) — legacy dict responses, flips green when B2 lands:
  transactions-list; transactions-next-review; transaction-create;
  transaction-adjustment-pair; transaction-patch; budget-get;
  budget-patch-month; budget-patch-default; dashboard-summary;
  TransactionOut/SplitOut ENVELOPE (asserted inside the transactions-list
  test: amount_cents int + splits[].{…,is_refund bool})
  category-patch: BASE seam (name/type patch → CategoryOut) PASSES today;
  ONLY the v2 type-change GUARD sub-assert (422 + counts without force,
  force:true override) is xfail(strict) — guard ships with B2.

## Backend test architecture

- Module docstring explains the suppression guard.
- Module-level GUARD: repo root = Path(__file__).resolve().parents[2];
  require contracts/{manifest.json,api-contracts.json,schema.json} AND
  frontend/src/tests/contract.test.ts; else pytest.exit(..., returncode=4).
  Mirror guard in the vitest file (contracts/api-contracts.json +
  backend/tests/test_contract_seams.py must exist else throw). Every deletion
  scenario kills at least one suite.
- Load api-contracts.json once; helper ep(id) raising KeyError naming the id.
- Fixtures follow conftest.py pattern (in-memory SQLite StaticPool,
  dependency_overrides[get_db], run_seed). Seed extra rows:
    * confirmed ing "-45.00" "Albert Heijn weekly" → Food - Essential (id 3)
    * unconfirmed revolut "-10.00" "Bol.com order" → Food - Essential
    * unconfirmed ing "ALBERT HEIJN extra" → Food - Essential
      (retro-confirm target for create-rule: transactions_updated >= 1)
- ROUTE EXISTENCE: iterate ALL 28 endpoints; expected path = router prefix +
  contract path; resolve each (method, path-template) against app.routes
  (APIRoute.path_format handles {param}); one test, message names missing ids.
- ROUND TRIPS: test_seam_<id> per endpoint; real TestClient calls; exact
  key-set + type assertions per inventory above. Money request bodies sent
  as cents ints. xfail markers exactly per inventory (strict=True,
  reason="legacy dict wire format; flips when B2 rewires routers").
- Import CSVs: copy ING sample from backend/tests/test_importers.py
  (semicolon CSV, quoted headers), multipart source=file.
- Dashboard/budget use PAST label month "2026-01" (financial range
  2025-12-24..2026-01-23, deterministic; materialisation may fire — assert
  STRUCTURE only: dashboard top-level key set, needs_wants_savings ⊆
  {needs,wants,savings} superset-equal keys, monthly_trend length 6 of
  {month,total}; budget rows non-empty with declared key set).
- Settings PATCH matrix: valid→200 {key,value}; unknown key→404; invalid
  value "29"→422.
- Category reorder: three real ids reversed; response [{id,sort_order}] in
  REQUEST order.
- Category-delete 422 path: try deleting an in-use category → 422; unused
  fresh category deletes → {"deleted": id}.
- Rule-test: pattern "albert" after seeded txns → matches>=1, examples list.

## Frontend test architecture (frontend/src/tests/contract.test.ts)

- node:fs read of frontend/src/api.ts relative to import.meta.url (../../.. =
  repo root) + contracts/api-contracts.json.
- Parse exported members of `api`: top-level `name: (...)` entries; within
  each block extract template-literal URL `${BASE}/...` and HTTP method from
  the fetch init ('POST'|'PATCH'|'DELETE' string literal; default GET).
  Strip query strings; normalise `${...}` interpolations to `{param}`.
- Declared map from contract endpoints with non-null frontend_caller
  ("api.<name>") → (method, path).
- Assert BOTH directions: every parsed call ↔ declared endpoint (method equal;
  path equal modulo placeholder syntax); mismatches name the call/id.
  Known-good expectation: 24 callers map; endpoints with null frontend_caller
  (budget-patch-default, rule-update, rule-test) have no caller — direction 2
  skips them.
- Mirrored suppression guard at module scope (throw if contract file or
  backend seam test missing).
- Pure fs/text analysis; vitest globals enabled; no network.

## Non-goals

No edits outside the two owned files. No new deps. If main moves AGAIN during
the run (B2/F1 parallel workers share this checkout), re-probe and
recalibrate before final verification.
