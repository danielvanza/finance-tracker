"""Money conversion helpers for the v2 wire format.

Decision: monetary values cross the API boundary as integer cents
(`*_cents` fields), eliminating float/Decimal ambiguity in JSON payloads.
The database stays Numeric(12, 2) (Decimal euros); conversions happen at
the schema boundary via to_cents()/to_decimal().
"""
from decimal import Decimal, ROUND_HALF_UP

_CENT = Decimal("0.01")


def to_cents(value) -> int:
    """Decimal|float|str|int (euros) -> integer cents. Quantize HALF_UP."""
    if isinstance(value, bool):
        raise TypeError("bool is not a monetary value")
    if isinstance(value, int):
        d = Decimal(value)
    elif isinstance(value, Decimal):
        d = value
    else:
        d = Decimal(str(float(value)))  # kills float binary noise: 19.99 -> '19.99'
    return int(d.quantize(_CENT, rounding=ROUND_HALF_UP) * 100)


def to_decimal(cents: int) -> Decimal:
    """integer cents -> Decimal euros quantized to 0.01."""
    if isinstance(cents, bool) or not isinstance(cents, int):
        raise TypeError("cents must be an int")
    return (Decimal(cents) / 100).quantize(_CENT)
