#!/usr/bin/env bash
# F1 integration smoke: boot the real backend, assert v2 cents wire format.
# Exit 0 = pass. Read-only: no writes beyond sqlite access.
set -u
cd "$(dirname "$0")/../../.."
PORT=8010
LOG=$(mktemp)
backend/.venv/bin/python -m uvicorn main:app --port "$PORT" --app-dir backend >"$LOG" 2>&1 &
PID=$!
trap 'kill $PID 2>/dev/null; wait $PID 2>/dev/null' EXIT

for i in $(seq 1 30); do
  if curl -sf "http://localhost:$PORT/health" >/dev/null 2>&1; then break; fi
  sleep 0.5
done

HEALTH=$(curl -sf "http://localhost:$PORT/health") || { echo "FAIL: /health unreachable"; tail -20 "$LOG"; exit 1; }
echo "health: $HEALTH"
[ "$HEALTH" = '{"status":"ok"}' ] || { echo "FAIL: unexpected health body"; exit 1; }

# Financial month label for the summary query (any valid YYYY-MM works)
SUMMARY=$(curl -sf "http://localhost:$PORT/dashboard/summary?month=2026-08") || { echo "FAIL: summary endpoint"; tail -20 "$LOG"; exit 1; }
echo "$SUMMARY" | head -c 400; echo

python3 - "$SUMMARY" <<'PYEOF'
import json, sys
d = json.loads(sys.argv[1])
for k in ("total_income_cents", "total_expenses_cents", "total_savings_cents", "left_over_cents"):
    v = d.get(k)
    if not isinstance(v, int):
        print(f"FAIL: {k}={v!r} is not int cents"); sys.exit(1)
nws = d.get("needs_wants_savings", {})
for k in ("needs_cents", "wants_cents", "savings_cents"):
    if not isinstance(nws.get(k), int):
        print(f"FAIL: needs_wants_savings.{k} missing/not int (got {list(nws)})"); sys.exit(1)
for row in d.get("category_breakdown", []):
    if not isinstance(row.get("actual_cents"), int) or not isinstance(row.get("planned_cents"), int):
        print(f"FAIL: category_breakdown row keys {list(row)}"); sys.exit(1)
for row in d.get("income_breakdown", []):
    if not isinstance(row.get("amount_cents"), int):
        print(f"FAIL: income_breakdown row keys {list(row)}"); sys.exit(1)
for row in d.get("monthly_trend", []):
    if not isinstance(row.get("total_cents"), int):
        print(f"FAIL: monthly_trend row keys {list(row)}"); sys.exit(1)
print("wire check: totals + nested breakdown keys all integer *_cents")
PYEOF
[ $? -eq 0 ] || exit 1

TXNS=$(curl -sf "http://localhost:$PORT/transactions")
echo "$TXNS" | python3 -c "
import json,sys
txs=json.load(sys.stdin)
if txs:
    t=txs[0]
    assert 'amount_cents' in t, f'FAIL: legacy amount key: {list(t)[:12]}'
    assert isinstance(t['amount_cents'],int), 'amount_cents not int'
    for s in t.get('splits',[]):
        assert isinstance(s['amount_cents'],int) and isinstance(s['is_refund'],bool)
print(f'transactions wire check: {len(txs)} rows, amount_cents int + splits is_refund bool')
" || exit 1

echo "SMOKE PASS"
exit 0
