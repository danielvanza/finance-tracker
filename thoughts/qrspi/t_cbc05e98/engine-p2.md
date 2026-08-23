You are executing ONE qrspi implement phase in /home/hermes/finance-tracker (work there).

Read first:
- thoughts/qrspi/t_cbc05e98/plan.md ← working doc; execute ONLY Phase P2 (as amended below), then stop.
- backend/models.py, backend/db.py, backend/aggregate.py, backend/schemas.py,
  backend/tests/conftest.py, backend/tests/test_splits.py

HARD BOUNDARIES (merge gate enforces): you may edit ONLY backend/models.py, backend/db.py,
backend/aggregate.py, backend/schemas.py, and backend/tests/**. Never touch routers/,
frontend/, importers/, categorizer/, money.py (already final). Do not refactor anything else.
Commit at the end with message starting "B1 P2:". Use one-shot git identity flags
(`git -c user.name="danielvanza" -c user.email="daniel.van.ziel7@gmail.com" commit ...`) —
do NOT change git config; do NOT `git add` untracked contracts/, design/, thoughts/.

## What P2 delivers

### 1. models.py — the v2 column
TransactionSplit gains: `is_refund = Column(Boolean, nullable=True)` — NULLABLE, NO default,
NO server_default (NULL = inherit parent's is_refund; backward compatible). Add a short
comment mirroring contracts/schema.json wording. Nothing else changes in models.py.

### 2. db.py — migration entry (EXACT delta)
In run_migrations' new_columns dict add:
    "transaction_splits": [("is_refund", "BOOLEAN")],
That is the literal contracts/schema.json v2_migration_delta. No backfill (none required).

### 3. aggregate.py — per-part refund flag + contribution helper
```python
def effective_parts(tx):
    """... existing docstring, updated: each part carries its OWN refund flag;
    a split part with NULL is_refund inherits the parent transaction's flag."""
    if tx.splits:
        return [(s.category_id, s.amount,
                 tx.is_refund if s.is_refund is None else s.is_refund)
                for s in tx.splits]
    return [(tx.category_id, tx.amount, tx.is_refund)]

def spend_contribution(amount: Decimal, is_refund: bool) -> Decimal:
    """Signed contribution to category spend. Expenses contribute -amount.
    Refunds net against spend regardless of sign: -abs(amount) (a same-sign
    negative refund part must not count as fresh spend). For every pre-v2 case
    (positive refunds, negative expenses) this equals the historic -amount."""
    return -abs(amount) if is_refund else -amount
```
Keep is_spend_part EXACTLY as-is (signature + behaviour).

### 4. schemas.py — two completions (B2 cannot edit schemas later, so finish them NOW)
a. TransactionOut: `amount: Decimal` → `amount_cents: int` with
   `Field(validation_alias=AliasChoices("amount", "amount_cents"), serialization_alias="amount_cents")`,
   ConfigDict(from_attributes=True, populate_by_name=True), before-validator using the file's
   existing `_as_cents` helper. Match the style of the other flipped models.
b. SplitOut gains: `is_refund: bool = False` with a before-validator mapping None→False
   (`v if isinstance(v, bool) else bool(v) if v is not None else False`). Comment: NULL DB
   value means inherit-parent; parent-fallback resolution happens upstream (aggregate.effective_parts),
   serializers expose resolved bools.

### 5. Tests (new file(s) under backend/tests/)
a. Mixed-refund split aggregation (the acceptance-critical case): parent tx amount -250.00,
   is_refund False, two splits: A -125.00 is_refund NULL, B -125.00 is_refund True.
   Assert: effective_parts yields exactly [(catA, Decimal('-125.00'), False), (catB, Decimal('-125.00'), True)];
   spend_contribution(A)=+125, spend_contribution(B)=-125; sum == 0 net; also assert a
   positive refund part (-abs) nets against spend: spend_contribution(Decimal('40.00'), True) == -40.
   Also cover: unsplit tx unchanged behaviour; split part NULL flag inherits parent's True.
   Build ORM objects on the conftest `db` fixture (see test_splits.py for how tx+category rows are made).
b. Migration on a pre-v2 SQLite FILE (tests/test_migrations.py): create a temp-file DB with RAW SQL
   containing transactions/transaction_splits tables WITHOUT is_refund columns (copy minimal DDL
   from models.py: transactions needs id,date,amount,description,source,import_hash NOT NULL etc.;
   include categories table too if FKs require; keep it minimal but valid), insert one split row,
   then run Base.metadata.create_all(engine) + db.run_migrations(engine) on it.
   Assert PRAGMA table_info(transaction_splits) contains is_refund, the pre-existing row is intact,
   and reading via an ORM session gives is_refund None. Also assert idempotency: running
   run_migrations twice does not raise/duplicate.
c. Money unit tests (tests/test_money.py): to_cents(19.99)==1999, to_cents(Decimal('20.005'))==2001,
   to_cents(-3.50)==-350, to_cents('12.34')==1234, to_cents(True) raises TypeError,
   to_decimal(1999)==Decimal('19.99'), to_decimal(-350)==Decimal('-3.50'),
   to_decimal(1999.0) raises TypeError, round-trip to_decimal(to_cents(x))==x quantized for a few values.

### Verification (run yourself, report real output)
1. `.venv/bin/python -m pytest -q` from backend/ → ALL green (125 baseline + your new tests).
2. `.venv/bin/python - <<'PY'` style probe: build the mixed split scenario in memory, print
   effective_parts + contributions; confirm output matches the test asserts.
3. Commit ONLY the touched owned files: "B1 P2: split is_refund column+migration, per-part effective_parts, TransactionOut/SplitOut cents+flag".

Report back: files changed, exact pytest counts, probe outputs, commit sha.
If code contradicts this brief, STOP and report instead of improvising.
