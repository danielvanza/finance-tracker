from decimal import Decimal

import pytest

from money import to_cents, to_decimal


def test_to_cents_from_float():
    assert to_cents(19.99) == 1999


def test_to_cents_rounds_half_up():
    assert to_cents(Decimal("20.005")) == 2001


def test_to_cents_negative_float():
    assert to_cents(-3.50) == -350


def test_to_cents_from_string():
    assert to_cents("12.34") == 1234


def test_to_cents_rejects_bool():
    with pytest.raises(TypeError):
        to_cents(True)


def test_to_decimal_positive():
    assert to_decimal(1999) == Decimal("19.99")


def test_to_decimal_negative():
    assert to_decimal(-350) == Decimal("-3.50")


def test_to_decimal_rejects_non_int():
    with pytest.raises(TypeError):
        to_decimal(1999.0)


@pytest.mark.parametrize("value", [
    Decimal("123.45"),
    Decimal("0.01"),
    Decimal("-99.99"),
    19.99,
    "42.00",
])
def test_round_trip(value):
    quantized = Decimal(str(value)).quantize(Decimal("0.01"))
    assert to_decimal(to_cents(value)) == quantized
