from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from db import get_db
from models import Setting
from schemas import SettingPatch

router = APIRouter(prefix="/settings", tags=["settings"])

# Per-key validation rules
VALIDATORS = {
    "financial_month_start_day": lambda v: v.isdigit() and 1 <= int(v) <= 28,
}


@router.get("")
def get_settings(db: Session = Depends(get_db)):
    settings = db.query(Setting).all()
    return {s.key: s.value for s in settings}


@router.patch("/{key}")
def patch_setting(key: str, body: SettingPatch, db: Session = Depends(get_db)):
    setting = db.query(Setting).filter_by(key=key).first()
    if not setting:
        raise HTTPException(status_code=404, detail=f"Setting '{key}' not found")

    validator = VALIDATORS.get(key)
    if validator and not validator(body.value):
        raise HTTPException(status_code=422, detail=f"Invalid value for '{key}'")

    setting.value = body.value
    db.commit()
    return {"key": setting.key, "value": setting.value}
