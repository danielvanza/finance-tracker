from models import Category, Transaction, Rule, Budget, CategoryType, Setting
from decimal import Decimal
from datetime import date

def test_category_creation(db):
    cat = Category(name="Food - Essential", type="needs", sort_order=1)
    db.add(cat)
    db.commit()
    assert cat.id is not None
    assert cat.name == "Food - Essential"

def test_transaction_creation(db):
    cat = Category(name="Food", type="needs", sort_order=1)
    db.add(cat)
    db.commit()
    tx = Transaction(
        date=date(2026, 3, 1),
        amount=Decimal("-45.00"),
        description="Albert Heijn",
        source="ing",
        category_id=cat.id,
        confirmed=True,
        categorised_by="rule",
        import_hash="abc123",
    )
    db.add(tx)
    db.commit()
    assert tx.id is not None

def test_rule_creation(db):
    cat = Category(name="Food", type="needs", sort_order=1)
    db.add(cat)
    db.commit()
    rule = Rule(pattern="albert heijn", category_id=cat.id, priority=10)
    db.add(rule)
    db.commit()
    assert rule.id is not None

def test_budget_creation(db):
    cat = Category(name="Food", type="needs", sort_order=1)
    db.add(cat)
    db.commit()
    b = Budget(category_id=cat.id, month=None, planned_amount=Decimal("350.00"))
    db.add(b)
    db.commit()
    assert b.id is not None

def test_category_with_income_type(db):
    cat = Category(name="Salary", type="income", sort_order=20)
    db.add(cat)
    db.commit()
    assert cat.id is not None
    assert cat.type == CategoryType.income

def test_setting_creation(db):
    s = Setting(key="financial_month_start_day", value="24")
    db.add(s)
    db.commit()
    loaded = db.query(Setting).filter_by(key="financial_month_start_day").first()
    assert loaded is not None
    assert loaded.value == "24"

def test_setting_primary_key_is_key(db):
    db.add(Setting(key="test_key", value="a"))
    db.commit()
    db.add(Setting(key="test_key", value="b"))
    from sqlalchemy.exc import IntegrityError
    import pytest
    with pytest.raises(IntegrityError):
        db.commit()
