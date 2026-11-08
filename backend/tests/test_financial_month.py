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


def test_label_month_start_day_1_identity():
    from financial_month import label_month_for_date
    assert label_month_for_date(date(2026, 4, 17), 1) == (2026, 4)
    assert label_month_for_date(date(2025, 12, 31), 1) == (2025, 12)
    assert label_month_for_date(date(2026, 1, 1), 1) == (2026, 1)


def test_label_month_day_on_or_after_start_day_rolls_next():
    from financial_month import label_month_for_date
    assert label_month_for_date(date(2026, 3, 24), 24) == (2026, 4)
    assert label_month_for_date(date(2026, 4, 30), 15) == (2026, 5)


def test_label_month_day_before_start_day_stays_same_label():
    from financial_month import label_month_for_date
    # Apr 10 lies inside label-April's range (Mar 24 - Apr 23), so (2026, 4)
    assert label_month_for_date(date(2026, 4, 10), 24) == (2026, 4)
    # Mar 23 lies inside label-March's range (Feb 24 - Mar 23), so (2026, 3)
    assert label_month_for_date(date(2026, 3, 23), 24) == (2026, 3)


def test_label_month_december_to_january_rollover_both_ways():
    from financial_month import label_month_for_date
    # Late December rolls forward into next year's January label
    assert label_month_for_date(date(2026, 12, 24), 24) == (2027, 1)
    # Early January stays inside next year's January label (range Dec 24 - Jan 23)
    assert label_month_for_date(date(2027, 1, 5), 24) == (2027, 1)


def test_label_month_invalid_start_day_raises():
    from financial_month import label_month_for_date
    with pytest.raises(ValueError, match="start_day must be between 1 and 28"):
        label_month_for_date(date(2026, 4, 10), 0)
    with pytest.raises(ValueError, match="start_day must be between 1 and 28"):
        label_month_for_date(date(2026, 4, 10), 29)


def test_round_trip_both_endpoints():
    from financial_month import get_financial_month_range, label_month_for_date
    cases = [
        (2025, 12, 24),
        (2026, 1, 24),
        (2026, 1, 28),
        (2026, 4, 24),
        (2026, 4, 1),
        (2026, 11, 15),
        (2026, 12, 28),
    ]
    for y, m, sd in cases:
        start, end = get_financial_month_range(y, m, sd)
        assert label_month_for_date(start, sd) == (y, m)
        assert label_month_for_date(end, sd) == (y, m)
