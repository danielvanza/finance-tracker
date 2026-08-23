# FIN-B1 — backend schema + money (Decimal→cents v2)

Task: t_cbc05e98 · repo /home/hermes/finance-tracker · branch: main (direct commits, established pattern)
Owned: backend/{models,schemas,db,money(new),aggregate}.py + backend/tests/**
Forbidden: frontend/**, backend/routers/**, importers/**, categorizer/**

## Contract decisions (recorded for review)
1. **Names**: wire fields become `*_cents` (int). Sources: api-contracts.json concrete shapes,
   DESIGN.md §3 S3 "integer cents (`amount_cents`)", manifest B1 note "except where schemas
   change response field names per contract v2". The prose "field names unchanged" in the same
   contract is overridden by its own concrete shapes. Flagged to reviewer.
2. **Scope of the flip**: only endpoints driven by Pydantic response_model flip in B1
   (import-preview, standing-adjustments list/create/patch). Dict-returning routers
   (transactions, budget, dashboard) flip in B2 (routers forbidden to B1; B2 may-not-touch
   schemas ⇒ schemas must be final after B1).
3. **Input models**: routers read `.amount` attributes in Python — field NAMES stay (routers
   untouched); cents accepted via `validation_alias=AliasChoices("<name>", "<name>_cents")` +
   before-validator: `int`(non-bool) → cents→Decimal; float/str/Decimal → euros (legacy).
   Transitional dual-read; F1 removes euro paths.
4. **Output models**: field renamed `<x>_cents: int` with alias accepting the legacy key;
   before-validator runs `money.to_cents`. Routers that construct these models by legacy
   keyword keep working (populate_by_name=True).
5. **Refund parts**: parts share parent sign (invariant kept). Netting arithmetic for a
   negative refund part requires `contribution = -abs(amount)`, which equals today's `-amount`
   for every existing case (positive refund, negative expense). Added to aggregate.py as
   `spend_contribution(amount, is_refund)`; B2 adopts it in spend_service. `is_spend_part`
   unchanged. SplitOut.is_refund deferred to B2 per TASK-DAG.

## Phases

### P1 — money.py + schemas cents flip (+ affected router tests)
- [x] backend/money.py: to_cents/to_decimal (bool guards, float noise killed via str round-trip, HALF_UP).
- [x] schemas.py: ParsedTransactionOut, StandingAdjustmentOut, SplitOut, BudgetRow,
      DashboardSummary totals → *_cents with legacy aliases; input models dual-read cents int
      vs legacy euros via AliasChoices + before-validators.
- [x] Tests adapted/extended only where flipped endpoints assert money fields
      (test_imports preview rows [-6740, 346026]; SA create/list int amount_cents).
- [x] Verify: full pytest 125 passed (+3 pinning assertions). Commit 73b89d2.

### P2 — is_refund column + migration + per-part effective_parts + tests
- [x] models.py TransactionSplit.is_refund nullable, no default/server_default.
- [x] db.py run_migrations: "transaction_splits": [("is_refund", "BOOLEAN")] (exact delta, no backfill).
- [x] aggregate.py per-part flag w/ parent fallback; spend_contribution(-abs refund); is_spend_part unchanged.
- [x] Schemas completions (B2 cannot edit schemas): TransactionOut.amount_cents flip;
      SplitOut.is_refund bool (None→False; resolution upstream).
- [x] New tests: test_split_refunds.py(3), test_migrations.py(2, real file DB + idempotency),
      test_money.py(13). Verify: 143 passed. Commit 6495e17.

### P3 — R7 micro-fix + live verification + gate
- [x] db.py: sqlite file URLs makedirs(dirname, exist_ok=True) before create_engine (9 lines).
- [x] Live fresh-clone sim (DATABASE_URL=sqlite:////tmp/fresh-data/nested/fresh.db): 144 passed,
      no manual mkdir (orchestrator re-ran independently: same result).
- [x] Live migration probe on COPY of real finance.db: is_refund present post-migration, rows intact.
- [x] Live wire probes: /health ok; SA amount_cents [60000,60000] ints; import preview rows
      amount_cents [-6740] int. Full suite 144 passed. Commit f004ed0.

## Verification record
- Baseline: 125 passed @ 18c3530 (pre-work).
- Final: 144 passed (125 baseline + 18 new − 1 net restructure), 12.9s, run twice by orchestrator.
- Merge gate (python3 ~/.hermes/fleet/merge-gate.py --repo … --no-seams --unit-cmd pytest
  --build-cmd TestClient boot+/health smoke): static PASS, unit PASS (144), contract PASS,
  integration PASS → verdict PASS at f004ed0.
- Pushed: 18c3530..f004ed0 → github.com/danielvanza/finance-tracker main (via SSH URL;
  https credential helper absent on this box).
