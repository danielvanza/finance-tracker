"""Reports: one read-only export of everything the household entered or imported.

`GET /reports/backup` sends a JSON file (money as integer cents, like the rest of the API).
It leaves out the chat tables: the conversation is not the household's data. There is no restore:
the SQLite file stays the real backup, and this file is for keeping and for spreadsheets.
"""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session, selectinload

import money
from db import get_db
from models import Budget, Category, Rule, Setting, StandingAdjustment, Transaction

router = APIRouter(prefix="/reports", tags=["reports"])

BACKUP_FORMAT = 1


def _value(enum_or_str):
    return enum_or_str.value if hasattr(enum_or_str, "value") else enum_or_str


def _iso(d):
    return d.isoformat() if d is not None else None


def build_backup(db: Session, now: datetime | None = None) -> dict:
    now = now or datetime.now(timezone.utc)
    transactions = (
        db.query(Transaction)
        .options(selectinload(Transaction.splits))
        .order_by(Transaction.id)
        .all()
    )
    return {
        "app": "finances",
        "format": BACKUP_FORMAT,
        "exported_at": now.isoformat(timespec="seconds"),
        "settings": {s.key: s.value for s in db.query(Setting).order_by(Setting.key).all()},
        "categories": [
            {"id": c.id, "name": c.name, "type": _value(c.type), "sort_order": c.sort_order}
            for c in db.query(Category).order_by(Category.id).all()
        ],
        # month is the label month's first day; null is the default template.
        "budgets": [
            {
                "id": b.id,
                "category_id": b.category_id,
                "month": _iso(b.month),
                "planned_amount_cents": money.to_cents(b.planned_amount),
            }
            for b in db.query(Budget).order_by(Budget.id).all()
        ],
        "rules": [
            {"id": r.id, "pattern": r.pattern, "category_id": r.category_id, "priority": r.priority}
            for r in db.query(Rule).order_by(Rule.id).all()
        ],
        "standing_adjustments": [
            {
                "id": a.id,
                "name": a.name,
                "amount_cents": money.to_cents(a.amount),
                "income_category_id": a.income_category_id,
                "expense_category_id": a.expense_category_id,
                "active": bool(a.active),
                "start_month": _iso(a.start_month),
            }
            for a in db.query(StandingAdjustment).order_by(StandingAdjustment.id).all()
        ],
        "transactions": [
            {
                "id": t.id,
                "date": _iso(t.date),
                "amount_cents": money.to_cents(t.amount),
                "description": t.description,
                "source": _value(t.source),
                "category_id": t.category_id,
                "confirmed": bool(t.confirmed),
                "categorised_by": _value(t.categorised_by) if t.categorised_by else None,
                "ai_confidence": t.ai_confidence,
                "import_hash": t.import_hash,
                "is_refund": bool(t.is_refund),
                "standing_adjustment_id": t.standing_adjustment_id,
                # A part with no flag of its own follows the transaction, as everywhere else.
                "splits": [
                    {
                        "id": s.id,
                        "category_id": s.category_id,
                        "amount_cents": money.to_cents(s.amount),
                        "is_refund": bool(t.is_refund if s.is_refund is None else s.is_refund),
                    }
                    for s in t.splits
                ],
            }
            for t in transactions
        ],
    }


@router.get("/backup")
def backup(db: Session = Depends(get_db)):
    now = datetime.now(timezone.utc)
    return JSONResponse(
        build_backup(db, now),
        headers={
            "Content-Disposition": f'attachment; filename="finances-backup-{now.date().isoformat()}.json"',
            "Cache-Control": "no-store",
        },
    )
