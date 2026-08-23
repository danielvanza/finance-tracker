from datetime import date, timedelta


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

    if start_day == 1:
        # Normal calendar month: 1st to last day of month
        start_date = date(year, month, 1)
        # Last day = first day of next month minus one day
        if month == 12:
            end_date = date(year + 1, 1, 1) - timedelta(days=1)
        else:
            end_date = date(year, month + 1, 1) - timedelta(days=1)
        return start_date, end_date

    # Financial month: previous month's start_day to this month's (start_day - 1)
    # Start date is in the previous month
    if month == 1:
        prev_year, prev_month = year - 1, 12
    else:
        prev_year, prev_month = year, month - 1

    start_date = date(prev_year, prev_month, start_day)
    end_date = date(year, month, start_day - 1)
    return start_date, end_date


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
        return d.year, d.month

    if d.day >= start_day:
        if d.month == 12:
            return d.year + 1, 1
        return d.year, d.month + 1

    return d.year, d.month
