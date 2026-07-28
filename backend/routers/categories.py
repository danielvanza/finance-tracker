from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from db import get_db
from models import Category, CategoryType
from pydantic import BaseModel
from typing import Optional

router = APIRouter(prefix="/categories", tags=["categories"])


@router.get("")
def list_categories(db: Session = Depends(get_db)):
    return [
        {
            "id": c.id,
            "name": c.name,
            "type": c.type.value if hasattr(c.type, "value") else str(c.type),
            "sort_order": c.sort_order,
        }
        for c in db.query(Category).order_by(Category.sort_order).all()
    ]


class CategoryPatch(BaseModel):
    type: Optional[str] = None


@router.patch("/{category_id}")
def patch_category(
    category_id: int, body: CategoryPatch, db: Session = Depends(get_db)
):
    cat = db.get(Category, category_id)
    if not cat:
        raise HTTPException(status_code=404, detail="Category not found")
    if body.type is not None:
        try:
            cat.type = CategoryType(body.type)
        except ValueError:
            raise HTTPException(status_code=422, detail=f"Invalid type: {body.type}")
    db.commit()
    db.refresh(cat)
    return {
        "id": cat.id,
        "name": cat.name,
        "type": cat.type.value if hasattr(cat.type, "value") else str(cat.type),
        "sort_order": cat.sort_order,
    }
