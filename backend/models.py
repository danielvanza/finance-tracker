from sqlalchemy import Column, Integer, String, Numeric, Date, Boolean, Float, ForeignKey, UniqueConstraint, Enum as SAEnum
from sqlalchemy.orm import relationship
from db import Base
import enum

class CategoryType(str, enum.Enum):
    needs = "needs"
    wants = "wants"
    savings = "savings"
    income = "income"
    exclude = "exclude"

class TransactionSource(str, enum.Enum):
    ing = "ing"
    revolut = "revolut"
    degiro = "degiro"
    manual = "manual"

class CategorisedBy(str, enum.Enum):
    rule = "rule"
    ai = "ai"
    manual = "manual"

class Category(Base):
    __tablename__ = "categories"
    id = Column(Integer, primary_key=True)
    name = Column(String, nullable=False, unique=True)
    type = Column(SAEnum(CategoryType), nullable=False)
    sort_order = Column(Integer, default=0)
    transactions = relationship("Transaction", back_populates="category")
    rules = relationship("Rule", back_populates="category")
    budgets = relationship("Budget", back_populates="category")

class Transaction(Base):
    __tablename__ = "transactions"
    id = Column(Integer, primary_key=True)
    date = Column(Date, nullable=False)
    amount = Column(Numeric(12, 2), nullable=False)
    description = Column(String, nullable=False)
    source = Column(SAEnum(TransactionSource), nullable=False)
    category_id = Column(Integer, ForeignKey("categories.id", ondelete="SET NULL"), nullable=True)
    confirmed = Column(Boolean, default=False)
    categorised_by = Column(SAEnum(CategorisedBy), nullable=True)
    ai_confidence = Column(Float, nullable=True)
    import_hash = Column(String, nullable=False, unique=True)
    # A positive amount marked as refund nets against its expense category
    # instead of counting as income.
    is_refund = Column(Boolean, nullable=False, default=False, server_default="0")
    standing_adjustment_id = Column(
        Integer, ForeignKey("standing_adjustments.id", ondelete="SET NULL"), nullable=True
    )
    category = relationship("Category", back_populates="transactions")
    splits = relationship(
        "TransactionSplit",
        back_populates="transaction",
        cascade="all, delete-orphan",
        order_by="TransactionSplit.id",
    )
    standing_adjustment = relationship("StandingAdjustment", back_populates="transactions")

class TransactionSplit(Base):
    __tablename__ = "transaction_splits"
    id = Column(Integer, primary_key=True)
    transaction_id = Column(
        Integer, ForeignKey("transactions.id", ondelete="CASCADE"), nullable=False
    )
    category_id = Column(Integer, ForeignKey("categories.id", ondelete="SET NULL"), nullable=True)
    amount = Column(Numeric(12, 2), nullable=False)
    transaction = relationship("Transaction", back_populates="splits")
    category = relationship("Category")

class StandingAdjustment(Base):
    """Template for a net-zero manual pair materialised into each financial month
    (e.g. +600 retained salary / -600 personal allowance)."""
    __tablename__ = "standing_adjustments"
    id = Column(Integer, primary_key=True)
    name = Column(String, nullable=False, unique=True)
    amount = Column(Numeric(12, 2), nullable=False)  # positive; legs are +amount/-amount
    income_category_id = Column(Integer, ForeignKey("categories.id", ondelete="CASCADE"), nullable=False)
    expense_category_id = Column(Integer, ForeignKey("categories.id", ondelete="CASCADE"), nullable=False)
    active = Column(Boolean, nullable=False, default=True, server_default="1")
    # First label month (1st of month) this adjustment applies to — months
    # before it never materialise, so history isn't rewritten retroactively.
    start_month = Column(Date, nullable=False)
    transactions = relationship("Transaction", back_populates="standing_adjustment")
    income_category = relationship("Category", foreign_keys=[income_category_id])
    expense_category = relationship("Category", foreign_keys=[expense_category_id])

class Rule(Base):
    __tablename__ = "rules"
    id = Column(Integer, primary_key=True)
    pattern = Column(String, nullable=False)
    category_id = Column(Integer, ForeignKey("categories.id", ondelete="CASCADE"), nullable=False)
    priority = Column(Integer, default=0)
    category = relationship("Category", back_populates="rules")

class Budget(Base):
    __tablename__ = "budgets"
    id = Column(Integer, primary_key=True)
    category_id = Column(Integer, ForeignKey("categories.id", ondelete="CASCADE"), nullable=False)
    month = Column(Date, nullable=True)  # NULL = default template
    planned_amount = Column(Numeric(12, 2), nullable=False)
    __table_args__ = (UniqueConstraint("category_id", "month"),)
    category = relationship("Category", back_populates="budgets")

class Setting(Base):
    __tablename__ = "settings"
    key = Column(String(100), primary_key=True)
    value = Column(String(500), nullable=False)
