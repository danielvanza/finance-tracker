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
    assert len(defaults) == 11

def test_seed_is_idempotent(db):
    run_seed(db)
    run_seed(db)  # should not raise or duplicate
    cats = db.query(Category).all()
    assert len(cats) == 11
    defaults = db.query(Budget).filter_by(month=None).all()
    assert len(defaults) == 11
