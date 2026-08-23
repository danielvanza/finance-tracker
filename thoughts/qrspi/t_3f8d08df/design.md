# Design + Schema — FIN-E1: make AI categorisation non-blocking

Task t_3f8d08df · finance-tracker · branch `fin-v3-recurring-forecast`

## Problem restated
POST /import/confirm calls `batch_categorise_with_ai()` synchronously. The Anthropic client is built with no timeout/retry config, batches are unbounded in count (50 rows each), and all failures `print()`. A large CSV or a hung API holds the HTTP request indefinitely.

## Non-negotiables
1. **Wire contract unchanged** — `/import/confirm` response stays `{imported, skipped_duplicates, categorised_by_rule, categorised_by_ai, uncategorised}` (all int). contracts/api-contracts.json:33 untouched.
2. **194 backend tests stay green.** Existing tests patch `categorizer.ai.anthropic.Anthropic` and assert on `messages.create` kwargs (`messages`, `system`, `model`, `max_tokens`) — the call shape must survive.
3. **Zero `print(` in backend/categorizer/ai.py** (acceptance grep).
4. **A simulated hung/failing Anthropic client cannot hang the endpoint.**

## Decisions

### D1 — Client config: timeout 30s, max_retries 2
`anthropic.Anthropic(timeout=AI_TIMEOUT_SECONDS, max_retries=AI_MAX_RETRIES)`.
- 30s covers haiku latency comfortably; worst case per batch = 30×(1+2)=90s.
- Module constants so tests can monkeypatch them.
- The SDK's own retry handles transient errors; our batch loop already continues on APIError, so one dead batch never kills the import.

### D2 — Budget: wall-clock seconds cap, not batch-count cap
Chose **time budget** over N-batch cap because the task allows either and time directly bounds the user-visible wait; batch-count caps scale badly if BATCH_SIZE ever shrinks.
- `AI_TIME_BUDGET_SECONDS = 60` module constant. Checked before each batch; expired ⇒ stop issuing new calls.
- Overflow rows simply get no result ⇒ they land in the router's existing `uncategorised` counter path (imports.py:83). No schema change needed — the seam already counts them.
- Worst case bounded: 60s budget + at most one in-flight call ≤ 90s ⇒ endpoint returns well under ~3min even on pathological input; hung socket dies at the 30s client timeout instead of forever.
- Income group processed first (current order preserved), so overflow skews to expense tail rows — acceptable for v3; noted as known behaviour.

### D3 — Logging: stdlib logging, logger per module, basicConfig INFO in main.py
- ai.py gets `logger = logging.getLogger(__name__)`; every print becomes `logger.warning(...)` / `logger.error(...)` at appropriate levels:
  - config error constructing client → error
  - non-JSON-array response → warning
  - anthropic.APIError → warning (per-batch, recoverable)
  - JSON parse / key / value errors → warning
- main.py: `logging.basicConfig(level=logging.INFO)` before app construction (after load_dotenv), so uvicorn prod runs emit real logs without code changes elsewhere.
- No third-party deps added.

### D4 — Stretch (BackgroundTask): SKIP
Moving the AI pass to a FastAPI BackgroundTask would return `categorised_by_ai=0` while work is still running, which silently redefines two contract fields' semantics mid-request-cycle and forces a frontend change to display "pending". Task says only take it "ONLY if it doesn't complicate the wire contract". It does. Leaving sync but bounded (D1+D2) satisfies ACCEPT.

## Schema impact
None. No DB migration, no Pydantic model change, no contract change.

## Files touched
| File | Change |
|---|---|
| backend/categorizer/ai.py | timeout/retry constants + client config; time-budget check in batch loop; print→logging |
| backend/main.py | `logging.basicConfig(level=logging.INFO)` |
| backend/tests/test_categorizer.py | new tests: timeout args passed, budget expiry stops batches, no-print regression |

## Test plan (new)
1. `test_ai_client_configured_with_timeout_and_retries` — patch Anthropic, assert called with `timeout=30, max_retries=2`.
2. `test_time_budget_stops_new_batches` — 120 txs (⇒ ≥3 batches), fake clock advancing past budget after first call; assert `create` called once, remaining txs uncounted.
3. `test_budget_expiry_leaves_rows_uncategorised` — via router-level flow or direct: results dict missing indices ⇒ caller counts uncategorised (already covered by imports flow, assert here at unit level that function just omits them).
4. `test_no_print_statements_in_ai_module` — read source file, assert `"print("` absent.
5. Simulated-hang live check: monkeypatched client whose create() sleeps > budget+timeout cannot exceed bounded duration (covered by test 2 mechanics).

## Verification plan
- `pytest tests -q` from backend/.venv — expect 194+N green.
- `grep -c "print(" backend/categorizer/ai.py` → 0.
- merge-gate run at HEAD (design-gate satisfied by this doc pre-implementation).
