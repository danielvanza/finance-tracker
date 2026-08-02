from seed import run_seed
from models import Category, Budget, CategoryType

def test_seed_creates_categories(db):
    run_seed(db)
    cats = db.query(Category).all()
    names = [c.name for c in cats]
    assert "Food - Essential" in names
    assert "Taxes & Mortgage" in names
    assert "DEGIRO" in names

def test_seed_categories_have_correct_types(db):
    run_seed(db)
    food = db.query(Category).filter_by(name="Food - Essential").first()
    assert food.type == CategoryType.needs
    entertainment = db.query(Category).filter_by(name="Recreation & Entertainment").first()
    assert entertainment.type == CategoryType.wants
    degiro = db.query(Category).filter_by(name="DEGIRO").first()
    assert degiro.type == CategoryType.savings

def test_seed_creates_default_budgets(db):
    run_seed(db)
    defaults = db.query(Budget).filter_by(month=None).all()
    assert len(defaults) == 16  # expense/wants/savings categories with budgets

def test_seed_is_idempotent(db):
    run_seed(db)
    run_seed(db)  # should not raise or duplicate
    cats = db.query(Category).all()
    assert len(cats) == 21  # 16 expense + 4 income + 1 exclude
    defaults = db.query(Budget).filter_by(month=None).all()
    assert len(defaults) == 16  # income/exclude categories have no default budget
    from models import StandingAdjustment
    assert db.query(StandingAdjustment).count() == 2

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
    from models import Budget as BudgetModel
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


def test_seed_does_not_duplicate_renamed_category(db):
    run_seed(db)
    fun_account = db.query(Category).filter_by(name="Fun Account").first()
    fun_account.name = "Dog savings"
    db.commit()

    run_seed(db)

    assert db.query(Category).filter_by(name="Dog savings").count() == 1
    assert db.query(Category).filter_by(name="Fun Account").first() is None
    assert db.query(Category).count() == 21
