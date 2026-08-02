from pydantic import BaseModel, ConfigDict
from decimal import Decimal
from datetime import date
from typing import Optional

class ParsedTransactionOut(BaseModel):
    date: date
    amount: Decimal
    description: str
    source: str
    import_hash: str
    duplicate: bool = False

class ImportPreviewResponse(BaseModel):
    rows: list[ParsedTransactionOut]
    total: int
    duplicates: int

class ImportConfirmResponse(BaseModel):
    imported: int
    skipped_duplicates: int
    categorised_by_rule: int
    categorised_by_ai: int
    uncategorised: int

class SplitIn(BaseModel):
    category_id: int
    amount: Decimal

class SplitOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    category_id: Optional[int]
    category_name: Optional[str]
    amount: Decimal

class TransactionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    date: date
    amount: Decimal
    description: str
    source: str
    category_id: Optional[int]
    category_name: Optional[str]
    confirmed: bool
    categorised_by: Optional[str]
    ai_confidence: Optional[float]
    is_refund: bool = False
    standing_adjustment_id: Optional[int] = None
    splits: list[SplitOut] = []

class TransactionPatch(BaseModel):
    category_id: Optional[int] = None
    confirmed: Optional[bool] = None
    is_refund: Optional[bool] = None
    # None = leave splits untouched; [] = unsplit; 2+ items = replace splits
    splits: Optional[list[SplitIn]] = None

class TransactionCreate(BaseModel):
    date: date
    amount: Decimal
    description: str
    category_id: int
    is_refund: bool = False

class AdjustmentLeg(BaseModel):
    amount: Decimal
    category_id: int
    description: Optional[str] = None

class AdjustmentPairCreate(BaseModel):
    date: date
    description: str
    legs: list[AdjustmentLeg]

class StandingAdjustmentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    amount: Decimal
    income_category_id: int
    expense_category_id: int
    active: bool
    start_month: date

class StandingAdjustmentCreate(BaseModel):
    name: str
    amount: Decimal
    income_category_id: int
    expense_category_id: int
    active: bool = True
    start_month: Optional[date] = None  # defaults to the current month

class StandingAdjustmentPatch(BaseModel):
    name: Optional[str] = None
    amount: Optional[Decimal] = None
    income_category_id: Optional[int] = None
    expense_category_id: Optional[int] = None
    active: Optional[bool] = None
    start_month: Optional[date] = None

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
    model_config = ConfigDict(from_attributes=True)

    id: int
    category_id: int
    category_name: str
    month: Optional[date]
    planned_amount: Decimal
    actual_amount: Optional[Decimal] = None

class BudgetPatch(BaseModel):
    planned_amount: Decimal

class RuleOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    pattern: str
    category_id: int
    category_name: str
    priority: int

class RuleCreate(BaseModel):
    pattern: str
    category_id: int
    priority: int = 0

class RuleUpdate(BaseModel):
    pattern: Optional[str] = None
    category_id: Optional[int] = None
    priority: Optional[int] = None

class RuleTestRequest(BaseModel):
    pattern: str

class DashboardSummary(BaseModel):
    month: str
    total_income: Decimal
    total_expenses: Decimal
    total_savings: Decimal
    left_over: Decimal
    category_breakdown: list[dict]
    income_breakdown: list[dict]
    needs_wants_savings: dict
    monthly_trend: list[dict]

class SettingOut(BaseModel):
    key: str
    value: str

class SettingPatch(BaseModel):
    value: str
