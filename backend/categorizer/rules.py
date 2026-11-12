from sqlalchemy.orm import Session
from models import Rule, Category


def is_sign_compatible(amount, category: Category) -> bool:
    """Money coming in can only be income, money going out only spending; an exclude category takes both."""
    cat_type = category.type.value if hasattr(category.type, "value") else str(category.type)
    if cat_type == "exclude":
        return True
    if amount > 0:
        return cat_type == "income"
    return cat_type in ("needs", "wants", "savings")


SHORT = 6  # a text shorter than this only fits as a word of its own


def squeeze(text: str) -> str:
    """Lower case, with every run of spaces as one: how descriptions and patterns are compared."""
    return " ".join(text.lower().split())


def fits(pattern: str, text: str) -> bool:
    """Whether a squeezed pattern is in a squeezed description. A short one, such as "esso", must stand
    as a word of its own, so it does not also fit "espresso bar"; digits may touch it ("jumbo123")."""
    at = text.find(pattern)
    if len(pattern) >= SHORT:
        return at >= 0
    while at >= 0:
        end = at + len(pattern)
        if not (at > 0 and text[at - 1].isalpha()) and not (end < len(text) and text[end].isalpha()):
            return True
        at = text.find(pattern, at + 1)
    return False


def matching_rule(description: str, amount, db: Session) -> Rule | None:
    """The rule that sorts this payment: of those whose pattern is in the description, the most specific
    (longest) one, and of equally long ones the oldest."""
    text = squeeze(description)
    fitting = [
        rule for rule in db.query(Rule).all()
        if rule.pattern.strip() and fits(squeeze(rule.pattern), text) and is_sign_compatible(amount, rule.category)
    ]
    return max(fitting, key=lambda rule: (len(rule.pattern), -rule.id)) if fitting else None


def apply_rules(transaction, db: Session) -> Category | None:
    rule = matching_rule(transaction.description, transaction.amount, db)
    return rule.category if rule else None
