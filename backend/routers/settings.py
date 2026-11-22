from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
import guesses
import runtime_settings
from categorizer.claude_cli import CLAUDE_MODELS
from db import get_db
from datetime import date
from financial_month import anchor_month
from models import MonthStart, Setting
from schemas import MonthStartIn, SettingPatch
import spend_service

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
    "nudges": lambda v: v in ("on", "off"),
    "quiet_hours": lambda v: runtime_settings.parse_quiet_hours(v) is not None,
    "sort_model": lambda v: v in CLAUDE_MODELS,
}
MESSAGES = {
    "nudges": "Messages the bot sends unasked are either on or off",
    "quiet_hours": "Quiet hours are two different whole hours from 0 to 23, such as 21-9 (from 21:00 until 9:00)",
    "sort_model": f"The model that sorts imports is one of {', '.join(CLAUDE_MODELS)}",
    "target_split": "The three percentages must be whole numbers that add up to 100",
    "own_names": "A name needs at least 4 characters, and there can be four names at most",
}
# What applies while nothing is set (the environment's say, or the app's own).
DEFAULTS = {"target_split": "50/30/20", "own_names": "", **runtime_settings.defaults()}


@router.get("")
def get_settings(db: Session = Depends(get_db)):
    settings = db.query(Setting).all()
    return {**DEFAULTS, **{s.key: s.value for s in settings}}


def _month_starts(db: Session) -> list[dict]:
    rows = db.query(MonthStart).order_by(MonthStart.year, MonthStart.month).all()
    return [{"year": r.year, "month": r.month, "start_date": r.start_date.isoformat()} for r in rows]


@router.get("/month-starts")
def list_month_starts(db: Session = Depends(get_db)):
    """The start dates chosen for single financial months, oldest first."""
    return _month_starts(db)


@router.put("/month-starts/{year}/{month}")
def set_month_start(year: int, month: int, body: MonthStartIn, db: Session = Depends(get_db)):
    """Make financial month year-month begin on start_date, which must fall in the calendar month the usual
    start day would put it in (the one before the label, or the label itself when the start day is 1)."""
    if not 1 <= month <= 12 or not 2000 <= year <= 2100:
        raise HTTPException(status_code=422, detail="That is not a month")
    anchor = anchor_month(year, month, int(spend_service.get_start_day(db)))
    if (body.start_date.year, body.start_date.month) != anchor:
        raise HTTPException(
            status_code=422,
            detail=f"This month can only begin in {date(*anchor, 1):%B %Y}, between the 1st and the {_last_day(*anchor)}th")
    row = db.get(MonthStart, (year, month))
    if row is None:
        db.add(MonthStart(year=year, month=month, start_date=body.start_date))
    else:
        row.start_date = body.start_date
    db.commit()
    return _month_starts(db)


@router.delete("/month-starts/{year}/{month}")
def clear_month_start(year: int, month: int, db: Session = Depends(get_db)):
    """Put the usual start day back for financial month year-month."""
    row = db.get(MonthStart, (year, month))
    if row is not None:
        db.delete(row)
        db.commit()
    return _month_starts(db)


def _last_day(year: int, month: int) -> int:
    return (date(year + (month == 12), month % 12 + 1, 1) - date(year, month, 1)).days


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
    runtime_settings.forget()
    return {"key": setting.key, "value": setting.value}
