from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from datetime import date
from db import get_db
from models import StandingAdjustment, Category
from schemas import StandingAdjustmentCreate, StandingAdjustmentPatch, StandingAdjustmentOut

router = APIRouter(prefix="/standing-adjustments", tags=["standing-adjustments"])

EXPENSE_TYPES = ("needs", "wants", "savings")


def _cat_type(category: Category) -> str:
    return category.type.value if hasattr(category.type, "value") else str(category.type)


def _validate_categories(income_category_id: int, expense_category_id: int, db: Session):
    income_cat = db.get(Category, income_category_id)
    expense_cat = db.get(Category, expense_category_id)
    if not income_cat or not expense_cat:
        raise HTTPException(status_code=422, detail="Both categories must exist")
    if _cat_type(income_cat) != "income":
        raise HTTPException(status_code=422,
                            detail=f"'{income_cat.name}' must be an income category")
    if _cat_type(expense_cat) not in EXPENSE_TYPES:
        raise HTTPException(status_code=422,
                            detail=f"'{expense_cat.name}' must be an expense category (needs/wants/savings)")


@router.get("", response_model=list[StandingAdjustmentOut])
def list_standing_adjustments(db: Session = Depends(get_db)):
    return db.query(StandingAdjustment).order_by(StandingAdjustment.id).all()


@router.post("", response_model=StandingAdjustmentOut, status_code=201)
def create_standing_adjustment(body: StandingAdjustmentCreate, db: Session = Depends(get_db)):
    if body.amount <= 0:
        raise HTTPException(status_code=422, detail="Amount must be positive")
    if db.query(StandingAdjustment).filter_by(name=body.name).first():
        raise HTTPException(status_code=422, detail=f"'{body.name}' already exists")
    _validate_categories(body.income_category_id, body.expense_category_id, db)
    today = date.today()
    sa = StandingAdjustment(
        name=body.name, amount=body.amount,
        income_category_id=body.income_category_id,
        expense_category_id=body.expense_category_id,
        active=body.active,
        start_month=body.start_month.replace(day=1) if body.start_month else today.replace(day=1),
    )
    db.add(sa)
    db.commit()
    db.refresh(sa)
    return sa


@router.patch("/{sa_id}", response_model=StandingAdjustmentOut)
def patch_standing_adjustment(sa_id: int, body: StandingAdjustmentPatch, db: Session = Depends(get_db)):
    sa = db.get(StandingAdjustment, sa_id)
    if not sa:
        raise HTTPException(404)
    if body.name is not None:
        existing = db.query(StandingAdjustment).filter_by(name=body.name).first()
        if existing and existing.id != sa_id:
            raise HTTPException(status_code=422, detail=f"'{body.name}' already exists")
        sa.name = body.name
    if body.amount is not None:
        if body.amount <= 0:
            raise HTTPException(status_code=422, detail="Amount must be positive")
        sa.amount = body.amount
    income_id = body.income_category_id if body.income_category_id is not None else sa.income_category_id
    expense_id = body.expense_category_id if body.expense_category_id is not None else sa.expense_category_id
    if income_id != sa.income_category_id or expense_id != sa.expense_category_id:
        _validate_categories(income_id, expense_id, db)
        sa.income_category_id = income_id
        sa.expense_category_id = expense_id
    if body.active is not None:
        sa.active = body.active
    if body.start_month is not None:
        sa.start_month = body.start_month.replace(day=1)
    db.commit()
    db.refresh(sa)
    return sa


@router.delete("/{sa_id}")
def delete_standing_adjustment(sa_id: int, db: Session = Depends(get_db)):
    """Delete the template. Already-materialised transactions are kept (their
    link is cleared) so past months stay truthful."""
    sa = db.get(StandingAdjustment, sa_id)
    if not sa:
        raise HTTPException(404)
    db.delete(sa)
    db.commit()
    return {"deleted": sa_id}
