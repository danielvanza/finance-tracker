#!/usr/bin/env bash
# FIN-E3 merge-gate integration rung: boot backend purely via alembic upgrade head
# (no create_all) on a scratch DB and probe the live API.
set -u
DB="/tmp/gate-e3-$(date +%s)-$$.db"
LOG="${DB}.log"
export DATABASE_URL="sqlite:///${DB}"
UVICORN="backend/.venv/bin/uvicorn"
[ -x "$UVICORN" ] || UVICORN="$(command -v uvicorn)"
"$UVICORN" main:app --app-dir backend --port 8123 >"$LOG" 2>&1 &
SRV=$!
for i in $(seq 1 60); do
  sleep 0.5
  curl -sf localhost:8123/health >/dev/null && break
done
H=$(curl -s localhost:8123/health)
S=$(curl -s localhost:8123/dashboard/summary | head -c 80)
B=$(curl -s 'localhost:8123/budget' | python3 -c 'import sys,json;print(len(json.load(sys.stdin)))' 2>/dev/null)
T=$(curl -s localhost:8123/transactions | python3 -c 'import sys,json;print(len(json.load(sys.stdin)))' 2>/dev/null)
kill "$SRV" 2>/dev/null
wait "$SRV" 2>/dev/null
echo "health: $H"
echo "summary: $S"
echo "budget_rows: $B"
echo "tx_n: $T"
python3 - "$DB" <<'EOF'
import sqlite3, sys
con = sqlite3.connect(sys.argv[1])
print("alembic_version:", con.execute("select * from alembic_version").fetchall()[0][0])
print("tables:", sorted(r[0] for r in con.execute("select name from sqlite_master where type='table'")))
EOF
rm -f "$DB" "$DB.log"
