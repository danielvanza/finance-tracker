"""Savings goals: a name, a target, an optional date, and a pace worked out from the bank files.

Definitions live as one small JSON value in the settings table (key `savings_goals`), so there is no
table. The progress is derived: what was already in the pot when the goal started, plus the savings
spend in the goal's own category since then (refunds net, so a withdrawal marked as a refund lowers it).
The pace is the average of the last three finished financial months and needs two of them to have bank
data; with fewer it says nothing (the No Guessing Rule). Money is integer cents.
"""
import json
import re
from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func
from sqlalchemy.orm import Session

import money
import spend_service
from db import get_db
from financial_month import get_financial_month_range, label_month_for_date
from models import Category, CategoryType, Setting, Transaction, TransactionSource

router = APIRouter(prefix="/goals", tags=["goals"])

KEY = "savings_goals"
MAX_GOALS = 5
MAX_NAME = 24
MAX_CENTS = 99_999_999
VALUE_LIMIT = 500  # settings.value is String(500)
PACE_MONTHS = 3
PACE_NEEDS = 2
BANK_SOURCES = (TransactionSource.ing, TransactionSource.revolut, TransactionSource.degiro)
MONTH_RE = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")


def _today() -> date:
    return date.today()


class GoalIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str
    category_id: int
    target_cents: int = Field(gt=0, le=MAX_CENTS)
    start_cents: int = Field(0, ge=0, le=MAX_CENTS)  # in the pot when the goal started
    by: str | None = None  # financial month label, YYYY-MM
    started: date | None = None  # kept by the client between edits; today when new


class GoalsIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    goals: list[GoalIn]


def _label_index(year: int, month: int) -> int:
    return year * 12 + month - 1


def _label(index: int) -> str:
    return f"{index // 12}-{index % 12 + 1:02d}"


def _stored(db: Session) -> list[dict]:
    row = db.get(Setting, KEY)
    if row is None:
        return []
    try:
        data = json.loads(row.value)
    except ValueError:
        return []
    return [g for g in data if isinstance(g, dict)] if isinstance(data, list) else []


def _savings_categories(db: Session) -> dict[int, str]:
    rows = db.query(Category).filter(Category.type == CategoryType.savings).order_by(
        Category.sort_order, Category.name).all()
    return {c.id: c.name for c in rows}


def _has_bank_data(db: Session, start: date, end: date) -> bool:
    return db.query(func.count(Transaction.id)).filter(
        Transaction.source.in_(BANK_SOURCES),
        Transaction.confirmed == True,  # noqa: E712 - historic form
        Transaction.date >= start, Transaction.date <= end,
    ).scalar() > 0


def _saving_by_month(db: Session, current: int) -> dict[int, dict[int, int]]:
    """For each of the last finished months with bank data: category id -> cents saved in it."""
    out: dict[int, dict[int, int]] = {}
    last = db.query(func.max(Transaction.date)).filter(Transaction.source.in_(BANK_SOURCES)).scalar()
    if last is None:
        return out
    # The month the newest bank file falls in may not be complete yet, as on Month.
    through = _label_index(*label_month_for_date(last, spend_service.get_start_day(db)))
    for index in range(current - PACE_MONTHS, min(current, through)):
        start, end = spend_service.financial_month_bounds(db, index // 12, index % 12 + 1)
        if not _has_bank_data(db, start, end):
            continue
        parts = spend_service.confirmed_parts_in_range(db, start, end)
        out[index] = {cid: money.to_cents(v)
                      for cid, v in spend_service.spend_totals_by_category(parts).items()}
    return out


def _derive(db: Session, stored: list[dict], names: dict[int, str], today: date) -> list[dict]:
    start_day = spend_service.get_start_day(db)
    cur_y, cur_m = label_month_for_date(today, start_day)
    current = _label_index(cur_y, cur_m)
    months = _saving_by_month(db, current)

    goals = []
    for g in stored:
        cid = g.get("c")
        if cid not in names:
            continue  # its category is gone or no longer a savings category
        target, start_cents = int(g["t"]), int(g.get("s", 0))
        started = date.fromisoformat(g["d"])
        by = g.get("b")

        parts = spend_service.confirmed_parts_in_range(db, started, today)
        since = spend_service.spend_totals_by_category(parts).get(cid)
        saved = start_cents + (money.to_cents(since) if since is not None else 0)
        remaining = max(target - saved, 0)

        pace = None
        if len(months) >= PACE_NEEDS:
            pace = round(sum(m.get(cid, 0) for m in months.values()) / len(months))

        needed = short = reach = tick = None
        if by:
            by_y, by_m = int(by[:4]), int(by[5:])
            months_left = _label_index(by_y, by_m) - current + 1
            if remaining and months_left > 0:
                needed = -(-remaining // months_left)
            end = get_financial_month_range(by_y, by_m, start_day)[1]
            span = (end - started).days
            if span > 0:
                frac = min(max((today - started).days / span, 0), 1)
                first = min(start_cents / target, 1)
                tick = round((first + (1 - first) * frac) * 100, 1)
        if pace is not None and pace > 0 and remaining:
            reach = _label(current + -(-remaining // pace))

        if remaining == 0:
            status = "done"
        elif not by:
            status = "open"
        elif _label_index(int(by[:4]), int(by[5:])) < current:
            status = "late"
        elif pace is None:
            status = "unknown"
        else:
            short = needed - pace
            status = "short" if short > 0 else "on_track"

        goals.append({
            "name": g["n"], "category_id": cid, "category_name": names[cid],
            "target_cents": target, "start_cents": start_cents, "started": started.isoformat(),
            "by": by, "saved_cents": saved, "status": status, "needed_cents": needed,
            "pace_cents": pace, "short_cents": short if short and short > 0 else None,
            "reach": reach, "tick_pct": tick,
        })
    return goals


def _view(db: Session) -> dict:
    today = _today()
    names = _savings_categories(db)
    start_day = spend_service.get_start_day(db)
    y, m = label_month_for_date(today, start_day)
    return {
        "goals": _derive(db, _stored(db), names, today),
        "savings_categories": [{"id": i, "name": n} for i, n in names.items()],
        "max_goals": MAX_GOALS,
        "current_month": f"{y}-{m:02d}",
        "today": today.isoformat(),
    }


@router.get("")
def get_goals(db: Session = Depends(get_db)):
    return _view(db)


@router.put("")
def put_goals(body: GoalsIn, db: Session = Depends(get_db)):
    if len(body.goals) > MAX_GOALS:
        raise HTTPException(status_code=422, detail=f"At most {MAX_GOALS} goals")
    names = _savings_categories(db)
    today = _today()
    packed, seen = [], set()
    for g in body.goals:
        name = g.name.strip()
        if not name or len(name) > MAX_NAME:
            raise HTTPException(status_code=422, detail=f"A name needs 1 to {MAX_NAME} characters")
        if g.category_id not in names:
            raise HTTPException(status_code=422, detail="A goal is saved into a savings category")
        if g.category_id in seen:
            raise HTTPException(status_code=422, detail="One goal for each savings category")
        seen.add(g.category_id)
        if g.by is not None and not MONTH_RE.match(g.by):
            raise HTTPException(status_code=422, detail="The month needs the form YYYY-MM")
        item = {"n": name, "c": g.category_id, "t": g.target_cents, "s": g.start_cents,
                "d": (g.started or today).isoformat()}
        if g.by:
            item["b"] = g.by
        packed.append(item)

    value = json.dumps(packed, separators=(",", ":"), ensure_ascii=False)
    if len(value) > VALUE_LIMIT:
        raise HTTPException(status_code=422, detail="Too long: shorten the names")
    row = db.get(Setting, KEY)
    if row is None:
        db.add(Setting(key=KEY, value=value))
    else:
        row.value = value
    db.commit()
    return _view(db)
