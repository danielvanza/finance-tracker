import pytest
from datetime import date


def test_mid_month_start_day():
    from financial_month import get_financial_month_range
    start, end = get_financial_month_range(2026, 4, 24)
    assert start == date(2026, 3, 24)
    assert end == date(2026, 4, 23)


def test_start_day_1_is_normal_calendar_month():
    from financial_month import get_financial_month_range
    start, end = get_financial_month_range(2026, 4, 1)
    assert start == date(2026, 4, 1)
    assert end == date(2026, 4, 30)


def test_start_day_28():
    from financial_month import get_financial_month_range
    start, end = get_financial_month_range(2026, 3, 28)
    assert start == date(2026, 2, 28)
    assert end == date(2026, 3, 27)


def test_year_rollover_january():
    from financial_month import get_financial_month_range
    start, end = get_financial_month_range(2026, 1, 24)
    assert start == date(2025, 12, 24)
    assert end == date(2026, 1, 23)


def test_year_rollover_december():
    from financial_month import get_financial_month_range
    start, end = get_financial_month_range(2026, 12, 24)
    assert start == date(2026, 11, 24)
    assert end == date(2026, 12, 23)


def test_february_start_day_15():
    from financial_month import get_financial_month_range
    start, end = get_financial_month_range(2026, 2, 15)
    assert start == date(2026, 1, 15)
    assert end == date(2026, 2, 14)


def test_invalid_start_day_0_raises():
    from financial_month import get_financial_month_range
    with pytest.raises(ValueError, match="start_day must be between 1 and 28"):
        get_financial_month_range(2026, 4, 0)


def test_invalid_start_day_29_raises():
    from financial_month import get_financial_month_range
    with pytest.raises(ValueError, match="start_day must be between 1 and 28"):
        get_financial_month_range(2026, 4, 29)
