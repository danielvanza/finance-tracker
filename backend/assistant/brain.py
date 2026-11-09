"""What Claude is given to work with, and running it."""
import json
import os
import re
import time
from datetime import date
from decimal import Decimal

from sqlalchemy import func
from sqlalchemy.orm import Session, selectinload

import money
import spend_service
from assistant.prompts import SYSTEM_PROMPT
from assistant.tools import Answer, Clarify, Insight, Propose, Toolbox  # noqa: F401 - the service reads replies from here
from categorizer import claude_cli
from financial_month import label_month_for_date
from models import (
    Budget, CategorisedBy, Category, ChatMessage, Rule, Setting, StandingAdjustment, Transaction,
)
from routers import dashboard as dashboard_router
from routers.budget import _auto_populate

MODEL = os.getenv("CHAT_MODEL", "sonnet")
TIMEOUT_SECONDS = 180  # the whole effort for one question, however many tool calls it takes
MIN_CALL_SECONDS = 5
RETRY_SECONDS = 20
HISTORY_MESSAGES = 12
RECENT_TRANSACTIONS = 40
RECENT_INCOMING = 25
MATCHED_TRANSACTIONS = 50
MAX_DESCRIPTION = 140
STOPWORDS = {
    "the", "and", "for", "from", "that", "this", "was", "were", "got", "has", "have", "had", "with", "but",
    "our", "you", "are", "how", "what", "when", "which", "one", "refund", "refunded", "paid", "payment",
    "money", "back", "een", "het", "van", "voor", "naar", "terug", "euro", "eur",
}

def _clip(text: str) -> str:
    return text if len(text) <= MAX_DESCRIPTION else text[:MAX_DESCRIPTION] + "…"


def _tx_row(tx: Transaction) -> dict:
    row = {
        "id": tx.id, "date": tx.date.isoformat(), "amount_cents": money.to_cents(tx.amount),
        "description": _clip(tx.description), "source": tx.source.value,
        "category": tx.category.name if tx.category else None,
        "category_id": tx.category_id, "reviewed": bool(tx.confirmed),
    }
    if tx.is_refund:
        row["is_refund"] = True
    if tx.splits:
        row["split"] = [
            {"category_id": s.category_id, "category": s.category.name if s.category else None,
             "amount_cents": money.to_cents(s.amount)}
            for s in tx.splits
        ]
    return row


def _amounts_in(text: str) -> set[int]:
    cents = set()
    for raw in re.findall(r"\d+(?:[.,]\d{1,2})?", text):
        cents.add(int(Decimal(raw.replace(",", ".")) * 100))
    return cents


def _words_in(text: str) -> set[str]:
    return {w for w in re.findall(r"[a-zà-ÿ0-9]{3,}", text.lower()) if w not in STOPWORDS}


def _transactions_for(db: Session, text: str, referenced: set[int]) -> list[dict]:
    """A bounded view of the ledger: what the words point at, what is recent, and recent incoming money."""
    everything = (
        db.query(Transaction).options(selectinload(Transaction.splits), selectinload(Transaction.category))
        .order_by(Transaction.date.desc(), Transaction.id.desc()).all()
    )
    words, amounts = _words_in(text), _amounts_in(text)

    def score(tx: Transaction) -> int:
        description = tx.description.lower()
        hits = sum(2 for w in words if w in description)
        if abs(money.to_cents(tx.amount)) in amounts:
            hits += 3
        return hits

    matched = sorted((t for t in everything if score(t) > 0), key=lambda t: -score(t))[:MATCHED_TRANSACTIONS]
    chosen = {t.id: t for t in matched}
    for t in everything[:RECENT_TRANSACTIONS]:
        chosen[t.id] = t
    for t in [t for t in everything if t.amount > 0][:RECENT_INCOMING]:
        chosen[t.id] = t
    for t in everything:
        if t.id in referenced:
            chosen[t.id] = t
    return [_tx_row(t) for t in sorted(chosen.values(), key=lambda t: (t.date, t.id), reverse=True)]


def _month_facts(db: Session) -> tuple[dict, list[dict], tuple[int, int]]:
    start_day = spend_service.get_start_day(db)
    year, mo = label_month_for_date(date.today(), start_day)
    label = f"{year}-{mo:02d}"
    pace = dashboard_router.pace(None, db)
    summary = dashboard_router.summary(label, db)
    left = pace["spendable_plan_cents"] - pace["spendable_actual_cents"]
    month = {
        "label": label, "from": pace["start_date"], "to": pace["end_date"], "today": pace["today"],
        "day_number": pace["day_number"], "days_left": pace["days_left"], "status": pace["status"],
        "data_through": pace["data_through"],
        "left_to_spend_cents": left,
        "spendable_plan_cents": pace["spendable_plan_cents"],
        "spendable_actual_cents": pace["spendable_actual_cents"],
        "pace_delta_cents": pace["pace_delta_cents"],
        "plan_cents": pace["plan_cents"], "actual_cents": pace["actual_cents"],
        "income_cents": summary["total_income_cents"],
        "expenses_cents": summary["total_expenses_cents"],
        "income_minus_spending_cents": summary["left_over_cents"],
        "to_review": pace["to_review"],
    }
    if pace["days_left"] is not None and left > 0:
        month["left_per_day_cents"] = left // (pace["days_left"] + 1)  # as the Month page says it
    recent = []
    y, m = year, mo
    for _ in range(3):
        y, m = (y - 1, 12) if m == 1 else (y, m - 1)
        s = dashboard_router.summary(f"{y}-{m:02d}", db)
        recent.append({
            "label": f"{y}-{m:02d}", "income_cents": s["total_income_cents"],
            "expenses_cents": s["total_expenses_cents"],
            "by_category": [
                {"category": c["category_name"], "spent_cents": c["actual_cents"]}
                for c in s["category_breakdown"]
            ],
        })
    return month, recent, (year, mo)


def _history_entry(message: ChatMessage) -> dict:
    entry = {"from": "person" if message.role == "user" else "assistant", "text": message.text}
    if message.proposal:
        entry["proposal"] = {"op": message.proposal.op, "args": message.proposal.args,
                             "status": message.proposal.status}
    if message.kind == "clarify" and message.payload:
        entry["options"] = [o["id"] for o in message.payload.get("options", [])]
    return entry


def history_of(db: Session, channel: str, before_id: int) -> list[ChatMessage]:
    rows = (
        db.query(ChatMessage).filter(ChatMessage.channel == channel, ChatMessage.id < before_id)
        .order_by(ChatMessage.id.desc()).limit(HISTORY_MESSAGES).all()
    )
    return list(reversed(rows))


def _referenced_ids(history: list[ChatMessage]) -> set[int]:
    ids: set[int] = set()
    for message in history:
        if message.kind == "clarify" and message.payload:
            ids |= {o["id"] for o in message.payload.get("options", [])}
        if message.proposal:
            for key in ("id", "refund_id", "purchase_id", "manual_id", "bank_id"):
                value = message.proposal.args.get(key)
                if isinstance(value, int):
                    ids.add(value)
    return ids


def build_prompt(db: Session, channel: str, message: ChatMessage) -> str:
    history = history_of(db, channel, message.id)
    month, recent_months, (year, mo) = _month_facts(db)
    _auto_populate(date(year, mo, 1), db)
    start, end = spend_service.financial_month_bounds(db, year, mo)
    parts = spend_service.confirmed_parts_in_range(db, start, end)
    spent = spend_service.spend_totals_by_category(parts)
    planned = {b.category_id: b.planned_amount for b in db.query(Budget).filter(Budget.month == date(year, mo, 1))}
    defaults = {b.category_id: b.planned_amount for b in db.query(Budget).filter(Budget.month == None)}  # noqa: E711

    guesses = (
        db.query(Transaction).options(selectinload(Transaction.splits), selectinload(Transaction.category))
        .filter(Transaction.confirmed == False, Transaction.categorised_by == CategorisedBy.ai)  # noqa: E712
        .order_by(Transaction.date.asc()).all()
    )
    uncategorised = db.query(func.count(Transaction.id)).filter(
        Transaction.confirmed == False, Transaction.category_id == None,  # noqa: E711,E712
    ).scalar()

    data = {
        "today": date.today().isoformat(),
        "month": month,
        "recent_months": recent_months,
        "categories": [
            {
                "id": c.id, "name": c.name, "type": c.type.value,
                "planned_this_month_cents": money.to_cents(planned[c.id]) if c.id in planned else None,
                "default_plan_cents": money.to_cents(defaults[c.id]) if c.id in defaults else None,
                "spent_this_month_cents": money.to_cents(spent.get(c.id, Decimal("0"))),
            }
            for c in db.query(Category).order_by(Category.sort_order).all()
        ],
        "rules": [
            {"id": r.id, "pattern": r.pattern, "category": r.category.name, "category_id": r.category_id,
             "priority": r.priority}
            for r in db.query(Rule).order_by(Rule.priority.desc()).all()
        ],
        "standing_adjustments": [
            {"id": s.id, "name": s.name, "amount_cents": money.to_cents(s.amount), "active": s.active,
             "income_category_id": s.income_category_id, "expense_category_id": s.expense_category_id,
             "start_month": s.start_month.isoformat()[:7]}
            for s in db.query(StandingAdjustment).all()
        ],
        "settings": {s.key: s.value for s in db.query(Setting).all()},
        "guesses": [_tx_row(t) for t in guesses],
        "uncategorised_awaiting_review": uncategorised,
        "transactions": _transactions_for(db, message.text, _referenced_ids(history)),
    }
    conversation = [_history_entry(m) for m in history]
    return (
        f"<data>\n{json.dumps(data, ensure_ascii=False)}\n</data>\n\n"
        f"<conversation>\n{json.dumps(conversation, ensure_ascii=False)}\n</conversation>\n\n"
        f"<new_message>\n{json.dumps(message.text, ensure_ascii=False)}\n</new_message>"
    )


class UnreadableReply(Exception):
    pass


class _Effort:
    """The clock for one question. Time spent queued behind another Claude run does not count."""

    def __init__(self) -> None:
        self._deadline = time.monotonic() + TIMEOUT_SECONDS
        self._waiting_since: float | None = None

    def on_wait(self, waiting: bool) -> None:
        if waiting:
            self._waiting_since = time.monotonic()
        elif self._waiting_since is not None:
            self._deadline += time.monotonic() - self._waiting_since
            self._waiting_since = None

    def left(self) -> float:
        return self._deadline - time.monotonic()


def decide(prompt: str, on_wait, on_digging=lambda: None) -> Answer | Clarify | Propose | Insight:
    """Let Claude work the reply out with its tools. Claude errors propagate, unless it had already dug."""
    effort = _Effort()

    def waited(waiting: bool) -> None:
        effort.on_wait(waiting)
        on_wait(waiting)

    with Toolbox(effort.left, on_digging) as toolbox:
        asked, timed_out = prompt, False
        for _ in range(2):
            said = ""
            try:
                said = claude_cli.complete(
                    SYSTEM_PROMPT, asked, MODEL, max(effort.left(), MIN_CALL_SECONDS), waited,
                    tools=toolbox.config, allowed_tools=toolbox.allowed_tools(),
                )
            except claude_cli.ClaudeCliError as e:
                timed_out = "stopped after" in str(e)
                if toolbox.decision is None and not (toolbox.dug and timed_out):
                    raise
            if toolbox.decision is not None:
                return toolbox.decision
            if timed_out or effort.left() < RETRY_SECONDS:
                break
            # The turn ended without a reply tool, so nobody saw it. Ask again, with what it already found.
            found = f"\n<query_results>\n{toolbox.results_so_far()}\n</query_results>" if toolbox.dug else ""
            asked = (
                f"{prompt}\n\n<previous_attempt>\nYour last turn ended without calling a reply tool, so the person saw "
                f"nothing. You had written:\n{said[:2000]}{found}\n</previous_attempt>\n\n"
                "Send your reply now by calling the tool that fits it."
            )
        if toolbox.dug:
            return toolbox.best_so_far(timed_out)
    raise UnreadableReply()
