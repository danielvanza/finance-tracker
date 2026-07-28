# Financial Month & Income Categories Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add configurable financial month boundaries (salary-aligned periods) and income category support so positive transactions are classified and appear on the dashboard, while being excluded from the 50/30/20 budget.

**Architecture:** A `Setting` key-value table stores the financial month start day (default 24). A shared `get_financial_month_range()` helper converts a "YYYY-MM" label + start_day into a `(start_date, end_date)` tuple used by all routers. The `CategoryType` enum gains an `income` value with 3 seeded income categories. Categorisation (rules + AI) becomes sign-aware: positive amounts match only income categories, negative only expense categories.

**Tech Stack:** FastAPI, SQLAlchemy 2.0, SQLite, Pydantic v2, React 19, TypeScript, TanStack Query, Vite, recharts

**Spec:** `docs/superpowers/specs/2026-03-18-financial-month-income-categories-design.md`

---

## Chunk 1: Data Model + Financial Month Helper

### Task 1: Add `income` to `CategoryType` enum and `Setting` model

**Files:**
- Modify: `backend/models.py`
- Test: `backend/tests/test_models.py`

- [ ] **Step 1: Write failing tests for `income` enum value and `Setting` model**

First, update the import line at the top of `backend/tests/test_models.py`:

```python
from models import Category, Transaction, Rule, Budget, CategoryType, Setting
```

Then add the following tests to `backend/tests/test_models.py`:

```python
def test_category_with_income_type(db):
    cat = Category(name="Salary", type="income", sort_order=20)
    db.add(cat)
    db.commit()
    assert cat.id is not None
    assert cat.type == CategoryType.income

def test_setting_creation(db):
    from models import Setting
    s = Setting(key="financial_month_start_day", value="24")
    db.add(s)
    db.commit()
    loaded = db.query(Setting).filter_by(key="financial_month_start_day").first()
    assert loaded is not None
    assert loaded.value == "24"

def test_setting_primary_key_is_key(db):
    from models import Setting
    db.add(Setting(key="test_key", value="a"))
    db.commit()
    db.add(Setting(key="test_key", value="b"))
    from sqlalchemy.exc import IntegrityError
    import pytest
    with pytest.raises(IntegrityError):
        db.commit()
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && python -m pytest tests/test_models.py::test_category_with_income_type tests/test_models.py::test_setting_creation tests/test_models.py::test_setting_primary_key_is_key -v`
Expected: FAIL — `income` not in CategoryType, `Setting` not defined

- [ ] **Step 3: Add `income` to `CategoryType` and create `Setting` model**

In `backend/models.py`, add `income` to the enum and the `Setting` class:

```python
class CategoryType(str, enum.Enum):
    needs = "needs"
    wants = "wants"
    savings = "savings"
    income = "income"
```

Add the `Setting` model after the `Budget` class:

```python
class Setting(Base):
    __tablename__ = "settings"
    key = Column(String(100), primary_key=True)
    value = Column(String(500), nullable=False)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && python -m pytest tests/test_models.py -v`
Expected: ALL PASS

- [ ] **Step 5: Run the full test suite to check for regressions**

Run: `cd backend && python -m pytest -v`
Expected: ALL PASS (existing tests should not break — `income` is additive to the enum, and `Setting` is a new table)

- [ ] **Step 6: Commit**

```bash
git add backend/models.py backend/tests/test_models.py
git commit -m "feat: add income CategoryType and Setting model"
```

---

### Task 2: Create `get_financial_month_range()` helper

**Files:**
- Create: `backend/financial_month.py`
- Create: `backend/tests/test_financial_month.py`

- [ ] **Step 1: Write failing tests for the financial month range helper**

Create `backend/tests/test_financial_month.py`:

```python
import pytest
from datetime import date


def test_mid_month_start_day():
    from financial_month import get_financial_month_range
    start, end = get_financial_month_range(2026, 4, 24)
    assert start == date(2026, 3, 24)
    assert end == date(2026, 4, 23)


def test_start_day_1_is_normal_calendar_month():
    from financial_month import get_financial_month_range
    start, end = get_financial_month_range(2026, 4, 1)
    assert start == date(2026, 4, 1)
    assert end == date(2026, 4, 30)


def test_start_day_28():
    from financial_month import get_financial_month_range
    start, end = get_financial_month_range(2026, 3, 28)
    assert start == date(2026, 2, 28)
    assert end == date(2026, 3, 27)


def test_year_rollover_january():
    from financial_month import get_financial_month_range
    start, end = get_financial_month_range(2026, 1, 24)
    assert start == date(2025, 12, 24)
    assert end == date(2026, 1, 23)


def test_year_rollover_december():
    from financial_month import get_financial_month_range
    start, end = get_financial_month_range(2026, 12, 24)
    assert start == date(2026, 11, 24)
    assert end == date(2026, 12, 23)


def test_february_start_day_15():
    from financial_month import get_financial_month_range
    start, end = get_financial_month_range(2026, 2, 15)
    assert start == date(2026, 1, 15)
    assert end == date(2026, 2, 14)


def test_invalid_start_day_0_raises():
    from financial_month import get_financial_month_range
    with pytest.raises(ValueError, match="start_day must be between 1 and 28"):
        get_financial_month_range(2026, 4, 0)


def test_invalid_start_day_29_raises():
    from financial_month import get_financial_month_range
    with pytest.raises(ValueError, match="start_day must be between 1 and 28"):
        get_financial_month_range(2026, 4, 29)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && python -m pytest tests/test_financial_month.py -v`
Expected: FAIL — `financial_month` module not found

- [ ] **Step 3: Implement `get_financial_month_range()`**

Create `backend/financial_month.py`:

```python
from datetime import date, timedelta


def get_financial_month_range(year: int, month: int, start_day: int) -> tuple[date, date]:
    """Convert a financial month label (year, month) + start_day into a date range.

    "April 2026" with start_day=24 means Mar 24 – Apr 23.
    When start_day=1, the range is the normal calendar month.

    Args:
        year: The label year (e.g. 2026).
        month: The label month (1-12).
        start_day: Day of month when the financial period begins (1-28).

    Returns:
        (start_date, end_date) inclusive on both ends.

    Raises:
        ValueError: If start_day is not between 1 and 28.
    """
    if not 1 <= start_day <= 28:
        raise ValueError("start_day must be between 1 and 28")

    if start_day == 1:
        # Normal calendar month: 1st to last day of month
        start_date = date(year, month, 1)
        # Last day = first day of next month minus one day
        if month == 12:
            end_date = date(year + 1, 1, 1) - timedelta(days=1)
        else:
            end_date = date(year, month + 1, 1) - timedelta(days=1)
        return start_date, end_date

    # Financial month: previous month's start_day to this month's (start_day - 1)
    # Start date is in the previous month
    if month == 1:
        prev_year, prev_month = year - 1, 12
    else:
        prev_year, prev_month = year, month - 1

    start_date = date(prev_year, prev_month, start_day)
    end_date = date(year, month, start_day - 1)
    return start_date, end_date
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && python -m pytest tests/test_financial_month.py -v`
Expected: ALL PASS

- [ ] **Step 5: Run the full test suite**

Run: `cd backend && python -m pytest -v`
Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add backend/financial_month.py backend/tests/test_financial_month.py
git commit -m "feat: add get_financial_month_range() helper"
```

---

## Chunk 2: Settings API + Seed Changes

### Task 3: Seed income categories and financial month start day setting

**Files:**
- Modify: `backend/seed.py`
- Modify: `backend/tests/test_seed.py`

- [ ] **Step 1: Write failing tests for income categories and setting seed**

Add to `backend/tests/test_seed.py`:

```python
def test_seed_creates_income_categories(db):
    run_seed(db)
    salary = db.query(Category).filter_by(name="Salary").first()
    assert salary is not None
    assert salary.type == CategoryType.income

    refunds = db.query(Category).filter_by(name="Refunds").first()
    assert refunds is not None
    assert refunds.type == CategoryType.income

    other = db.query(Category).filter_by(name="Other Income").first()
    assert other is not None
    assert other.type == CategoryType.income


def test_seed_income_categories_have_no_default_budget(db):
    run_seed(db)
    from models import Budget
    income_cats = db.query(Category).filter(Category.type == CategoryType.income).all()
    for cat in income_cats:
        budget = db.query(Budget).filter_by(category_id=cat.id, month=None).first()
        assert budget is None, f"Income category '{cat.name}' should not have a default budget"


def test_seed_creates_financial_month_setting(db):
    from models import Setting
    run_seed(db)
    setting = db.query(Setting).filter_by(key="financial_month_start_day").first()
    assert setting is not None
    assert setting.value == "24"
```

Also update the existing `test_seed_is_idempotent` test to expect 14 categories:

Replace in `backend/tests/test_seed.py`:

```python
def test_seed_is_idempotent(db):
    run_seed(db)
    run_seed(db)  # should not raise or duplicate
    cats = db.query(Category).all()
    assert len(cats) == 14  # 11 expense + 3 income
    defaults = db.query(Budget).filter_by(month=None).all()
    assert len(defaults) == 11  # income categories have no default budget
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && python -m pytest tests/test_seed.py -v`
Expected: FAIL — income categories not seeded, Setting not seeded, count mismatches

- [ ] **Step 3: Update seed.py to include income categories and setting**

Replace `backend/seed.py` with:

```python
from decimal import Decimal
from sqlalchemy.orm import Session
from models import Category, Budget, CategoryType, Setting

CATEGORIES = [
    ("Taxes & Mortgage",          CategoryType.needs,   1,  Decimal("2000")),
    ("Utilities",                 CategoryType.needs,   2,  Decimal("200")),
    ("Food - Essential",          CategoryType.needs,   3,  Decimal("350")),
    ("Transportation",            CategoryType.needs,   4,  Decimal("200")),
    ("Insurance",                 CategoryType.needs,   5,  Decimal("400")),
    ("Medical & Healthcare",      CategoryType.needs,   6,  Decimal("100")),
    ("Food - Not Essential",      CategoryType.wants,   7,  Decimal("200")),
    ("Recreation & Entertainment",CategoryType.wants,   8,  Decimal("100")),
    ("Miscellaneous",             CategoryType.wants,   9,  Decimal("300")),
    ("DEGIRO",                    CategoryType.savings, 10, Decimal("300")),
    ("Fun Account",               CategoryType.savings, 11, Decimal("100")),
]

INCOME_CATEGORIES = [
    ("Salary",       CategoryType.income, 12),
    ("Refunds",      CategoryType.income, 13),
    ("Other Income", CategoryType.income, 14),
]

SETTINGS = [
    ("financial_month_start_day", "24"),
]

def run_seed(db: Session) -> None:
    # Expense categories with default budgets
    for name, type_, order, default_amount in CATEGORIES:
        cat = db.query(Category).filter_by(name=name).first()
        if not cat:
            cat = Category(name=name, type=type_, sort_order=order)
            db.add(cat)
            db.flush()
        existing = db.query(Budget).filter_by(category_id=cat.id, month=None).first()
        if not existing:
            db.add(Budget(category_id=cat.id, month=None, planned_amount=default_amount))

    # Income categories (no budget)
    for name, type_, order in INCOME_CATEGORIES:
        cat = db.query(Category).filter_by(name=name).first()
        if not cat:
            db.add(Category(name=name, type=type_, sort_order=order))

    # Settings
    for key, value in SETTINGS:
        existing = db.query(Setting).filter_by(key=key).first()
        if not existing:
            db.add(Setting(key=key, value=value))

    db.commit()
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && python -m pytest tests/test_seed.py -v`
Expected: ALL PASS

- [ ] **Step 5: Run the full test suite**

Run: `cd backend && python -m pytest -v`
Expected: ALL PASS (the dashboard and budget test fixtures call `run_seed(db)` — seed changes are additive so existing tests remain valid)

- [ ] **Step 6: Commit**

```bash
git add backend/seed.py backend/tests/test_seed.py
git commit -m "feat: seed income categories and financial_month_start_day setting"
```

---

### Task 4: Settings API endpoints and schemas

**Files:**
- Modify: `backend/schemas.py`
- Create: `backend/routers/settings.py`
- Modify: `backend/main.py`
- Create: `backend/tests/test_settings.py`

- [ ] **Step 1: Write failing tests for settings API**

Create `backend/tests/test_settings.py`:

```python
import pytest
from fastapi.testclient import TestClient
from db import get_db
from main import app
from seed import run_seed


@pytest.fixture
def client(db):
    app.dependency_overrides[get_db] = lambda: db
    run_seed(db)
    yield TestClient(app)
    app.dependency_overrides.clear()


def test_get_settings_returns_dict(client):
    r = client.get("/settings")
    assert r.status_code == 200
    body = r.json()
    assert isinstance(body, dict)
    assert body["financial_month_start_day"] == "24"


def test_patch_setting_valid(client):
    r = client.patch("/settings/financial_month_start_day", json={"value": "15"})
    assert r.status_code == 200
    assert r.json()["value"] == "15"

    # Verify it persisted
    r2 = client.get("/settings")
    assert r2.json()["financial_month_start_day"] == "15"


def test_patch_setting_validates_start_day_range(client):
    r = client.patch("/settings/financial_month_start_day", json={"value": "0"})
    assert r.status_code == 422

    r = client.patch("/settings/financial_month_start_day", json={"value": "29"})
    assert r.status_code == 422

    r = client.patch("/settings/financial_month_start_day", json={"value": "abc"})
    assert r.status_code == 422


def test_patch_setting_boundary_values(client):
    r = client.patch("/settings/financial_month_start_day", json={"value": "1"})
    assert r.status_code == 200

    r = client.patch("/settings/financial_month_start_day", json={"value": "28"})
    assert r.status_code == 200


def test_patch_unknown_setting_returns_404(client):
    r = client.patch("/settings/nonexistent", json={"value": "x"})
    assert r.status_code == 404
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && python -m pytest tests/test_settings.py -v`
Expected: FAIL — router not found, 404 on all endpoints

- [ ] **Step 3: Add schemas**

Add to the end of `backend/schemas.py`:

```python
class SettingOut(BaseModel):
    key: str
    value: str

class SettingPatch(BaseModel):
    value: str
```

- [ ] **Step 4: Create settings router**

Create `backend/routers/settings.py`:

```python
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from db import get_db
from models import Setting
from schemas import SettingPatch

router = APIRouter(prefix="/settings", tags=["settings"])

# Per-key validation rules
VALIDATORS = {
    "financial_month_start_day": lambda v: v.isdigit() and 1 <= int(v) <= 28,
}


@router.get("")
def get_settings(db: Session = Depends(get_db)):
    settings = db.query(Setting).all()
    return {s.key: s.value for s in settings}


@router.patch("/{key}")
def patch_setting(key: str, body: SettingPatch, db: Session = Depends(get_db)):
    setting = db.query(Setting).filter_by(key=key).first()
    if not setting:
        raise HTTPException(status_code=404, detail=f"Setting '{key}' not found")

    validator = VALIDATORS.get(key)
    if validator and not validator(body.value):
        raise HTTPException(status_code=422, detail=f"Invalid value for '{key}'")

    setting.value = body.value
    db.commit()
    return {"key": setting.key, "value": setting.value}
```

- [ ] **Step 5: Register settings router in main.py**

Add the import and include to `backend/main.py`. After the existing imports:

```python
from routers.settings import router as settings_router
```

After the last `app.include_router(...)` line:

```python
app.include_router(settings_router)
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd backend && python -m pytest tests/test_settings.py -v`
Expected: ALL PASS

- [ ] **Step 7: Run the full test suite**

Run: `cd backend && python -m pytest -v`
Expected: ALL PASS

- [ ] **Step 8: Commit**

```bash
git add backend/schemas.py backend/routers/settings.py backend/main.py backend/tests/test_settings.py
git commit -m "feat: add settings API (GET/PATCH) with validation"
```

---

## Chunk 3: Sign-Aware Categorisation

### Task 5: Sign-aware rule matching

**Files:**
- Modify: `backend/categorizer/rules.py`
- Modify: `backend/tests/test_categorizer.py`

- [ ] **Step 1: Write failing tests for sign-aware rule matching**

Add to `backend/tests/test_categorizer.py`:

```python
def test_rule_skips_income_category_for_expense(db):
    """An expense transaction should NOT match a rule pointing to an income category."""
    income_cat = Category(name="Salary", type="income", sort_order=20)
    db.add(income_cat)
    db.flush()
    db.add(Rule(pattern="salaris", category_id=income_cat.id, priority=10))
    db.commit()

    result = apply_rules(make_tx("Salaris Maart"), db)
    assert result is None  # -10.00 should not match income category


def test_rule_matches_income_category_for_positive_amount(db):
    """A positive transaction should match a rule pointing to an income category."""
    income_cat = Category(name="Salary", type="income", sort_order=20)
    db.add(income_cat)
    db.flush()
    db.add(Rule(pattern="salaris", category_id=income_cat.id, priority=10))
    db.commit()

    tx = ParsedTransaction(
        date=date(2026, 3, 1), amount=Decimal("3400.00"),
        description="Salaris Maart", source="ing", import_hash="hash-pos-1",
    )
    result = apply_rules(tx, db)
    assert result is not None
    assert result.name == "Salary"


def test_rule_skips_expense_category_for_income(db):
    """A positive transaction should NOT match a rule pointing to an expense category."""
    expense_cat = Category(name="Food", type="needs", sort_order=1)
    db.add(expense_cat)
    db.flush()
    db.add(Rule(pattern="refund", category_id=expense_cat.id, priority=10))
    db.commit()

    tx = ParsedTransaction(
        date=date(2026, 3, 1), amount=Decimal("50.00"),
        description="Refund Albert Heijn", source="ing", import_hash="hash-pos-2",
    )
    result = apply_rules(tx, db)
    assert result is None


def test_rule_falls_through_to_next_on_sign_mismatch(db):
    """If first matching rule has wrong sign, fall through to next lower-priority rule."""
    income_cat = Category(name="Salary", type="income", sort_order=20)
    expense_cat = Category(name="Misc", type="wants", sort_order=9)
    db.add_all([income_cat, expense_cat])
    db.flush()
    # Higher priority: income category (wrong for expense)
    db.add(Rule(pattern="payment", category_id=income_cat.id, priority=10))
    # Lower priority: expense category (correct for expense)
    db.add(Rule(pattern="payment", category_id=expense_cat.id, priority=5))
    db.commit()

    tx = make_tx("Monthly payment")  # negative amount
    result = apply_rules(tx, db)
    assert result is not None
    assert result.name == "Misc"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && python -m pytest tests/test_categorizer.py::test_rule_skips_income_category_for_expense tests/test_categorizer.py::test_rule_matches_income_category_for_positive_amount tests/test_categorizer.py::test_rule_skips_expense_category_for_income tests/test_categorizer.py::test_rule_falls_through_to_next_on_sign_mismatch -v`
Expected: FAIL — current rules.py doesn't filter by sign

- [ ] **Step 3: Make rules engine sign-aware**

Replace `backend/categorizer/rules.py` with:

```python
from sqlalchemy.orm import Session
from models import Rule, Category


def _is_sign_compatible(amount, category: Category) -> bool:
    """Check if the transaction sign is compatible with the category type."""
    cat_type = category.type.value if hasattr(category.type, "value") else str(category.type)
    if amount > 0:
        return cat_type == "income"
    else:
        return cat_type in ("needs", "wants", "savings")


def apply_rules(transaction, db: Session) -> Category | None:
    rules = db.query(Rule).order_by(Rule.priority.desc()).all()
    desc_lower = transaction.description.lower()
    for rule in rules:
        if rule.pattern.lower() in desc_lower:
            if _is_sign_compatible(transaction.amount, rule.category):
                return rule.category
    return None
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && python -m pytest tests/test_categorizer.py -v`
Expected: ALL PASS

- [ ] **Step 5: Run the full test suite**

Run: `cd backend && python -m pytest -v`
Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add backend/categorizer/rules.py backend/tests/test_categorizer.py
git commit -m "feat: make rule engine sign-aware (income vs expense)"
```

---

### Task 6: Sign-aware AI categorisation

**Files:**
- Modify: `backend/categorizer/ai.py`
- Modify: `backend/tests/test_categorizer.py`

- [ ] **Step 1: Write failing tests for sign-aware AI categorisation**

Add to `backend/tests/test_categorizer.py`:

```python
def test_ai_categoriser_filters_categories_by_sign_expense(db):
    """AI prompt for expense transactions should only include expense categories."""
    expense_cat = Category(name="Food - Essential", type="needs", sort_order=1)
    income_cat = Category(name="Salary", type="income", sort_order=20)
    db.add_all([expense_cat, income_cat])
    db.commit()

    mock_response = MagicMock()
    mock_response.content = [MagicMock(text='[{"index": 0, "category": "Food - Essential", "confidence": 0.9}]')]

    with patch("categorizer.ai.anthropic.Anthropic") as MockClient:
        MockClient.return_value.messages.create.return_value = mock_response
        from categorizer.ai import batch_categorise_with_ai
        result = batch_categorise_with_ai([make_tx("Albert Heijn")], db)

    # Verify the prompt only contained expense categories
    call_args = MockClient.return_value.messages.create.call_args
    prompt = call_args.kwargs["messages"][0]["content"]
    assert "Food - Essential" in prompt
    assert "Salary" not in prompt


def test_ai_categoriser_filters_categories_by_sign_income(db):
    """AI prompt for income transactions should only include income categories."""
    expense_cat = Category(name="Food - Essential", type="needs", sort_order=1)
    income_cat = Category(name="Salary", type="income", sort_order=20)
    db.add_all([expense_cat, income_cat])
    db.commit()

    mock_response = MagicMock()
    mock_response.content = [MagicMock(text='[{"index": 0, "category": "Salary", "confidence": 0.95}]')]

    income_tx = ParsedTransaction(
        date=date(2026, 3, 1), amount=Decimal("3400.00"),
        description="Salaris Maart", source="ing", import_hash="hash-ai-income",
    )

    with patch("categorizer.ai.anthropic.Anthropic") as MockClient:
        MockClient.return_value.messages.create.return_value = mock_response
        from categorizer.ai import batch_categorise_with_ai
        result = batch_categorise_with_ai([income_tx], db)

    call_args = MockClient.return_value.messages.create.call_args
    prompt = call_args.kwargs["messages"][0]["content"]
    assert "Salary" in prompt
    assert "Food - Essential" not in prompt

    assert 0 in result
    assert result[0][0].name == "Salary"


def test_ai_categoriser_includes_sign_in_prompt(db):
    """AI prompt should include the sign/amount context for each transaction."""
    cat = Category(name="Food - Essential", type="needs", sort_order=1)
    db.add(cat)
    db.commit()

    mock_response = MagicMock()
    mock_response.content = [MagicMock(text='[{"index": 0, "category": "Food - Essential", "confidence": 0.9}]')]

    with patch("categorizer.ai.anthropic.Anthropic") as MockClient:
        MockClient.return_value.messages.create.return_value = mock_response
        from categorizer.ai import batch_categorise_with_ai
        batch_categorise_with_ai([make_tx("Albert Heijn")], db)

    call_args = MockClient.return_value.messages.create.call_args
    prompt = call_args.kwargs["messages"][0]["content"]
    # Verify the prompt includes sign context (e.g. "expense, €10.00")
    assert "expense" in prompt.lower()
    assert "€" in prompt
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && python -m pytest tests/test_categorizer.py::test_ai_categoriser_filters_categories_by_sign_expense tests/test_categorizer.py::test_ai_categoriser_filters_categories_by_sign_income tests/test_categorizer.py::test_ai_categoriser_includes_sign_in_prompt -v`
Expected: FAIL — current AI categoriser doesn't filter by sign

- [ ] **Step 3: Make AI categoriser sign-aware**

Replace `backend/categorizer/ai.py` with:

```python
import json
import re
import anthropic
from sqlalchemy.orm import Session
from models import Category

AI_MODEL = "claude-haiku-4-5-20251001"
BATCH_SIZE = 50  # Max transactions per AI call


def _strip_markdown_fences(text: str) -> str:
    """Strip markdown code fences (```json ... ``` or ``` ... ```) from LLM output."""
    stripped = re.sub(r"^```(?:json)?\s*\n?", "", text.strip())
    stripped = re.sub(r"\n?```\s*$", "", stripped)
    return stripped.strip()


def _get_categories_for_sign(categories: list[Category], amount) -> list[Category]:
    """Filter categories by transaction sign compatibility."""
    if amount > 0:
        return [c for c in categories
                if (c.type.value if hasattr(c.type, "value") else str(c.type)) == "income"]
    else:
        return [c for c in categories
                if (c.type.value if hasattr(c.type, "value") else str(c.type)) in ("needs", "wants", "savings")]


def categorise_with_ai(transaction, db: Session) -> tuple[Category, float] | None:
    """Categorise a single transaction with AI. Kept for backward compatibility."""
    results = batch_categorise_with_ai([transaction], db)
    return results.get(0)


def batch_categorise_with_ai(
    transactions: list, db: Session
) -> dict[int, tuple[Category, float]]:
    """Categorise multiple transactions in a single AI call (or batches of BATCH_SIZE).

    Transactions are grouped by sign (income vs expense) and each group gets
    only the relevant categories in the prompt.

    Returns a dict mapping transaction index -> (Category, confidence).
    Missing indices mean categorisation failed for that transaction.
    """
    if not transactions:
        return {}

    all_categories = db.query(Category).all()
    cat_by_name = {c.name: c for c in all_categories}

    try:
        client = anthropic.Anthropic()
    except TypeError as e:
        print(f"[AI categoriser] Configuration error: {e}")
        return {}

    results: dict[int, tuple[Category, float]] = {}

    # Group by sign: positive (income) and negative (expense)
    income_txs = [(i, tx) for i, tx in enumerate(transactions) if tx.amount > 0]
    expense_txs = [(i, tx) for i, tx in enumerate(transactions) if tx.amount <= 0]

    for group, group_label in [(income_txs, "income"), (expense_txs, "expense")]:
        if not group:
            continue

        # Get categories appropriate for this sign
        sample_amount = group[0][1].amount
        filtered_cats = _get_categories_for_sign(all_categories, sample_amount)
        if not filtered_cats:
            continue
        category_names = [c.name for c in filtered_cats]

        for batch_start in range(0, len(group), BATCH_SIZE):
            batch = group[batch_start: batch_start + BATCH_SIZE]
            tx_lines = []
            for _, (global_idx, tx) in enumerate(batch):
                sign_label = "income" if tx.amount > 0 else "expense"
                tx_lines.append(f'{global_idx}: "{tx.description}" ({sign_label}, €{abs(tx.amount):.2f})')

            prompt = (
                f"Categorise each {group_label} transaction below into one of the available categories.\n"
                f"Available categories: {', '.join(category_names)}\n\n"
                "Transactions:\n" + "\n".join(tx_lines) + "\n\n"
                "Respond with a JSON array only. Each element: "
                '{"index": <number>, "category": "<name>", "confidence": <0.0-1.0>}'
            )
            try:
                response = client.messages.create(
                    model=AI_MODEL,
                    max_tokens=4096,
                    system="You are a financial transaction categoriser. Respond with JSON only.",
                    messages=[{"role": "user", "content": prompt}],
                )
                raw_text = response.content[0].text
                cleaned = _strip_markdown_fences(raw_text)
                items = json.loads(cleaned)
                if not isinstance(items, list):
                    print("[AI categoriser] Expected JSON array, got:", type(items).__name__)
                    continue
                for item in items:
                    idx = int(item["index"])
                    cat = cat_by_name.get(item["category"])
                    if cat is None:
                        continue
                    confidence = float(item["confidence"])
                    if not (0.0 <= confidence <= 1.0):
                        continue
                    results[idx] = (cat, confidence)
            except anthropic.APIError as e:
                print(f"[AI categoriser] Anthropic API error: {e}")
            except (json.JSONDecodeError, KeyError, ValueError) as e:
                print(f"[AI categoriser] Parse error: {e}")
            except TypeError as e:
                print(f"[AI categoriser] Configuration error: {e}")

    return results
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && python -m pytest tests/test_categorizer.py -v`
Expected: ALL PASS

- [ ] **Step 5: Run the full test suite**

Run: `cd backend && python -m pytest -v`
Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add backend/categorizer/ai.py backend/tests/test_categorizer.py
git commit -m "feat: make AI categoriser sign-aware with filtered categories"
```

---

## Chunk 4: Dashboard + Budget with Financial Month

### Task 7: Dashboard uses financial month range and returns income_breakdown

**Files:**
- Modify: `backend/routers/dashboard.py`
- Modify: `backend/schemas.py`
- Modify: `backend/tests/test_dashboard.py`

- [ ] **Step 1: Write failing tests for dashboard with financial month + income_breakdown**

Replace `backend/tests/test_dashboard.py` with:

```python
import pytest
from fastapi.testclient import TestClient
from decimal import Decimal
from datetime import date
from db import get_db
from main import app
from seed import run_seed
from models import Transaction, Category, Setting


@pytest.fixture
def client(db):
    app.dependency_overrides[get_db] = lambda: db
    run_seed(db)

    cat = db.query(Category).filter_by(name="Food - Essential").first()
    salary_cat = db.query(Category).filter_by(name="Salary").first()

    # Transaction on Mar 25 — inside "April 2026" financial month (start_day=24: Mar 24 – Apr 23)
    db.add(Transaction(
        date=date(2026, 3, 25), amount=Decimal("-67.40"),
        description="Albert Heijn", source="ing",
        category_id=cat.id, confirmed=True, categorised_by="rule",
        import_hash="hash-test-1",
    ))
    # Income on Mar 24 — also inside "April 2026" financial month
    db.add(Transaction(
        date=date(2026, 3, 24), amount=Decimal("3460.26"),
        description="Salaris", source="ing",
        category_id=salary_cat.id, confirmed=True, categorised_by="rule",
        import_hash="hash-test-2",
    ))
    # Transaction on Mar 23 — inside "March 2026" (Feb 24 – Mar 23), NOT April
    db.add(Transaction(
        date=date(2026, 3, 23), amount=Decimal("-20.00"),
        description="Bol.com", source="revolut",
        category_id=cat.id, confirmed=True, categorised_by="rule",
        import_hash="hash-test-3",
    ))
    db.commit()
    yield TestClient(app)
    app.dependency_overrides.clear()


def test_dashboard_uses_financial_month(client):
    """April 2026 with start_day=24 should include Mar 24–Apr 23 transactions."""
    r = client.get("/dashboard/summary?month=2026-04")
    assert r.status_code == 200
    body = r.json()
    # Mar 25 expense and Mar 24 income are in April financial month
    assert float(body["total_income"]) == 3460.26
    assert float(body["total_expenses"]) == 67.40


def test_dashboard_excludes_out_of_range(client):
    """Mar 23 transaction should NOT appear in April 2026 (start_day=24)."""
    r = client.get("/dashboard/summary?month=2026-04")
    body = r.json()
    # Only 67.40 expense, NOT 67.40 + 20.00
    assert float(body["total_expenses"]) == 67.40


def test_dashboard_income_breakdown(client):
    """Dashboard should include income_breakdown with categorised income."""
    r = client.get("/dashboard/summary?month=2026-04")
    body = r.json()
    assert "income_breakdown" in body
    assert len(body["income_breakdown"]) == 1
    assert body["income_breakdown"][0]["category_name"] == "Salary"
    assert float(body["income_breakdown"][0]["amount"]) == 3460.26


def test_dashboard_category_breakdown_excludes_income(client):
    """category_breakdown should only include expense categories."""
    r = client.get("/dashboard/summary?month=2026-04")
    body = r.json()
    for item in body["category_breakdown"]:
        assert item["type"] != "income"


def test_dashboard_monthly_trend_uses_financial_months(client):
    r = client.get("/dashboard/summary?month=2026-04")
    body = r.json()
    assert "monthly_trend" in body
    assert len(body["monthly_trend"]) == 6
    # The current month in trend should be "2026-04"
    assert body["monthly_trend"][-1]["month"] == "2026-04"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && python -m pytest tests/test_dashboard.py -v`
Expected: FAIL — dashboard doesn't use financial month ranges, no `income_breakdown`

- [ ] **Step 3: Add `income_breakdown` to `DashboardSummary` schema**

In `backend/schemas.py`, update the `DashboardSummary` class:

```python
class DashboardSummary(BaseModel):
    month: str
    total_income: Decimal
    total_expenses: Decimal
    total_savings: Decimal
    left_over: Decimal
    category_breakdown: list[dict]
    income_breakdown: list[dict]
    needs_wants_savings: dict
    monthly_trend: list[dict]
```

- [ ] **Step 4: Rewrite dashboard router with financial month + income_breakdown**

Replace `backend/routers/dashboard.py` with:

```python
from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func
from decimal import Decimal
from datetime import date
from db import get_db
from models import Transaction, Budget, Category, Setting
from financial_month import get_financial_month_range

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


def _get_start_day(db: Session) -> int:
    setting = db.query(Setting).filter_by(key="financial_month_start_day").first()
    return int(setting.value) if setting else 24


@router.get("/summary")
def summary(month: str = Query(...), db: Session = Depends(get_db)):
    try:
        from datetime import datetime
        parsed = datetime.strptime(month, "%Y-%m")
        year, mo = parsed.year, parsed.month
    except ValueError:
        raise HTTPException(status_code=422, detail="month must be in YYYY-MM format")

    start_day = _get_start_day(db)
    start_date, end_date = get_financial_month_range(year, mo, start_day)

    txs = db.query(Transaction).filter(
        Transaction.date >= start_date,
        Transaction.date <= end_date,
        Transaction.confirmed == True,
    ).all()

    total_income = sum(t.amount for t in txs if t.amount > 0)
    total_expenses = abs(sum(t.amount for t in txs if t.amount < 0))

    cats = db.query(Category).all()
    cat_map = {c.id: c for c in cats}

    # Budget rows keyed by label month (1st of month)
    budgets = {b.category_id: b.planned_amount
               for b in db.query(Budget).filter(Budget.month == date(year, mo, 1)).all()}

    # Expense breakdown (needs/wants/savings only)
    expense_breakdown = {}
    for t in txs:
        if t.category_id and t.amount < 0:
            cat = cat_map.get(t.category_id)
            if cat:
                cat_type = cat.type.value if hasattr(cat.type, "value") else str(cat.type)
                if cat_type in ("needs", "wants", "savings"):
                    cid = t.category_id
                    expense_breakdown[cid] = expense_breakdown.get(cid, Decimal("0")) + abs(t.amount)

    category_breakdown = [
        {"category_id": cid, "category_name": cat_map[cid].name,
         "actual": float(actual), "planned": float(budgets.get(cid, Decimal("0"))),
         "type": cat_map[cid].type.value if hasattr(cat_map[cid].type, "value") else str(cat_map[cid].type)}
        for cid, actual in expense_breakdown.items() if cid in cat_map
    ]

    # Income breakdown
    income_breakdown_map = {}
    for t in txs:
        if t.category_id and t.amount > 0:
            cat = cat_map.get(t.category_id)
            if cat:
                cat_type = cat.type.value if hasattr(cat.type, "value") else str(cat.type)
                if cat_type == "income":
                    cid = t.category_id
                    income_breakdown_map[cid] = income_breakdown_map.get(cid, Decimal("0")) + t.amount

    income_breakdown = [
        {"category_id": cid, "category_name": cat_map[cid].name, "amount": float(amount)}
        for cid, amount in income_breakdown_map.items() if cid in cat_map
    ]

    savings_cats = {c.id for c in cats
                    if (c.type.value if hasattr(c.type, "value") else str(c.type)) == "savings"}
    total_savings = sum(
        abs(t.amount) for t in txs if t.category_id in savings_cats and t.amount < 0
    )
    needs_total = sum(d["actual"] for d in category_breakdown if d["type"] == "needs")
    wants_total = sum(d["actual"] for d in category_breakdown if d["type"] == "wants")

    # Last 6 months trend using financial month ranges
    trend = []
    for i in range(5, -1, -1):
        m = mo - i
        y = year
        while m <= 0:
            m += 12
            y -= 1
        trend_start, trend_end = get_financial_month_range(y, m, start_day)
        month_txs = db.query(Transaction).filter(
            Transaction.date >= trend_start,
            Transaction.date <= trend_end,
            Transaction.confirmed == True,
            Transaction.amount < 0,
        ).all()
        trend.append({
            "month": f"{y}-{m:02d}",
            "total": float(abs(sum(t.amount for t in month_txs))),
        })

    return {
        "month": month,
        "total_income": float(total_income),
        "total_expenses": float(total_expenses),
        "total_savings": float(total_savings),
        "left_over": float(total_income - total_expenses),
        "category_breakdown": category_breakdown,
        "income_breakdown": income_breakdown,
        "needs_wants_savings": {
            "needs": float(needs_total),
            "wants": float(wants_total),
            "savings": float(total_savings),
        },
        "monthly_trend": trend,
    }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd backend && python -m pytest tests/test_dashboard.py -v`
Expected: ALL PASS

- [ ] **Step 6: Run the full test suite**

Run: `cd backend && python -m pytest -v`
Expected: ALL PASS

- [ ] **Step 7: Commit**

```bash
git add backend/routers/dashboard.py backend/schemas.py backend/tests/test_dashboard.py
git commit -m "feat: dashboard uses financial month ranges and returns income_breakdown"
```

---

### Task 8: Budget uses financial month range and excludes income categories

**Files:**
- Modify: `backend/routers/budget.py`
- Modify: `backend/tests/test_budget.py`

- [ ] **Step 1: Write failing tests for budget with financial month + income exclusion**

Replace `backend/tests/test_budget.py` with:

```python
import pytest
from fastapi.testclient import TestClient
from decimal import Decimal
from datetime import date
from db import get_db
from main import app
from seed import run_seed
from models import Transaction, Category, CategoryType

@pytest.fixture
def client(db):
    app.dependency_overrides[get_db] = lambda: db
    run_seed(db)
    yield TestClient(app)
    app.dependency_overrides.clear()


def test_budget_autopopulates_from_defaults(client):
    r = client.get("/budget?month=2026-04")
    assert r.status_code == 200
    rows = r.json()
    assert len(rows) > 0
    names = [r["category_name"] for r in rows]
    assert "Food - Essential" in names


def test_budget_excludes_income_categories(client, db):
    """Income categories should not appear in budget rows."""
    r = client.get("/budget?month=2026-04")
    rows = r.json()
    names = [r["category_name"] for r in rows]
    assert "Salary" not in names
    assert "Refunds" not in names
    assert "Other Income" not in names


def test_budget_actual_uses_financial_month(client, db):
    """Actual spend should use financial month date range, not calendar month."""
    cat = db.query(Category).filter_by(name="Food - Essential").first()
    # Mar 25 is inside "April 2026" financial month (start_day=24: Mar 24–Apr 23)
    db.add(Transaction(
        date=date(2026, 3, 25), amount=Decimal("-100.00"),
        description="Albert Heijn", source="ing",
        category_id=cat.id, confirmed=True, categorised_by="rule",
        import_hash="hash-budget-1",
    ))
    # Mar 23 is inside "March 2026" financial month (Feb 24–Mar 23), NOT April
    db.add(Transaction(
        date=date(2026, 3, 23), amount=Decimal("-50.00"),
        description="Lidl", source="ing",
        category_id=cat.id, confirmed=True, categorised_by="rule",
        import_hash="hash-budget-2",
    ))
    db.commit()

    r = client.get("/budget?month=2026-04")
    rows = r.json()
    food_row = next(r for r in rows if r["category_name"] == "Food - Essential")
    # Only Mar 25 transaction should count for April budget
    assert float(food_row["actual_amount"]) == 100.00


def test_budget_patch_updates_amount(client, db):
    r = client.get("/budget?month=2026-04")
    row = r.json()[0]
    new_amount = float(row["planned_amount"]) + 100
    r2 = client.patch(f"/budget/{row['id']}", json={"planned_amount": new_amount})
    assert r2.status_code == 200
    assert float(r2.json()["planned_amount"]) == new_amount
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && python -m pytest tests/test_budget.py -v`
Expected: FAIL — budget doesn't use financial month, income categories may appear

- [ ] **Step 3: Rewrite budget router with financial month + income exclusion**

Replace `backend/routers/budget.py` with:

```python
from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy.orm import Session
from datetime import date, datetime
from decimal import Decimal
from db import get_db
from models import Budget, Category, Transaction, Setting
from schemas import BudgetPatch
from sqlalchemy import func
from financial_month import get_financial_month_range

router = APIRouter(prefix="/budget", tags=["budget"])


def _get_start_day(db: Session) -> int:
    setting = db.query(Setting).filter_by(key="financial_month_start_day").first()
    return int(setting.value) if setting else 24


def _auto_populate(month_date: date, db: Session):
    """Create budget rows for month from defaults if they don't exist.
    Skips income categories — they have no budget."""
    defaults = db.query(Budget).filter(Budget.month == None).all()
    for d in defaults:
        cat = db.get(Category, d.category_id)
        cat_type = cat.type.value if hasattr(cat.type, "value") else str(cat.type)
        if cat_type == "income":
            continue
        exists = db.query(Budget).filter_by(category_id=d.category_id, month=month_date).first()
        if not exists:
            db.add(Budget(category_id=d.category_id, month=month_date, planned_amount=d.planned_amount))
    db.commit()


@router.get("")
def get_budget(month: str = Query(...), db: Session = Depends(get_db)):
    try:
        parsed = datetime.strptime(month, "%Y-%m")
        year, mo = parsed.year, parsed.month
    except ValueError:
        raise HTTPException(status_code=422, detail="month must be in YYYY-MM format")

    month_date = date(year, mo, 1)
    _auto_populate(month_date, db)

    start_day = _get_start_day(db)
    start_date, end_date = get_financial_month_range(year, mo, start_day)

    # Actual spend for the financial month (expenses only, exclude income categories)
    income_cat_ids = {c.id for c in db.query(Category).all()
                      if (c.type.value if hasattr(c.type, "value") else str(c.type)) == "income"}

    actual_spend_rows = db.query(
        Transaction.category_id,
        func.sum(Transaction.amount).label("total")
    ).filter(
        Transaction.date >= start_date,
        Transaction.date <= end_date,
        Transaction.confirmed == True,
        Transaction.amount < 0,
    )
    if income_cat_ids:
        actual_spend_rows = actual_spend_rows.filter(
            ~Transaction.category_id.in_(income_cat_ids)
        )
    actual_spend_rows = actual_spend_rows.group_by(Transaction.category_id).all()

    actual_by_cat = {row.category_id: abs(row.total) for row in actual_spend_rows}

    rows = db.query(Budget).filter(Budget.month == month_date).all()
    result = []
    for row in rows:
        actual = actual_by_cat.get(row.category_id, Decimal("0"))
        result.append({
            "id": row.id,
            "category_id": row.category_id,
            "category_name": row.category.name,
            "month": row.month,
            "planned_amount": row.planned_amount,
            "actual_amount": actual,
        })
    return result


@router.patch("/defaults/{category_id}")
def patch_default(category_id: int, body: BudgetPatch, db: Session = Depends(get_db)):
    row = db.query(Budget).filter_by(category_id=category_id, month=None).first()
    if not row:
        raise HTTPException(404)
    row.planned_amount = body.planned_amount
    db.commit()
    return {"category_id": category_id, "planned_amount": row.planned_amount}


@router.patch("/{budget_id}")
def patch_budget(budget_id: int, body: BudgetPatch, db: Session = Depends(get_db)):
    row = db.get(Budget, budget_id)
    if not row:
        raise HTTPException(404)
    row.planned_amount = body.planned_amount
    db.commit()
    db.refresh(row)
    return {"id": row.id, "planned_amount": row.planned_amount,
            "category_name": row.category.name, "month": row.month}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && python -m pytest tests/test_budget.py -v`
Expected: ALL PASS

- [ ] **Step 5: Run the full test suite**

Run: `cd backend && python -m pytest -v`
Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add backend/routers/budget.py backend/tests/test_budget.py
git commit -m "feat: budget uses financial month ranges and excludes income categories"
```

---

## Chunk 5: Transactions + Create-Rule with Financial Month + Sign Awareness

### Task 9: Transactions list uses financial month range

**Files:**
- Modify: `backend/routers/transactions.py`
- Modify: `backend/tests/test_transactions.py`

- [ ] **Step 1: Write failing tests for financial month filtering**

Add to `backend/tests/test_transactions.py`:

```python
def test_filter_by_financial_month(client, db):
    """Transactions should filter by financial month, not calendar month."""
    from models import Setting
    # Default start_day=24 from seed. Our fixture transactions are dated Mar 1 and Mar 2.
    # "March 2026" financial month = Feb 24 – Mar 23. Both should be included.
    r = client.get("/transactions?month=2026-03")
    items = r.json()
    assert len(items) == 2

    # "April 2026" financial month = Mar 24 – Apr 23. Neither should be included.
    r2 = client.get("/transactions?month=2026-04")
    items2 = r2.json()
    assert len(items2) == 0
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && python -m pytest tests/test_transactions.py::test_filter_by_financial_month -v`
Expected: FAIL — current code uses extract(year/month), not financial month range

- [ ] **Step 3: Update transactions router to use financial month range**

In `backend/routers/transactions.py`, add imports and update the `list_transactions` function:

Replace the entire file with:

```python
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from datetime import date, datetime
from typing import Optional
from db import get_db
from models import Transaction, Category, Rule, Setting
from schemas import TransactionPatch
from financial_month import get_financial_month_range

router = APIRouter(prefix="/transactions", tags=["transactions"])


def _get_start_day(db: Session) -> int:
    setting = db.query(Setting).filter_by(key="financial_month_start_day").first()
    return int(setting.value) if setting else 24


def _to_out(tx: Transaction) -> dict:
    return {
        "id": tx.id, "date": tx.date, "amount": tx.amount,
        "description": tx.description, "source": tx.source,
        "category_id": tx.category_id,
        "category_name": tx.category.name if tx.category else None,
        "confirmed": tx.confirmed,
        "categorised_by": tx.categorised_by,
        "ai_confidence": tx.ai_confidence,
    }


@router.get("")
def list_transactions(
    month: Optional[str] = None,
    category_id: Optional[int] = None,
    source: Optional[str] = None,
    confirmed: Optional[bool] = None,
    db: Session = Depends(get_db),
):
    q = db.query(Transaction)
    if month:
        try:
            parsed = datetime.strptime(month, "%Y-%m")
            year, mo = parsed.year, parsed.month
        except ValueError:
            raise HTTPException(status_code=422, detail="month must be in YYYY-MM format")
        start_day = _get_start_day(db)
        start_date, end_date = get_financial_month_range(year, mo, start_day)
        q = q.filter(Transaction.date >= start_date, Transaction.date <= end_date)
    if category_id is not None:
        q = q.filter(Transaction.category_id == category_id)
    if source:
        q = q.filter(Transaction.source == source)
    if confirmed is not None:
        q = q.filter(Transaction.confirmed == confirmed)
    # Unconfirmed first
    q = q.order_by(Transaction.confirmed.asc(), Transaction.date.desc())
    return [_to_out(tx) for tx in q.all()]


@router.get("/review")
def next_review(db: Session = Depends(get_db)):
    tx = db.query(Transaction).filter(Transaction.confirmed == False).order_by(Transaction.date.asc()).first()
    if not tx:
        return None
    return _to_out(tx)


@router.patch("/{tx_id}")
def patch_transaction(tx_id: int, body: TransactionPatch, db: Session = Depends(get_db)):
    tx = db.get(Transaction, tx_id)
    if not tx:
        raise HTTPException(404)
    if body.category_id is not None:
        tx.category_id = body.category_id
        if tx.categorised_by == "ai":
            tx.categorised_by = "manual"
    if body.confirmed is not None:
        tx.confirmed = body.confirmed
    db.commit()
    db.refresh(tx)
    return _to_out(tx)


@router.post("/{tx_id}/create-rule")
def create_rule_from_transaction(tx_id: int, db: Session = Depends(get_db)):
    """Create a rule from this transaction's description, confirm current tx,
    and retroactively confirm all matching unconfirmed transactions
    whose sign is compatible with the rule's target category."""
    tx = db.get(Transaction, tx_id)
    if not tx or not tx.category_id:
        raise HTTPException(400, "Transaction must have a category before creating a rule")

    category = db.get(Category, tx.category_id)
    cat_type = category.type.value if hasattr(category.type, "value") else str(category.type)

    pattern = tx.description.lower().strip()
    existing_rule = db.query(Rule).filter_by(pattern=pattern).first()
    if not existing_rule:
        rule = Rule(pattern=pattern, category_id=tx.category_id, priority=0)
        db.add(rule)

    # Retroactively confirm matching unconfirmed transactions (sign-aware)
    unconfirmed = db.query(Transaction).filter(Transaction.confirmed == False).all()
    updated = 0
    for t in unconfirmed:
        if pattern in t.description.lower():
            # Check sign compatibility
            if t.amount > 0 and cat_type != "income":
                continue
            if t.amount <= 0 and cat_type == "income":
                continue
            t.confirmed = True
            t.category_id = tx.category_id
            t.categorised_by = "rule"
            updated += 1
    db.commit()
    return {"rule_created": pattern, "transactions_updated": updated}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && python -m pytest tests/test_transactions.py -v`
Expected: ALL PASS

- [ ] **Step 5: Run the full test suite**

Run: `cd backend && python -m pytest -v`
Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add backend/routers/transactions.py backend/tests/test_transactions.py
git commit -m "feat: transactions use financial month range and sign-aware create-rule"
```

---

### Task 10: Sign-aware create-rule tests

**Files:**
- Modify: `backend/tests/test_transactions.py`

- [ ] **Step 1: Write tests for sign-aware create-rule retroactive matching**

Add to `backend/tests/test_transactions.py`:

```python
def test_create_rule_sign_aware_skips_incompatible(client, db):
    """Create-rule from an expense tx should not retroactively assign to income transactions."""
    from models import Transaction, Category
    from decimal import Decimal
    from datetime import date as dt_date

    income_tx = Transaction(
        date=dt_date(2026, 3, 3), amount=Decimal("100.00"),
        description="Albert Heijn Refund", source="ing",
        confirmed=False, import_hash="hash-sign-1",
    )
    db.add(income_tx)
    db.commit()

    # hash1 is the expense "Albert Heijn" from fixture — confirm it and create rule
    expense_tx = db.query(Transaction).filter_by(import_hash="hash1").first()
    # Ensure it has a category (from fixture)
    r = client.post(f"/transactions/{expense_tx.id}/create-rule")
    assert r.status_code == 200

    # The income tx with "Albert Heijn Refund" should NOT be retroactively assigned
    db.refresh(income_tx)
    assert income_tx.confirmed is False
```

- [ ] **Step 2: Run test to verify it passes**

Run: `cd backend && python -m pytest tests/test_transactions.py::test_create_rule_sign_aware_skips_incompatible -v`
Expected: PASS (the implementation from Task 9 already handles this)

- [ ] **Step 3: Run the full test suite**

Run: `cd backend && python -m pytest -v`
Expected: ALL PASS

- [ ] **Step 4: Commit**

```bash
git add backend/tests/test_transactions.py
git commit -m "test: add sign-aware create-rule test"
```

---

## Chunk 6: Frontend Changes

### Task 11: Frontend types and API for settings + income_breakdown

**Files:**
- Modify: `frontend/src/types.ts`
- Modify: `frontend/src/api.ts`

- [ ] **Step 1: Update TypeScript types**

In `frontend/src/types.ts`, add `income_breakdown` to `DashboardSummary` and add a `Setting` type:

Add to end of `DashboardSummary` interface (before the closing `}`):

```typescript
  income_breakdown: Array<{
    category_id: number
    category_name: string
    amount: number
  }>
```

Add after the `DashboardSummary` interface:

```typescript
export interface SettingsMap {
  [key: string]: string
}
```

- [ ] **Step 2: Add settings API methods**

In `frontend/src/api.ts`, add these methods inside the `api` object (after the last method, before the closing `}`):

```typescript
  getSettings: (): Promise<import('./types').SettingsMap> =>
    fetch(`${BASE}/settings`).then(r => r.json()),

  patchSetting: (key: string, value: string) =>
    fetch(`${BASE}/settings/${key}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value }),
    }).then(r => r.json()),
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/types.ts frontend/src/api.ts
git commit -m "feat: add settings API methods and income_breakdown type"
```

---

### Task 12: Settings page

**Files:**
- Create: `frontend/src/pages/Settings.tsx`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/components/Nav.tsx`

- [ ] **Step 1: Create Settings page**

Create `frontend/src/pages/Settings.tsx`:

```tsx
import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../api'

export default function Settings() {
  const queryClient = useQueryClient()
  const { data: settings, isLoading } = useQuery({
    queryKey: ['settings'],
    queryFn: api.getSettings,
  })

  const [startDay, setStartDay] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (settings?.financial_month_start_day) {
      setStartDay(settings.financial_month_start_day)
    }
  }, [settings])

  const mutation = useMutation({
    mutationFn: (value: string) => api.patchSetting('financial_month_start_day', value),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      queryClient.invalidateQueries({ queryKey: ['budget'] })
      queryClient.invalidateQueries({ queryKey: ['transactions'] })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    },
  })

  const handleSave = () => {
    const num = parseInt(startDay, 10)
    if (isNaN(num) || num < 1 || num > 28) return
    mutation.mutate(startDay)
  }

  // Compute example period for current month
  const now = new Date()
  const dayNum = parseInt(startDay, 10)
  let exampleText = ''
  if (!isNaN(dayNum) && dayNum >= 1 && dayNum <= 28) {
    if (dayNum === 1) {
      exampleText = `${now.toLocaleString('en', { month: 'short' })} 1 – ${now.toLocaleString('en', { month: 'short' })} ${new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()}`
    } else {
      const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, dayNum)
      const endDay = dayNum - 1
      exampleText = `${prevMonth.toLocaleString('en', { month: 'short' })} ${dayNum} – ${now.toLocaleString('en', { month: 'short' })} ${endDay}`
    }
  }

  if (isLoading) return (
    <div style={{ color: 'var(--text-secondary)', padding: 40, textAlign: 'center' }}>
      Loading settings...
    </div>
  )

  return (
    <div className="animate-fade-in">
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ marginBottom: 4 }}>Settings</h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: 13 }}>Configure your financial preferences</p>
      </div>

      <div style={{
        background: 'var(--bg-card)',
        borderRadius: 'var(--radius-lg)',
        padding: '24px 28px',
        border: '1px solid var(--border)',
        boxShadow: '0 4px 32px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.035)',
        maxWidth: 520,
      }}>
        <h3 style={{
          fontSize: 14, fontWeight: 700, color: 'var(--text-h)',
          letterSpacing: '-0.02em', marginBottom: 4,
        }}>Financial Month Start Day</h3>
        <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 18 }}>
          The day of the month your salary arrives. This defines the start of each financial period.
        </p>

        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 14 }}>
          <input
            type="number"
            min={1}
            max={28}
            value={startDay}
            onChange={e => setStartDay(e.target.value)}
            style={{
              background: 'var(--bg-input)', color: 'var(--text-h)',
              border: '1px solid var(--border-strong)',
              borderRadius: 'var(--radius)',
              padding: '9px 14px',
              fontSize: 14, fontFamily: 'var(--sans)',
              width: 80, textAlign: 'center',
            }}
          />
          <button
            onClick={handleSave}
            disabled={mutation.isPending}
            style={{
              background: 'linear-gradient(135deg, #4f46e5, #6366f1)',
              color: '#fff', border: 'none',
              borderRadius: 'var(--radius)',
              padding: '9px 20px',
              cursor: 'pointer', fontWeight: 600, fontSize: 13,
              fontFamily: 'var(--sans)',
              opacity: mutation.isPending ? 0.6 : 1,
            }}
          >
            {mutation.isPending ? 'Saving...' : 'Save'}
          </button>
          {saved && (
            <span style={{ fontSize: 12, color: 'var(--green)', fontWeight: 500 }}>
              Saved
            </span>
          )}
        </div>

        {exampleText && (
          <div style={{
            fontSize: 12, color: 'var(--text-muted)',
            background: 'var(--bg-input)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-sm)',
            padding: '8px 12px',
          }}>
            Example period for {now.toLocaleString('en', { month: 'long', year: 'numeric' })}: <strong style={{ color: 'var(--text-secondary)' }}>{exampleText}</strong>
          </div>
        )}

        <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 12 }}>
          Value must be between 1 and 28. Changing this will retroactively redefine all financial periods.
        </p>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Add Settings route to App.tsx**

In `frontend/src/App.tsx`, add the import after the existing page imports:

```typescript
import Settings from './pages/Settings'
```

Add the route inside `<Routes>`, after the rules route:

```tsx
<Route path="/settings" element={<Settings />} />
```

- [ ] **Step 3: Add Settings link to Nav**

In `frontend/src/components/Nav.tsx`, add to the `links` array (after the Rules entry):

```typescript
  {
    to: '/settings', label: 'Settings',
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
      </svg>
    ),
  },
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/Settings.tsx frontend/src/App.tsx frontend/src/components/Nav.tsx
git commit -m "feat: add Settings page with financial month start day config"
```

---

### Task 13: Dashboard shows financial period dates and income breakdown

**Files:**
- Modify: `frontend/src/pages/Dashboard.tsx`
- Modify: `frontend/src/components/SummaryCards.tsx`

- [ ] **Step 1: Update SummaryCards to accept income_breakdown**

Replace `frontend/src/components/SummaryCards.tsx` Props interface and the export:

At the top of the file, replace the `Props` interface:

```typescript
interface Props {
  total_income: number
  total_expenses: number
  total_savings: number
  left_over: number
  income_breakdown?: Array<{ category_id: number; category_name: string; amount: number }>
}
```

Replace the export default function signature and the Income Card to show sub-totals:

```typescript
export default function SummaryCards({ total_income, total_expenses, total_savings, left_over, income_breakdown }: Props) {
```

Replace the first `<Card` (Income card) with:

```tsx
      <Card
        label="Income"
        value={fmt(total_income)}
        subtext={income_breakdown && income_breakdown.length > 0
          ? income_breakdown.map(b => `${b.category_name}: €${b.amount.toLocaleString('nl-NL', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`).join(' | ')
          : undefined}
        gradient="linear-gradient(135deg, #22c55e, #16a34a)"
        glowColor="rgba(34, 197, 94, 0.3)"
        borderColor="rgba(34, 197, 94, 0.22)"
        icon={
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/>
          </svg>
        }
      />
```

- [ ] **Step 2: Update Dashboard to pass income_breakdown and show financial period**

In `frontend/src/pages/Dashboard.tsx`, update the SummaryCards call and add a period subtitle.

Add settings query at the top of the `Dashboard` component (after `const [month, setMonth]`):

```typescript
  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: api.getSettings,
  })
```

After the month picker `<input>`, add a financial period subtitle. Inside the header `<div>` that contains `<h1>Dashboard</h1>`, replace the `<p>` subtitle:

```tsx
          <p style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
            {(() => {
              const startDay = settings?.financial_month_start_day ? parseInt(settings.financial_month_start_day) : 24
              const [y, m] = month.split('-').map(Number)
              if (startDay === 1) {
                return `${new Date(y, m - 1, 1).toLocaleDateString('en-GB', { month: 'short', day: 'numeric' })} – ${new Date(y, m, 0).toLocaleDateString('en-GB', { month: 'short', day: 'numeric' })}`
              }
              const prevM = m === 1 ? 12 : m - 1
              const prevY = m === 1 ? y - 1 : y
              return `${new Date(prevY, prevM - 1, startDay).toLocaleDateString('en-GB', { month: 'short', day: 'numeric' })} – ${new Date(y, m - 1, startDay - 1).toLocaleDateString('en-GB', { month: 'short', day: 'numeric' })}`
            })()}
          </p>
```

Update the SummaryCards call to pass income_breakdown:

```tsx
      <SummaryCards
        total_income={data.total_income}
        total_expenses={data.total_expenses}
        total_savings={data.total_savings}
        left_over={data.left_over}
        income_breakdown={data.income_breakdown}
      />
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/Dashboard.tsx frontend/src/components/SummaryCards.tsx
git commit -m "feat: dashboard shows financial period dates and income category breakdown"
```

---

### Task 14: ReviewCard filters categories by transaction sign

**Files:**
- Modify: `frontend/src/components/ReviewCard.tsx`

- [ ] **Step 1: Filter category dropdown by sign**

In `frontend/src/components/ReviewCard.tsx`, change the `<select>` options to filter by sign.

Replace the categories `<select>` options line:

```tsx
            {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
```

With:

```tsx
            {categories
              .filter(c => tx.amount > 0 ? c.type === 'income' : c.type !== 'income')
              .map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
```

Also update the `useState` initialiser for `selectedCategory` to respect the filtered list. Replace:

```typescript
  const [selectedCategory, setSelectedCategory] = useState<number>(tx.category_id ?? categories[0]?.id)
```

With:

```typescript
  const filteredCategories = categories.filter(c => tx.amount > 0 ? c.type === 'income' : c.type !== 'income')
  const [selectedCategory, setSelectedCategory] = useState<number>(tx.category_id ?? filteredCategories[0]?.id)
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/ReviewCard.tsx
git commit -m "feat: ReviewCard filters categories by transaction sign"
```

---

### Task 15: Final integration test — run all backend tests and add frontend tests

**Files:**
- Create: `frontend/src/tests/Settings.test.tsx`
- Create: `frontend/src/tests/ReviewCard.test.tsx`

- [ ] **Step 1: Write Settings page tests**

Create `frontend/src/tests/Settings.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import Settings from '../pages/Settings'

const mockSettings = { financial_month_start_day: '24' }

vi.mock('../api', () => ({
  api: {
    getSettings: vi.fn(() => Promise.resolve(mockSettings)),
    patchSetting: vi.fn(() => Promise.resolve({ key: 'financial_month_start_day', value: '15' })),
  },
}))

function renderWithClient(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>)
}

describe('Settings page', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('renders the settings page with start day input', async () => {
    renderWithClient(<Settings />)
    expect(await screen.findByText('Financial Month Start Day')).toBeTruthy()
    const input = await screen.findByRole('spinbutton')
    expect(input).toBeTruthy()
    expect((input as HTMLInputElement).value).toBe('24')
  })

  it('saves a valid start day value', async () => {
    const { api } = await import('../api')
    renderWithClient(<Settings />)
    const input = await screen.findByRole('spinbutton')
    fireEvent.change(input, { target: { value: '15' } })
    const saveBtn = screen.getByText('Save')
    fireEvent.click(saveBtn)
    await waitFor(() => {
      expect(api.patchSetting).toHaveBeenCalledWith('financial_month_start_day', '15')
    })
  })

  it('does not save invalid values (0, 29)', async () => {
    const { api } = await import('../api')
    renderWithClient(<Settings />)
    const input = await screen.findByRole('spinbutton')
    fireEvent.change(input, { target: { value: '0' } })
    fireEvent.click(screen.getByText('Save'))
    expect(api.patchSetting).not.toHaveBeenCalled()

    fireEvent.change(input, { target: { value: '29' } })
    fireEvent.click(screen.getByText('Save'))
    expect(api.patchSetting).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Write ReviewCard sign-filtering tests**

Create `frontend/src/tests/ReviewCard.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import ReviewCard from '../components/ReviewCard'

vi.mock('../api', () => ({
  api: {
    getCategories: vi.fn(),
    patchTransaction: vi.fn(),
    createRule: vi.fn(),
    getNextReview: vi.fn(),
  },
}))

const categories = [
  { id: 1, name: 'Food', type: 'needs', sort_order: 1 },
  { id: 2, name: 'Salary', type: 'income', sort_order: 20 },
  { id: 3, name: 'Fun', type: 'wants', sort_order: 7 },
]

function renderWithClient(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>)
}

describe('ReviewCard sign-filtering', () => {
  it('shows only expense categories for negative amount transactions', () => {
    const expenseTx = {
      id: 1, date: '2026-03-01', amount: -45.0,
      description: 'Albert Heijn', source: 'ing',
      category_id: 1, category_name: 'Food',
      confirmed: false, categorised_by: 'ai', ai_confidence: 0.85,
    }
    renderWithClient(<ReviewCard tx={expenseTx} categories={categories} />)
    const options = screen.getAllByRole('option')
    const optionTexts = options.map(o => o.textContent)
    expect(optionTexts).toContain('Food')
    expect(optionTexts).toContain('Fun')
    expect(optionTexts).not.toContain('Salary')
  })

  it('shows only income categories for positive amount transactions', () => {
    const incomeTx = {
      id: 2, date: '2026-03-01', amount: 3400.0,
      description: 'Salaris Maart', source: 'ing',
      category_id: 2, category_name: 'Salary',
      confirmed: false, categorised_by: 'ai', ai_confidence: 0.9,
    }
    renderWithClient(<ReviewCard tx={incomeTx} categories={categories} />)
    const options = screen.getAllByRole('option')
    const optionTexts = options.map(o => o.textContent)
    expect(optionTexts).toContain('Salary')
    expect(optionTexts).not.toContain('Food')
    expect(optionTexts).not.toContain('Fun')
  })
})
```

- [ ] **Step 3: Run all backend tests**

Run: `cd backend && python -m pytest -v`
Expected: ALL PASS

- [ ] **Step 4: Run frontend build to check for type errors**

Run: `cd frontend && npx tsc --noEmit`
Expected: No errors (or only pre-existing errors unrelated to our changes)

- [ ] **Step 5: Run frontend tests**

Run: `cd frontend && npx vitest run`
Expected: ALL PASS (or only pre-existing failures unrelated to our changes)
