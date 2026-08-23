# FIN-E9 cleanup evidence — root data/finance.db archived

Date: 2026-08-23 20:13:31 UTC
Executed per thoughts/qrspi/t_346c0c73/plan.md Phase 3.

## Pre-move safety
- Script guard `lsof` on /home/hermes/finance-tracker/data/finance.db returned
  no holders -> PRE_MOVE_LSOF_CLEAR.

## Archive
- Destination: /home/hermes/finance-db-archive/root-data-finance-20260823T201331Z.db
- sha256: f7b80d0729d54619e8cb4f7cf159fc167c85a28cf30ae81ff6656115ca593431
- Method: shutil.move (atomic rename); root data/ dir removed (os.rmdir).
- The archive is persistent and must never be deleted.

## Row counts of the ARCHIVED copy (venv python sqlite3 module, mode=ro)
| table                | count |
|----------------------|-------|
| budgets              | 32    |
| categories           | 21    |
| rules                | 0     |
| settings             | 1     |
| standing_adjustments | 2     |
| transaction_splits   | 0     |
| transactions         | 4     |
| alembic_version      | 0 (table exists, empty) |

All domain counts match the task.md ground-truth root column.

## Provenance deviation vs task.md
task.md recorded root `alembic_version` as ABSENT. On 2026-08-23, during
plan-phase validation, a root-CWD uvicorn probe ran app startup (create_all +
migrations) against the stale copy, creating an EMPTY alembic_version table
(0 rows). Domain row counts were unaffected. Recorded here so the delta is
explained, not mysterious.
