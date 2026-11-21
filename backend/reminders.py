"""Reminders the household asked the chat to set ("remind us on the 25th to move money to savings").

A reminder is a message in the Telegram group at a set time. It is sent once, at the first moment outside the quiet
hours after that time, from the same background loop as the other unasked messages (nudges.tick): a reminder missed
while the app was down goes out once, not once per missed time, and a repeating one then moves to its next future
time. A reminder that does not repeat is kept, finished (`next_at` empty), so the chat can still say it was sent.

`anchor_at` is the time as it was asked for. A monthly reminder asked for on the 31st goes out on the last day of a
shorter month and on the 31st again after it, which is why later times are counted from the anchor and not from the
time before.
"""
import calendar
import logging
from datetime import datetime, timedelta

import clock
from db import SessionLocal
from models import Reminder

logger = logging.getLogger(__name__)

CHANNEL = "telegram"
DEFAULT_HOUR = 9  # a date alone means 9:00
EVERY = ("week", "month", "year")
MAX_TEXT = 300


def occurrence(anchor: datetime, every: str, n: int) -> datetime:
    """The n-th time after the anchor (0 is the anchor itself). A day that a month does not have falls back to
    the month's last day."""
    if every == "week":
        return anchor + timedelta(days=7 * n)
    months = (n if every == "month" else 12 * n) + anchor.month - 1
    year, month = anchor.year + months // 12, months % 12 + 1
    return anchor.replace(year=year, month=month, day=min(anchor.day, calendar.monthrange(year, month)[1]))


def next_after(anchor: datetime, every: str, ref: datetime, inclusive: bool = False) -> datetime:
    """The first time of a repeating reminder after `ref` (at or after it when `inclusive`)."""
    n = 0
    while True:
        at = occurrence(anchor, every, n)
        if at > ref or (inclusive and at == ref):
            return at
        n += 1


def minute(now: datetime) -> datetime:
    return now.replace(second=0, microsecond=0)


def _post(reminder: Reminder) -> None:
    from assistant.questions import _bot  # the bot needs the assistant's modules, so it is reached at call time

    # Not through questions.post_nudge: that replaces what nobody has been shown yet, and a reminder must not be lost.
    _bot().post(CHANNEL, "reminder", reminder.text, {"reminder_id": reminder.id}, unasked=True)


def send_due(now: datetime | None = None) -> int:
    """Send every reminder whose time has come, unless it is night for the household. Returns how many went out.

    Nothing is sent that cannot be posted: a reminder that failed to post stays due and is tried again next round.
    """
    now = now or clock.now()
    if clock.quiet_hours(now):
        return 0
    sent = 0
    with SessionLocal() as db:
        due = (
            db.query(Reminder).filter(Reminder.next_at.isnot(None), Reminder.next_at <= now)
            .order_by(Reminder.next_at, Reminder.id).all()
        )
        for reminder in due:
            try:
                _post(reminder)
            except Exception:
                logger.exception("[reminders] could not post a reminder")
                continue
            reminder.last_sent_at = now
            reminder.next_at = next_after(reminder.anchor_at, reminder.every, now) if reminder.every else None
            db.commit()
            sent += 1
    return sent
