from sqlalchemy import Column, Integer, String, Numeric, Date, Boolean, Float, ForeignKey, UniqueConstraint, Enum as SAEnum
from sqlalchemy.orm import relationship
from db import Base
import enum

class CategoryType(str, enum.Enum):
    needs = "needs"
    wants = "wants"
    savings = "savings"
    income = "income"

class TransactionSource(str, enum.Enum):
    ing = "ing"
    revolut = "revolut"
    degiro = "degiro"

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
    category = relationship("Category", back_populates="transactions")

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
