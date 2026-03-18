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
