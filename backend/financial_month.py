from datetime import date, timedelta


class MonthStarts(int):
    """A start day (1-28) that also carries the dates chosen for single months.

    `overrides` maps a label (year, month) to the date that financial month begins. It works wherever a plain
    start day is accepted; the two functions below use the overrides when present."""

    def __new__(cls, day: int, overrides: dict[tuple[int, int], date] | None = None):
        obj = super().__new__(cls, day)
        obj.overrides = dict(overrides or {})
        return obj


def anchor_month(year: int, month: int, start_day: int) -> tuple[int, int]:
    """The calendar month (year, month) that holds the start of financial month (year, month)."""
    if start_day == 1:
        return year, month
    return (year - 1, 12) if month == 1 else (year, month - 1)


def month_start(year: int, month: int, start_day: int) -> date:
    """The first day of financial month (year, month): the date chosen for it, else the start day."""
    chosen = getattr(start_day, "overrides", {}).get((year, month))
    if chosen is not None:
        return chosen
    anchor_year, anchor = anchor_month(year, month, start_day)
    return date(anchor_year, anchor, 1 if start_day == 1 else start_day)


def _next_label(year: int, month: int) -> tuple[int, int]:
    return (year + 1, 1) if month == 12 else (year, month + 1)


def get_financial_month_range(year: int, month: int, start_day: int) -> tuple[date, date]:
    """Convert a financial month label (year, month) + start_day into a date range.

    "April 2026" with start_day=24 means Mar 24 – Apr 23.
    When start_day=1, the range is the normal calendar month.

    Args:
        year: The label year (e.g. 2026).
        month: The label month (1-12).
        start_day: Day of month when the financial period begins (1-28).

    Returns:
        (start_date, end_date) inclusive on both ends.

    Raises:
        ValueError: If start_day is not between 1 and 28.
    """
    if not 1 <= start_day <= 28:
        raise ValueError("start_day must be between 1 and 28")

    return month_start(year, month, start_day), month_start(*_next_label(year, month), start_day) - timedelta(days=1)


def label_month_for_date(d: date, start_day: int) -> tuple[int, int]:
    """Find the financial-month label (year, month) whose range contains d.

    Inverse of get_financial_month_range: the returned label satisfies
    get_financial_month_range(year, month, start_day) inclusive-bounds d.
    With start_day=24, Apr 10 belongs to label April (whose range is
    Mar 24 – Apr 23).

    Args:
        d: The date to map to a financial-month label.
        start_day: Day of month when the financial period begins (1-28).

    Returns:
        (year, month) label of the financial month containing d.

    Raises:
        ValueError: If start_day is not between 1 and 28.
    """
    if not 1 <= start_day <= 28:
        raise ValueError("start_day must be between 1 and 28")

    if start_day == 1:
        guess = (d.year, d.month)
    elif d.day >= start_day:
        guess = _next_label(d.year, d.month)
    else:
        guess = (d.year, d.month)
    if not getattr(start_day, "overrides", None):
        return guess
    before = (guess[0] - 1, 12) if guess[1] == 1 else (guess[0], guess[1] - 1)
    for label in (before, guess, _next_label(*guess)):
        start, end = get_financial_month_range(*label, start_day)
        if start <= d <= end:
            return label
    return guess
