from decimal import Decimal
from datetime import date
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator, AliasChoices

from money import to_cents, to_decimal


def _as_cents(v):
    # int (and only int, not bool) is already cents under v2
    if isinstance(v, int) and not isinstance(v, bool):
        return v
    return to_cents(v)


def _as_cents_or_none(v):
    if v is None:
        return None
    return _as_cents(v)


def _as_euros(v):
    # int (and only int, not bool/float/str) means cents under v2;
    # Decimal/float/str are legacy euros
    if isinstance(v, int) and not isinstance(v, bool):
        return to_decimal(v)
    return v


class ParsedTransactionOut(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    date: date
    amount_cents: int = Field(
        validation_alias=AliasChoices("amount", "amount_cents"),
        serialization_alias="amount_cents",
    )
    description: str
    source: str
    import_hash: str
    duplicate: bool = False

    @field_validator("amount_cents", mode="before")
    @classmethod
    def _amount_to_cents(cls, v):
        return _as_cents(v)

class ImportPreviewResponse(BaseModel):
    rows: list[ParsedTransactionOut]
    total: int
    duplicates: int

class ImportConfirmResponse(BaseModel):
    imported: int
    skipped_duplicates: int
    categorised_by_rule: int
    categorised_by_ai: int  # Claude was sure: these count already
    doubtful: int  # Claude was not sure: these wait for an answer
    uncategorised: int

class SplitIn(BaseModel):
    category_id: int
    amount: Decimal = Field(validation_alias=AliasChoices("amount", "amount_cents"))

    @field_validator("amount", mode="before")
    @classmethod
    def _maybe_cents(cls, v):
        return _as_euros(v)

class SplitOut(BaseModel):
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    id: int
    category_id: Optional[int]
    category_name: Optional[str]
    amount_cents: int = Field(
        validation_alias=AliasChoices("amount", "amount_cents"),
        serialization_alias="amount_cents",
    )
    # NULL DB value means inherit-parent; parent-fallback resolution happens
    # upstream (aggregate.effective_parts), serializers expose resolved bools.
    is_refund: bool = False

    @field_validator("amount_cents", mode="before")
    @classmethod
    def _amount_to_cents(cls, v):
        return _as_cents(v)

    @field_validator("is_refund", mode="before")
    @classmethod
    def _null_refund_inherits(cls, v):
        return v if isinstance(v, bool) else bool(v) if v is not None else False

class TransactionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    id: int
    date: date
    amount_cents: int = Field(
        validation_alias=AliasChoices("amount", "amount_cents"),
        serialization_alias="amount_cents",
    )
    description: str
    source: str
    category_id: Optional[int]
    category_name: Optional[str]
    confirmed: bool
    categorised_by: Optional[str]
    ai_confidence: Optional[float]
    is_refund: bool = False
    set_aside_id: Optional[int] = None
    set_aside_name: Optional[str] = None
    splits: list[SplitOut] = []

    @field_validator("amount_cents", mode="before")
    @classmethod
    def _amount_to_cents(cls, v):
        return _as_cents(v)

class TransactionPatch(BaseModel):
    category_id: Optional[int] = None
    confirmed: Optional[bool] = None
    is_refund: Optional[bool] = None
    # None = leave splits untouched; [] = unsplit; 2+ items = replace splits
    splits: Optional[list[SplitIn]] = None

class TransactionCreate(BaseModel):
    date: date
    amount: Decimal = Field(validation_alias=AliasChoices("amount", "amount_cents"))
    description: str
    category_id: int
    is_refund: bool = False

    @field_validator("amount", mode="before")
    @classmethod
    def _maybe_cents(cls, v):
        return _as_euros(v)

class CategoryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    type: str
    sort_order: int

class CategoryCreate(BaseModel):
    name: str
    type: str
    sort_order: Optional[int] = None

class CategoryReorder(BaseModel):
    category_ids: list[int]

class BudgetRow(BaseModel):
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    id: int
    category_id: int
    category_name: str
    month: Optional[date]
    planned_amount_cents: int = Field(
        validation_alias=AliasChoices("planned_amount", "planned_amount_cents"),
        serialization_alias="planned_amount_cents",
    )
    actual_amount_cents: Optional[int] = Field(
        default=None,
        validation_alias=AliasChoices("actual_amount", "actual_amount_cents"),
        serialization_alias="actual_amount_cents",
    )

    @field_validator("planned_amount_cents", mode="before")
    @classmethod
    def _planned_to_cents(cls, v):
        return _as_cents(v)

    @field_validator("actual_amount_cents", mode="before")
    @classmethod
    def _actual_to_cents(cls, v):
        return _as_cents_or_none(v)

class BudgetPatch(BaseModel):
    planned_amount: Decimal = Field(
        validation_alias=AliasChoices("planned_amount", "planned_amount_cents")
    )

    @field_validator("planned_amount", mode="before")
    @classmethod
    def _maybe_cents(cls, v):
        return _as_euros(v)

class RuleOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    pattern: str
    category_id: int
    category_name: str

class RuleCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    pattern: str
    category_id: int

class RuleUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    pattern: Optional[str] = None
    category_id: Optional[int] = None

class SettingOut(BaseModel):
    key: str
    value: str

class SettingPatch(BaseModel):
    value: str
