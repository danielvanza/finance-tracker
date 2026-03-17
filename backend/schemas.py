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

class TransactionPatch(BaseModel):
    category_id: Optional[int] = None
    confirmed: Optional[bool] = None

class CategoryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    type: str
    sort_order: int

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
    needs_wants_savings: dict
    monthly_trend: list[dict]
