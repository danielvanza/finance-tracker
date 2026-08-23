from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session
from decimal import Decimal
from db import get_db
from models import Category, CategoryType, Transaction, TransactionSplit, Rule, StandingAdjustment, Budget
from schemas import CategoryCreate, CategoryReorder
from pydantic import BaseModel
from typing import Optional

router = APIRouter(prefix="/categories", tags=["categories"])

BUDGETED_TYPES = (CategoryType.needs, CategoryType.wants, CategoryType.savings)


def _out(cat: Category) -> dict:
    return {
        "id": cat.id,
        "name": cat.name,
        "type": cat.type.value if hasattr(cat.type, "value") else str(cat.type),
        "sort_order": cat.sort_order,
    }


@router.get("")
def list_categories(db: Session = Depends(get_db)):
    return [_out(c) for c in db.query(Category).order_by(Category.sort_order).all()]


class CategoryPatch(BaseModel):
    type: Optional[str] = None
    name: Optional[str] = None
    force: bool = False


def _usage_counts(db: Session, category_id: int) -> dict:
    return {
        "transaction": db.query(Transaction).filter_by(category_id=category_id).count(),
        "split": db.query(TransactionSplit).filter_by(category_id=category_id).count(),
        "rule": db.query(Rule).filter_by(category_id=category_id).count(),
        "standing adjustment": db.query(StandingAdjustment).filter(
            (StandingAdjustment.income_category_id == category_id)
            | (StandingAdjustment.expense_category_id == category_id)
        ).count(),
    }


@router.post("", status_code=201)
def create_category(body: CategoryCreate, db: Session = Depends(get_db)):
    try:
        cat_type = CategoryType(body.type)
    except ValueError:
        raise HTTPException(status_code=422, detail=f"Invalid type: {body.type}")

    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="Name must not be blank")
    if db.query(Category).filter_by(name=name).first():
        raise HTTPException(status_code=422, detail=f"'{name}' already exists")

    if body.sort_order is not None:
        sort_order = body.sort_order
    else:
        max_order = db.query(func.max(Category.sort_order)).scalar()
        sort_order = (max_order or 0) + 1

    cat = Category(name=name, type=cat_type, sort_order=sort_order)
    db.add(cat)
    db.flush()

    if cat_type in BUDGETED_TYPES:
        db.add(Budget(category_id=cat.id, month=None, planned_amount=Decimal("0")))

    db.commit()
    db.refresh(cat)
    return _out(cat)


@router.patch("/reorder")
def reorder_categories(body: CategoryReorder, db: Session = Depends(get_db)):
    if len(body.category_ids) < 2:
        raise HTTPException(status_code=422, detail="Need at least 2 category ids to reorder")

    cats = db.query(Category).filter(Category.id.in_(body.category_ids)).all()
    cats_by_id = {c.id: c for c in cats}
    missing = [cid for cid in body.category_ids if cid not in cats_by_id]
    if missing:
        raise HTTPException(status_code=422, detail=f"Unknown category id(s): {missing}")

    sort_orders = sorted(c.sort_order for c in cats)
    for cat_id, sort_order in zip(body.category_ids, sort_orders):
        cats_by_id[cat_id].sort_order = sort_order

    db.commit()
    return [{"id": cid, "sort_order": cats_by_id[cid].sort_order} for cid in body.category_ids]


@router.patch("/{category_id}")
def patch_category(
    category_id: int, body: CategoryPatch, db: Session = Depends(get_db)
):
    cat = db.get(Category, category_id)
    if not cat:
        raise HTTPException(status_code=404, detail="Category not found")
    new_type = None
    if body.type is not None:
        try:
            new_type = CategoryType(body.type)
        except ValueError:
            raise HTTPException(status_code=422, detail=f"Invalid type: {body.type}")
        if new_type != cat.type:
            counts = _usage_counts(db, category_id)
            blockers = {label: n for label, n in counts.items() if n > 0}
            if blockers and not body.force:
                parts = ", ".join(f"{n} {label}(s)" for label, n in blockers.items())
                raise HTTPException(status_code=422, detail=(
                    f"Cannot change type of '{cat.name}' to '{body.type}': "
                    f"in use by {parts}. Reassign or remove them first, or pass force:true."))
        cat.type = new_type
    if body.name is not None:
        name = body.name.strip()
        if not name:
            raise HTTPException(status_code=422, detail="Name must not be blank")
        existing = db.query(Category).filter(
            Category.name == name, Category.id != category_id
        ).first()
        if existing:
            raise HTTPException(status_code=422, detail=f"'{name}' already exists")
        cat.name = name
    db.commit()
    db.refresh(cat)
    return _out(cat)


@router.delete("/{category_id}")
def delete_category(category_id: int, db: Session = Depends(get_db)):
    cat = db.get(Category, category_id)
    if not cat:
        raise HTTPException(status_code=404, detail="Category not found")

    counts = _usage_counts(db, category_id)
    blockers = {label: count for label, count in counts.items() if count > 0}
    if blockers:
        parts = ", ".join(f"{count} {label}(s)" for label, count in blockers.items())
        raise HTTPException(
            status_code=422,
            detail=f"Cannot delete '{cat.name}': in use by {parts}. Reassign or remove them first.",
        )

    db.query(Budget).filter_by(category_id=category_id).delete()
    db.delete(cat)
    db.commit()
    return {"deleted": category_id}
