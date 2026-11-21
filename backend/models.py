from datetime import datetime, timezone
from sqlalchemy import Column, Integer, String, Text, JSON, LargeBinary, DateTime, Index, Numeric, Date, Boolean, Float, ForeignKey, UniqueConstraint, Enum as SAEnum
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
    # What the bank wrote with the payment, whole. NULL for a manual entry and for a row imported
    # before notes were kept; importing its file again fills it in.
    note = Column(Text, nullable=True)
    source = Column(SAEnum(TransactionSource), nullable=False)
    category_id = Column(Integer, ForeignKey("categories.id", ondelete="SET NULL"), nullable=True)
    confirmed = Column(Boolean, default=False)
    categorised_by = Column(SAEnum(CategorisedBy), nullable=True)
    ai_confidence = Column(Float, nullable=True)
    import_hash = Column(String, nullable=False, unique=True)
    # A positive amount marked as refund nets against its expense category
    # instead of counting as income.
    is_refund = Column(Boolean, nullable=False, default=False, server_default="0")
    # What Claude would also consider for a row it was not sure about, as category ids. NULL means the
    # row has not been judged sure-or-doubtful yet; a list (even an empty one) means it has.
    ai_options = Column(JSON, nullable=True)
    # The bill that does not come monthly this payment settles. Such a payment comes out of what was set
    # aside and counts in no month's spending.
    set_aside_id = Column(Integer, ForeignKey("set_asides.id", ondelete="SET NULL"), nullable=True)
    category = relationship("Category", back_populates="transactions")
    splits = relationship(
        "TransactionSplit",
        back_populates="transaction",
        cascade="all, delete-orphan",
        order_by="TransactionSplit.id",
    )
    set_aside = relationship("SetAside", back_populates="payments")

class TransactionSplit(Base):
    __tablename__ = "transaction_splits"
    id = Column(Integer, primary_key=True)
    transaction_id = Column(
        Integer, ForeignKey("transactions.id", ondelete="CASCADE"), nullable=False
    )
    category_id = Column(Integer, ForeignKey("categories.id", ondelete="SET NULL"), nullable=True)
    amount = Column(Numeric(12, 2), nullable=False)
    # v2: BOOLEAN NULL — NULL means inherit parent transaction.is_refund
    # (backward compatible); set explicitly when a single part of a split
    # is a refund.
    is_refund = Column(Boolean, nullable=True)
    transaction = relationship("Transaction", back_populates="splits")
    category = relationship("Category")

class SetAside(Base):
    """A bill that does not come monthly, spread over the months before it is due."""
    __tablename__ = "set_asides"
    id = Column(Integer, primary_key=True)
    name = Column(String, nullable=False)
    amount = Column(Numeric(12, 2), nullable=False)
    start_month = Column(Date, nullable=False)  # label month (1st) setting aside began
    due_month = Column(Date, nullable=False)  # label month (1st) the bill is first due
    every_months = Column(Integer, nullable=True)  # it comes back every this many months (12: yearly); NULL: once
    payments = relationship("Transaction", back_populates="set_aside")


class AskShop(Base):
    """A shop whose payments differ every time (a shop that sells a bit of everything): never sorted by
    itself, never remembered as a rule, each payment asked about on its own."""
    __tablename__ = "ask_shops"
    pattern = Column(String, primary_key=True)  # as guesses.shop_pattern gives it


class IgnoredBill(Base):
    """A repeating payment a person said is not a fixed bill, by its recurring key."""
    __tablename__ = "ignored_bills"
    key = Column(String, primary_key=True)


class Rule(Base):
    __tablename__ = "rules"
    id = Column(Integer, primary_key=True)
    pattern = Column(String, nullable=False)
    category_id = Column(Integer, ForeignKey("categories.id", ondelete="CASCADE"), nullable=False)
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




class RemovedBankRow(Base):
    """An imported bank row a person had removed (a duplicate, a wrong row). A later import of the same
    file counts it as already here, so it does not come back. Undoing the removal drops this row."""
    __tablename__ = "removed_bank_rows"
    import_hash = Column(String, primary_key=True)  # the removed row's import_hash
    date = Column(Date, nullable=False)
    amount = Column(Numeric(12, 2), nullable=False)
    description = Column(String, nullable=False)


class AppliedChange(Base):
    """What an applied chat card changed, so it can be undone: for each row it touched in
    `assistant.actions._TABLES`, the row before and after (`rows`: [{table, key, before, after}], None for a
    row that was not there)."""
    __tablename__ = "applied_changes"
    id = Column(Integer, primary_key=True)
    card_id = Column(Integer, nullable=False, unique=True)  # the bot kit's card id
    op = Column(String, nullable=False)
    rows = Column(JSON, nullable=False)
    applied_at = Column(DateTime, nullable=False)
    undone_at = Column(DateTime, nullable=True)
