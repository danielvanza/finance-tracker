"""What day and time it is for the household. Everything that asks goes through here.

FINANCE_CLOCK_FILE names a file holding an ISO date-time; when set, that is "now". It exists so the
end-to-end checks can stand on a Sunday evening or at night without waiting for one.
"""
import os
from datetime import date, datetime
from zoneinfo import ZoneInfo

import runtime_settings

ZONE = ZoneInfo(os.getenv("FINANCE_TIMEZONE", "Europe/Amsterdam"))


def now() -> datetime:
    """The household's local time, without a zone attached."""
    path = os.getenv("FINANCE_CLOCK_FILE")
    if path:
        try:
            with open(path) as f:
                return datetime.fromisoformat(f.read().strip())
        except (OSError, ValueError):
            pass
    return datetime.now(ZONE).replace(tzinfo=None)


def today() -> date:
    return now().date()


def quiet_hours(at: datetime | None = None) -> bool:
    """Whether it is night for the household: nothing is sent unasked from 21:00 until 9:00, or between the hours
    of the `quiet_hours` setting."""
    start, end = runtime_settings.quiet_window()
    hour = (at or now()).hour
    return start <= hour < end if start < end else hour >= start or hour < end
