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
    ("Home & DIY",                CategoryType.wants,   10, Decimal("100")),
    ("Clothing",                  CategoryType.wants,   11, Decimal("100")),
    ("Cash Withdrawal",           CategoryType.wants,   12, Decimal("100")),
    ("To personal accounts",      CategoryType.wants,   13, Decimal("0")),
    ("DEGIRO",                    CategoryType.savings, 14, Decimal("300")),
    ("Fun Account",               CategoryType.savings, 15, Decimal("100")),
    ("Savings Transfer",          CategoryType.savings, 16, Decimal("0")),
]

INCOME_CATEGORIES = [
    ("Salary",          CategoryType.income, 17),
    ("Other Income",    CategoryType.income, 18),
]

EXCLUDE_CATEGORIES = [
    ("Internal Transfer", CategoryType.exclude, 19),
]

SETTINGS = [
    ("financial_month_start_day", "24"),
    ("target_split", "50/30/20"),
]

def run_seed(db: Session) -> None:
    if db.query(Category).count() > 0:
        return

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

    # Exclude categories (no budget)
    for name, type_, order in EXCLUDE_CATEGORIES:
        cat = db.query(Category).filter_by(name=name).first()
        if not cat:
            db.add(Category(name=name, type=type_, sort_order=order))

    # Settings
    for key, value in SETTINGS:
        existing = db.query(Setting).filter_by(key=key).first()
        if not existing:
            db.add(Setting(key=key, value=value))

    db.commit()
