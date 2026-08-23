You are executing ONE qrspi implement phase in /home/hermes/finance-tracker (work there).

Read first:
- thoughts/qrspi/t_cbc05e98/plan.md  ← your working doc; execute ONLY Phase P1, then stop.
- backend/schemas.py, backend/models.py (skim), backend/tests/test_importers.py,
  backend/tests/test_standing_adjustments.py, backend/tests/test_manual_transactions.py

HARD BOUNDARIES (merge gate enforces): you may edit ONLY backend/schemas.py, NEW
backend/money.py, and backend/tests/**. Never touch routers/, models.py, db.py, frontend/,
importers/, categorizer/. Do not refactor anything else. Commit at the end with message
starting "B1 P1:".

## What P1 delivers

### 1. NEW backend/money.py (no dependencies beyond stdlib)
```python
from decimal import Decimal, ROUND_HALF_UP
_CENT = Decimal("0.01")

def to_cents(value) -> int:
    """Decimal|float|str|int (euros) -> integer cents. Quantize HALF_UP."""
    if isinstance(value, bool):
        raise TypeError("bool is not a monetary value")
    if isinstance(value, int):
        d = Decimal(value)
    elif isinstance(value, Decimal):
        d = value
    else:
        d = Decimal(str(float(value)))   # kills float binary noise: 19.99 -> '19.99'
    return int(d.quantize(_CENT, rounding=ROUND_HALF_UP) * 100)

def to_decimal(cents: int) -> Decimal:
    """integer cents -> Decimal euros quantized to 0.01."""
    if isinstance(cents, bool) or not isinstance(cents, int):
        raise TypeError("cents must be an int")
    return (Decimal(cents) / 100).quantize(_CENT)
```
Add a module docstring explaining the v2 wire format decision (int cents on the wire,
DB stays Numeric(12,2)).

### 2. backend/schemas.py — the cents flip
Use pydantic: `from pydantic import BaseModel, ConfigDict, field_validator, field_serializer` and `from pydantic import AliasChoices, AliasGenerator; from pydantic.alias_generators import to_camel` is NOT needed. Pattern per OUTPUT money field (rename + accept legacy key when routers populate by old name):

```python
class StandingAdjustmentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)
    ...
    amount_cents: int = Field(validation_alias=AliasChoices("amount", "amount_cents"),
                              serialization_alias="amount_cents")
    @field_validator("amount_cents", mode="before")
    @classmethod
    def _amount_to_cents(cls, v):
        return v if isinstance(v, int) and not isinstance(v, bool) else money.to_cents(v)
```
Notes:
- from_attributes ORM rows carry Decimal `amount`; validation_alias makes it populate;
  the before-validator converts Decimal→cents int. When FastAPI serializes a response_model
  it uses FIELD NAMES by default (alias by default only for input), so wire emits
  `amount_cents`. Verify this in the test run; if any endpoint emits the legacy name,
  add `model_config = ConfigDict(serialize_by_alias=True)` equivalent (pydantic v2.11+
  supports serialize_by_alias=True in ConfigDict) — check installed pydantic version with
  `.venv/bin/python -c "import pydantic; print(pydantic.VERSION)"`.
- Apply the SAME pattern to every OUTPUT money field:
  * ParsedTransactionOut.amount → amount_cents (alias "amount")
  * SplitOut.amount → amount_cents (alias "amount")  [routers currently build dicts with key "amount"]
  * BudgetRow.planned_amount → planned_amount_cents (alias "planned_amount");
    BudgetRow.actual_amount → actual_amount_cents (alias "actual_amount")
  * DashboardSummary: total_income→total_income_cents, total_expenses→total_expenses_cents,
    total_savings→total_savings_cents, left_over→left_over_cents (aliases = legacy names);
    keep category_breakdown/income_breakdown/needs_wants_savings/monthly_trend as-is (dicts).
- INPUT models keep their field NAMES but accept cents ints from F1-era clients while
  still accepting legacy euro Decimals today. Pattern:
```python
class SplitIn(BaseModel):
    category_id: int
    amount: Decimal = Field(validation_alias=AliasChoices("amount", "amount_cents"))
    @field_validator("amount", mode="before")
    @classmethod
    def _maybe_cents(cls, v):
        # int (and only int, not bool/float/str) means cents under v2
        if isinstance(v, int) and not isinstance(v, bool):
            return money.to_decimal(v)
        return v  # Decimal/float/str = legacy euros
```
  Apply to: SplitIn.amount, TransactionCreate.amount, AdjustmentLeg.amount,
  StandingAdjustmentCreate.amount, StandingAdjustmentPatch.amount (Optional — careful:
  validator must let None through), BudgetPatch.planned_amount.
- Import: `from money import to_cents, to_decimal` (backend runs with cwd=backend).

### 3. Tests (ONLY where they assert money fields of flipped endpoints)
Run first: `.venv/bin/python -m pytest tests/test_importers.py tests/test_standing_adjustments.py tests/test_manual_transactions.py -q` from backend/. Update assertions that read `amount`/euro floats on these endpoints to expect `*_cents` ints (e.g. 19.99 → 1999). Do not weaken tests; adapt units only. If test_budget/dashboard assert those response models' fields, adapt the same way — but do NOT touch router-level dict endpoints (they are unchanged in P1).

### Verification (run yourself, report real output)
1. `.venv/bin/python -m pytest -q` → expect ALL green (125 baseline ± adapted).
2. Quick sanity: `.venv/bin/python -c "from money import to_cents, to_decimal; print(to_cents(19.99), to_cents('20.005'), to_decimal(1999))"` → 1999 2001? NO — to_cents('20.005') is str→float→'20.005'→quantize→2001? Actually 20.005 quantizes HALF_UP to 20.01→2001 cents. Print whatever it gives and confirm it's deterministic; report it.
3. `git add -A && git commit -m "B1 P1: money.py + cents wire serializers (schemas)"`.

Report back: files changed, pytest counts (exact numbers), sanity outputs, commit sha.
If something in this brief contradicts what you find in the code, STOP and report the
contradiction instead of improvising.
