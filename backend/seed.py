from decimal import Decimal
from sqlalchemy.orm import Session
from models import Category, Budget

CATEGORIES = [
    ("Taxes & Mortgage",         "needs",   1,  Decimal("2000")),
    ("Utilities",                "needs",   2,  Decimal("200")),
    ("Food - Essential",         "needs",   3,  Decimal("350")),
    ("Transportation",           "needs",   4,  Decimal("200")),
    ("Insurance",                "needs",   5,  Decimal("400")),
    ("Medical & Healthcare",     "needs",   6,  Decimal("100")),
    ("Food - Not Essential",     "wants",   7,  Decimal("200")),
    ("Recreation & Entertainment","wants",  8,  Decimal("100")),
    ("Miscellaneous",            "wants",   9,  Decimal("300")),
    ("DEGIRO",                   "savings", 10, Decimal("300")),
    ("Fun Account",              "savings", 11, Decimal("100")),
]

def run_seed(db: Session) -> None:
    for name, type_, order, default_amount in CATEGORIES:
        cat = db.query(Category).filter_by(name=name).first()
        if not cat:
            cat = Category(name=name, type=type_, sort_order=order)
            db.add(cat)
            db.flush()
        existing = db.query(Budget).filter_by(category_id=cat.id, month=None).first()
        if not existing:
            db.add(Budget(category_id=cat.id, month=None, planned_amount=default_amount))
    db.commit()
