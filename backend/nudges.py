"""What the bot says without being asked: old bank data, the weekly recap, and how a month ended.

Each is a few lines in the Telegram chat. A message is due from a moment on (Sunday 18:00, the first
morning of a financial month, the day the bank data turns a week old) and is sent once, at the first
moment outside the quiet hours after that; so a moment missed while the app was down is made up for
once, not once per missed moment, and whatever is owed together goes out as one message. A message the
chat could not be shown yet (the bot was off) is replaced by the next one, which says it all as of then.
What was last sent is kept in the settings table.
"""
import logging
import os
import threading
import time
from datetime import date, datetime, timedelta

from sqlalchemy import func

import clock
import spend_service
from assistant import actions, queries, service
from db import SessionLocal
from financial_month import get_financial_month_range, label_month_for_date
from models import Setting, Transaction, TransactionSource

logger = logging.getLogger(__name__)

CHANNEL = "telegram"
STALE_DAYS = 7
RECAP_WEEKDAY, RECAP_HOUR = 6, 18  # Sunday evening
CLOSE_HOUR = 9
TICK_SECONDS = float(os.getenv("NUDGE_TICK_SECONDS", "30"))
_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October",
           "November", "December"]


def _get(db, key: str) -> str | None:
    row = db.get(Setting, key)
    return row.value if row else None


def _set(db, key: str, value: str) -> None:
    row = db.get(Setting, key)
    if row:
        row.value = value
    else:
        db.add(Setting(key=key, value=value))


def _day(d: date) -> str:
    return f"{d.day} {_MONTHS[d.month - 1][:3]}"


def _newest_bank_date(db) -> date | None:
    return db.query(func.max(Transaction.date)).filter(Transaction.source == TransactionSource.ing).scalar()


def _is_stale(db, today: date) -> date | None:
    """The date the bank data runs to, if that is more than a week ago."""
    newest = _newest_bank_date(db)
    return newest if newest is not None and (today - newest).days > STALE_DAYS else None


# ---- The three messages -------------------------------------------------------------------------

def stale_text(newest: date, today: date) -> str:
    return (
        f"The bank data stops at {_day(newest)}, {(today - newest).days} days ago. "
        "Send a new ING export here when you can, and I will bring the month up to date."
    )


def _standouts(overview: dict) -> list[str]:
    """One or two things worth a line: the categories furthest over their plan, else the biggest spend."""
    rows = [c for c in overview["categories"] if c["type"] in ("needs", "wants")]
    over = sorted((c for c in rows if c["planned_cents"] and c["spent_cents"] > c["planned_cents"]),
                  key=lambda c: c["planned_cents"] - c["spent_cents"])
    lines = [
        f"{c['category']} is {actions.eur(c['spent_cents'] - c['planned_cents'])} over its plan "
        f"({actions.eur(c['spent_cents'])} of {actions.eur(c['planned_cents'])})."
        for c in over[:2]
    ]
    if not lines:
        spent = sorted((c for c in rows if c["spent_cents"] > 0), key=lambda c: -c["spent_cents"])
        if spent:
            top = spent[0]
            lines.append(f"Nothing is over its plan. Most went to {top['category']}: {actions.eur(top['spent_cents'])}"
                         + (f" of {actions.eur(top['planned_cents'])}." if top["planned_cents"] else "."))
    return lines


def recap_text(db, today: date) -> str:
    """The week's recap, at most six lines, with the Month page's own figures."""
    newest = _is_stale(db, today)
    if newest is not None:
        return (
            "This week's recap: I cannot say how the month is going, because the bank data stops at "
            f"{_day(newest)}.\nSend a new ING export here and I will catch up."
        )
    overview = queries.month_overview()
    if "free_to_spend_cents" not in overview:
        return "This week's recap: there is no bank data for this month yet, so there is nothing to report.\nSend an ING export here to start."
    free, per_day = overview["free_to_spend_cents"], overview.get("free_per_day_cents")
    days = overview["days_left_after_today"] + 1
    lines = ["This week's recap."]
    if free >= 0:
        lines.append(f"Free to spend until payday: {actions.eur(free)}"
                     + (f", about {actions.eur(per_day)} a day for {days} day{'' if days == 1 else 's'}." if per_day else "."))
    else:
        lines.append(f"The month is {actions.eur(-free)} over what was free to spend, with {days} day{'' if days == 1 else 's'} to go.")
    if overview["fixed_bills_still_to_come_cents"]:
        lines.append(f"That allows for {actions.eur(overview['fixed_bills_still_to_come_cents'])} of fixed bills still to come.")
    lines += _standouts(overview)
    waiting = overview["of_those_in_this_month"]
    if waiting:
        lines.append(f"{waiting} payment{'' if waiting == 1 else 's'} this month still wait{'s' if waiting == 1 else ''} for an answer and {'is' if waiting == 1 else 'are'} not counted.")
    return "\n".join(lines[:6])


def close_text(db, label: tuple[int, int]) -> str:
    """How the month that just ended went against the plan, in three or four lines."""
    name = _MONTHS[label[1] - 1]
    overview = queries.month_overview(f"{label[0]}-{label[1]:02d}")
    end = date.fromisoformat(overview["to"])
    newest = _newest_bank_date(db)
    if newest is None or overview["data"] != "bank files cover it":
        return f"{name} has ended, but there is no bank data for it, so I cannot say how it went.\nSend an ING export here and I will work it out."
    plan, spent = overview["spendable_plan_cents"], overview["spendable_spent_cents"]
    lines = [f"{name} has ended."]
    if spent <= plan:
        lines.append(f"Spent {actions.eur(spent)} of the {actions.eur(plan)} planned: {actions.eur(plan - spent)} under.")
    else:
        lines.append(f"Spent {actions.eur(spent)} against {actions.eur(plan)} planned: {actions.eur(spent - plan)} over.")
    lines.append(f"Income was {actions.eur(overview['income_cents'])}, and {actions.eur(overview['spent_cents']['savings'])} went to savings.")
    waiting = overview["of_those_in_this_month"]
    if newest < end:
        lines.append(f"The bank data only runs to {_day(newest)}, so the last days of the month are missing from this.")
    elif waiting:
        lines.append(f"{waiting} payment{'' if waiting == 1 else 's'} from {name} still wait{'s' if waiting == 1 else ''} for an answer and {'is' if waiting == 1 else 'are'} not counted.")
    else:
        lines += _standouts(overview)[:1]
    return "\n".join(lines[:4])


# ---- When each is due ---------------------------------------------------------------------------

def _recap_due(now: datetime) -> datetime:
    """The newest Sunday 18:00 that has passed."""
    day = now.date() - timedelta(days=(now.weekday() - RECAP_WEEKDAY) % 7)
    due = datetime(day.year, day.month, day.day, RECAP_HOUR)
    return due if due <= now else due - timedelta(days=7)


def tick(now: datetime | None = None) -> list[str]:
    """Send whatever is due and allowed right now. Returns which messages went out."""
    now = now or clock.now()
    sent: list[str] = []
    with SessionLocal() as db:
        start_day = spend_service.get_start_day(db)
        label = label_month_for_date(now.date(), start_day)
        month_start = get_financial_month_range(*label, start_day)[0]
        close_due = datetime(month_start.year, month_start.month, month_start.day, CLOSE_HOUR)
        recap_due = _recap_due(now)
        # The first time the app runs with these messages, nothing is owed for the past.
        if _get(db, "nudge_started") is None:
            _set(db, "nudge_started", now.isoformat(timespec="minutes"))
            if close_due <= now:
                _set(db, "nudge_close", f"{label[0]}-{label[1]:02d}")
            _set(db, "nudge_recap", recap_due.isoformat(timespec="minutes"))
            db.commit()
        if clock.quiet_hours(now):
            return sent

        # Everything owed at this moment goes out as one message, so the group is pinged once. That holds
        # for what was made earlier and nobody has been shown yet too (the bot was off, or had no group):
        # it is said again as of now, in the same one message.
        owed, waiting_text = service.waiting_nudge(CHANNEL)
        parts: list[str] = []
        kinds: list[str] = []
        this_month = f"{label[0]}-{label[1]:02d}"
        close_new = close_due <= now and (_get(db, "nudge_close") or "") < this_month
        if close_new or "close" in owed:
            previous = (label[0] - 1, 12) if label[1] == 1 else (label[0], label[1] - 1)
            parts.append(close_text(db, previous))
            kinds.append("close")
        if close_new:
            _set(db, "nudge_close", this_month)
            sent.append("close")

        newest = _is_stale(db, now.date())
        recap_new = (_get(db, "nudge_recap") or "") < recap_due.isoformat(timespec="minutes")
        if recap_new or "recap" in owed:
            parts.append(recap_text(db, now.date()))
            kinds.append("recap")
        if recap_new:
            _set(db, "nudge_recap", recap_due.isoformat(timespec="minutes"))
            sent.append("recap")

        if newest is not None:
            last = (_get(db, "nudge_stale") or "|").split("|")  # when it was said, and how far the data ran then
            said_at = datetime.fromisoformat(last[0]) if last[0] else None
            # Seven full days, so that a week after a Sunday recap said it, the next recap says it, not a
            # message of its own that morning.
            stale_new = said_at is None or now - said_at >= timedelta(days=STALE_DAYS) or last[1] != newest.isoformat()
            if stale_new or "stale" in owed:
                if "recap" not in kinds:  # a recap of old data already says where the data stops and what to send
                    parts.append(stale_text(newest, now.date()))
                kinds.append("stale")
            if stale_new or recap_new:  # said just now, in its own words or the recap's: not again for a week
                _set(db, "nudge_stale", f"{now.isoformat(timespec='minutes')}|{newest.isoformat()}")
            if stale_new:
                sent.append("stale")
        text = "\n\n".join(parts)
        if (parts and (sent or text != waiting_text)) or (owed and not parts):
            service.post_nudge(CHANNEL, text, {"nudge": "+".join(kinds), "unasked": True})
        db.commit()
    # Payments Claude was not sure of that nobody has been asked about yet, such as those from an import
    # made at night on the Import page: asked now that it is day.
    service.ask_questions(unasked=True)
    return sent


def _forever() -> None:
    while True:
        try:
            tick()
        except Exception:
            logger.exception("[nudges] a round failed")
        time.sleep(TICK_SECONDS)


def start() -> None:
    threading.Thread(target=_forever, name="nudges", daemon=True).start()
