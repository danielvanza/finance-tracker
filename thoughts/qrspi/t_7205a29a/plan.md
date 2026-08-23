# Plan — FIN-G contract-seam tests (t_7205a29a)

Spec: thoughts/qrspi/t_7205a29a/spec.md (authoritative shapes + xfail list).

## Phase 1 — backend/tests/test_contract_seams.py

- [x] Write the file per spec §"Backend test architecture":
      suppression guard → contracts fixture loader → route-existence sweep
      (all 28 ids) → per-endpoint round-trip tests with exact key-set asserts.
- [x] xfail(strict) markers ONLY on: import-preview, transaction-create,
      transaction-adjustment-pair, transaction-patch,
      standing-adjustment-create, standing-adjustment-patch, category-patch,
      budget-get, budget-patch-month, budget-patch-default, dashboard-summary
      (+ envelope check). Everything else must pass on main TODAY.
Verify:
- [x] `cd backend && python -m pytest tests/test_contract_seams.py -v`
      → all non-money seams PASS; money seams XFAIL; ZERO unexpected
      passes/failures. Full suite still 125+green.

## Phase 2 — frontend/src/tests/contract.test.ts

- [x] Write the file per spec §"Frontend test architecture": fs-read api.ts +
      api-contracts.json, parse callers, bidirectional coverage asserts,
      mirrored suppression guard.
Verify:
- [x] `cd frontend && npx vitest run src/tests/contract.test.ts` green;
      full `npx vitest run` 6 files / 25+ tests green.

## Phase 3 — suppression guard proof + merge gate

- [x] Prove the guard in BOTH directions (temp moves, restored afterwards):
      a) mv backend file away → vitest fails; restore
      b) mv frontend/src/tests/contract.test.ts away → pytest exits code 4; restore
      c) mv contracts/ away → pytest exits 4 AND vitest fails; restore
- [x] `git add -A && git commit` (backend+frontend test files + thoughts/).
- [x] Run ~/.hermes/fleet/merge-gate.py --repo /home/hermes/finance-tracker --no-seams
      → report verdict JSON.

## Live verification (the actual commands, real output)

Every verify step above is executed literally; counts reported from stdout.
No stub runs, no assumed greens.
