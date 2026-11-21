"""Settings that code outside a request reads: the clock, the nudge loop, the sorter.

Each is a row in the settings table that wins when set; the environment gives the default. They are read often
and from background threads, so the rows come through a short cache with a session of their own, and a database
that cannot be read never breaks the caller: it gets the default.
"""
import os
import threading
import time

CACHE_SECONDS = 30
FAILED_CACHE_SECONDS = 5
KEYS = ("nudges", "quiet_hours", "sort_model")
DEFAULT_QUIET_HOURS = "21-9"

_lock = threading.Lock()
_cache: tuple[float, dict[str, str]] | None = None


def forget() -> None:
    """Read the rows again on the next question (a setting just changed)."""
    global _cache
    with _lock:
        _cache = None


def _rows() -> dict[str, str]:
    global _cache
    with _lock:
        if _cache is not None and _cache[0] > time.monotonic():
            return _cache[1]
        try:
            from db import SessionLocal
            from models import Setting

            with SessionLocal() as db:
                found = {s.key: s.value for s in db.query(Setting).filter(Setting.key.in_(KEYS)).all()}
            _cache = (time.monotonic() + CACHE_SECONDS, found)
        except Exception:
            found = {}
            _cache = (time.monotonic() + FAILED_CACHE_SECONDS, found)
        return found


def defaults() -> dict[str, str]:
    """What applies while a setting is not set, from the environment alone (no database)."""
    return {
        "nudges": "off" if os.getenv("NUDGES", "on") == "off" else "on",
        "quiet_hours": DEFAULT_QUIET_HOURS,
        "sort_model": os.getenv("SORT_MODEL", "sonnet"),
    }


def nudges_on() -> bool:
    """Whether the bot may write unasked: the setting, else the NUDGES environment variable (on unless "off")."""
    value = _rows().get("nudges")
    return (value or defaults()["nudges"]) == "on"


def parse_quiet_hours(value: str) -> tuple[int, int] | None:
    """"21-9" as (21, 9): whole hours 0-23, from and until different. None if it is not that."""
    parts = value.strip().split("-")
    if len(parts) != 2 or not all(p.isdigit() and len(p) <= 2 for p in parts):
        return None
    start, end = int(parts[0]), int(parts[1])
    return (start, end) if start <= 23 and end <= 23 and start != end else None


def quiet_window() -> tuple[int, int]:
    """The hour the quiet hours start and the hour they end: the setting, else 21 and 9."""
    return parse_quiet_hours(_rows().get("quiet_hours", "")) or parse_quiet_hours(DEFAULT_QUIET_HOURS)  # type: ignore[return-value]


def sort_model() -> str:
    """The Claude model that sorts imported rows: the setting, else SORT_MODEL, else sonnet."""
    return _rows().get("sort_model") or defaults()["sort_model"]
