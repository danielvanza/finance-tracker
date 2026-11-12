from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

import guesses
from db import get_db
from models import AskShop, Category, Rule, Transaction
from schemas import RuleCreate, RuleUpdate

router = APIRouter(prefix="/rules", tags=["rules"])

MIN_PATTERN = 2


def _to_out(rule: Rule) -> dict:
    return {"id": rule.id, "pattern": rule.pattern, "category_id": rule.category_id,
            "category_name": rule.category.name}


def _pattern(raw: str) -> str:
    pattern = " ".join(raw.split())
    if len(pattern) < MIN_PATTERN:
        raise HTTPException(status_code=422, detail=(
            f"A rule's text needs at least {MIN_PATTERN} characters, or it would match almost every payment"))
    return pattern


def _category(category_id: int, db: Session) -> int:
    if db.get(Category, category_id) is None:
        raise HTTPException(status_code=422, detail=f"Category {category_id} does not exist")
    return category_id


@router.get("")
def list_rules(db: Session = Depends(get_db)):
    return [_to_out(r) for r in db.query(Rule).order_by(Rule.id).all()]


class AskShopIn(BaseModel):
    transaction_id: int


@router.get("/ask-shops")
def list_ask_shops(db: Session = Depends(get_db)):
    """Shops that are different every time: their payments are always asked about."""
    return [{"pattern": p} for p in guesses.ask_shops(db)]


@router.post("/ask-shops")
def add_ask_shop(body: AskShopIn, db: Session = Depends(get_db)):
    """Always ask about this payment's shop. A rule that sorted the shop is removed."""
    tx = db.get(Transaction, body.transaction_id)
    if tx is None:
        raise HTTPException(422, f"There is no payment with id {body.transaction_id}")
    try:
        pattern, removed = guesses.always_ask(db, tx)
    except ValueError as e:
        raise HTTPException(422, str(e)) from e
    db.commit()
    return {"pattern": pattern, "removed_rules": removed}


@router.delete("/ask-shops")
def delete_ask_shop(pattern: str = Query(...), db: Session = Depends(get_db)):
    """Let Claude sort this shop's payments by itself again."""
    shop = db.get(AskShop, guesses.squeeze(pattern))
    if shop is None:
        raise HTTPException(404, f"“{pattern}” is not a shop that is always asked about")
    db.delete(shop)
    db.commit()
    return {"deleted": shop.pattern}


@router.post("")
def create_rule(body: RuleCreate, db: Session = Depends(get_db)):
    rule = Rule(pattern=_pattern(body.pattern), category_id=_category(body.category_id, db))
    db.add(rule)
    db.commit()
    db.refresh(rule)
    return _to_out(rule)


@router.patch("/{rule_id}")
def update_rule(rule_id: int, body: RuleUpdate, db: Session = Depends(get_db)):
    rule = db.get(Rule, rule_id)
    if not rule:
        raise HTTPException(404)
    if body.pattern is not None:
        rule.pattern = _pattern(body.pattern)
    if body.category_id is not None:
        rule.category_id = _category(body.category_id, db)
    db.commit()
    return _to_out(rule)


@router.delete("/{rule_id}")
def delete_rule(rule_id: int, db: Session = Depends(get_db)):
    rule = db.get(Rule, rule_id)
    if not rule:
        raise HTTPException(404)
    db.delete(rule)
    db.commit()
    return {"deleted": rule_id}
