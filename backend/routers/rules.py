from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from db import get_db
from models import Rule, Transaction
from schemas import RuleCreate, RuleTestRequest

router = APIRouter(prefix="/rules", tags=["rules"])

def _to_out(rule: Rule) -> dict:
    return {"id": rule.id, "pattern": rule.pattern, "category_id": rule.category_id,
            "category_name": rule.category.name, "priority": rule.priority}

@router.get("")
def list_rules(db: Session = Depends(get_db)):
    return [_to_out(r) for r in db.query(Rule).order_by(Rule.priority.desc()).all()]

@router.post("")
def create_rule(body: RuleCreate, db: Session = Depends(get_db)):
    rule = Rule(pattern=body.pattern, category_id=body.category_id, priority=body.priority)
    db.add(rule)
    db.commit()
    db.refresh(rule)
    return _to_out(rule)

@router.patch("/{rule_id}")
def update_rule(rule_id: int, body: RuleCreate, db: Session = Depends(get_db)):
    rule = db.get(Rule, rule_id)
    if not rule:
        raise HTTPException(404)
    rule.pattern = body.pattern
    rule.category_id = body.category_id
    rule.priority = body.priority
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

@router.post("/test")
def test_rule(body: RuleTestRequest, db: Session = Depends(get_db)):
    pattern = body.pattern.lower()
    matches = db.query(Transaction).filter(
        Transaction.description.ilike(f"%{pattern}%")
    ).limit(20).all()
    return {"matches": len(matches), "examples": [t.description for t in matches[:5]]}
