from sqlalchemy.orm import Session
from models import Rule, Category

def apply_rules(transaction, db: Session) -> Category | None:
    rules = db.query(Rule).order_by(Rule.priority.desc()).all()
    desc_lower = transaction.description.lower()
    for rule in rules:
        if rule.pattern.lower() in desc_lower:
            return rule.category
    return None
