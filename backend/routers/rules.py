from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from db import get_db
from models import Category, Rule
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
