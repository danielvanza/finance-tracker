from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from db import get_db
from models import Category

router = APIRouter(prefix="/categories", tags=["categories"])

@router.get("")
def list_categories(db: Session = Depends(get_db)):
    return [{"id": c.id, "name": c.name,
             "type": c.type.value if hasattr(c.type, "value") else str(c.type),
             "sort_order": c.sort_order}
            for c in db.query(Category).order_by(Category.sort_order).all()]
