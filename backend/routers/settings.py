from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
import guesses
from db import get_db
from models import Setting
from schemas import SettingPatch

router = APIRouter(prefix="/settings", tags=["settings"])

import re


def _is_split(value: str) -> bool:
    """Three whole percentages for needs, wants and savings, such as 50/30/20, adding up to 100."""
    if not re.fullmatch(r"\d{1,3}/\d{1,3}/\d{1,3}", value):
        return False
    return sum(int(part) for part in value.split("/")) == 100


# Per-key validation rules
def _are_names(value: str) -> bool:
    """Up to four names separated by ";", each long enough not to match half the bank's descriptions."""
    names = [name.strip() for name in value.split(";") if name.strip()]
    return len(value) <= 300 and len(names) <= 4 and all(4 <= len(name) <= 60 for name in names)


VALIDATORS = {
    "financial_month_start_day": lambda v: v.isdigit() and 1 <= int(v) <= 28,
    "target_split": _is_split,
    "own_names": _are_names,
}
MESSAGES = {
    "target_split": "The three percentages must be whole numbers that add up to 100",
    "own_names": "A name needs at least 4 characters, and there can be four names at most",
}
DEFAULTS = {"target_split": "50/30/20", "own_names": ""}


@router.get("")
def get_settings(db: Session = Depends(get_db)):
    settings = db.query(Setting).all()
    return {**DEFAULTS, **{s.key: s.value for s in settings}}


@router.patch("/{key}")
def patch_setting(key: str, body: SettingPatch, db: Session = Depends(get_db)):
    setting = db.query(Setting).filter_by(key=key).first()
    if not setting and key not in DEFAULTS:
        raise HTTPException(status_code=404, detail=f"Setting '{key}' not found")

    validator = VALIDATORS.get(key)
    if validator and not validator(body.value):
        raise HTTPException(status_code=422, detail=MESSAGES.get(key, f"Invalid value for '{key}'"))
    if not setting:
        setting = Setting(key=key, value=body.value)
        db.add(setting)

    setting.value = body.value
    if key == "own_names":
        # Transfers to these names that were waiting for an answer are sorted there and then.
        setting.value = ";".join(name.strip() for name in body.value.split(";") if name.strip())
        db.flush()
        guesses.sort_personal(db, guesses.waiting(db))
    db.commit()
    return {"key": setting.key, "value": setting.value}
