# Household Finance Tracker Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local web app that imports bank CSV exports (ING, Revolut, DEGIRO), auto-categorises transactions via rules + Claude AI, and visualises planned vs actual household spending.

**Architecture:** FastAPI backend with SQLite via SQLAlchemy; React (Vite + TypeScript) frontend. Backend exposes a REST API consumed by the frontend. Categorisation runs server-side on import: rule engine first, Claude API fallback for unmatched transactions.

**Tech Stack:** Python 3.11+, FastAPI, SQLAlchemy, Anthropic SDK, pytest + httpx; React 18, Vite, TypeScript, Recharts, TanStack Query, React Router.

---

## File Map

```
household-finance/
├── .gitignore
├── backend/
│   ├── pyproject.toml            # Python deps (uv or pip)
│   ├── main.py                   # FastAPI app factory, CORS, router registration
│   ├── db.py                     # SQLAlchemy engine, session, Base
│   ├── models.py                 # ORM models: Category, Transaction, Rule, Budget
│   ├── schemas.py                # Pydantic request/response schemas
│   ├── seed.py                   # Initial category + default budget seed data
│   ├── importers/
│   │   ├── __init__.py
│   │   ├── base.py               # Abstract BaseImporter + ParsedTransaction dataclass
│   │   ├── ing.py                # ING CSV parser
│   │   ├── revolut.py            # Revolut CSV parser
│   │   └── degiro.py             # DEGIRO CSV parser
│   ├── categorizer/
│   │   ├── __init__.py
│   │   ├── rules.py              # Rule engine: match description → category
│   │   └── ai.py                 # Claude API categoriser with structured output
│   ├── routers/
│   │   ├── __init__.py
│   │   ├── dashboard.py          # GET /dashboard/summary
│   │   ├── imports.py            # POST /import/preview, POST /import/confirm
│   │   ├── transactions.py       # GET /transactions, PATCH /transactions/{id}, GET /transactions/review
│   │   ├── budget.py             # GET /budget, PATCH /budget/{id}, PATCH /budget/defaults/{cat_id}
│   │   └── rules.py              # CRUD /rules, POST /rules/test
│   └── tests/
│       ├── conftest.py           # Shared fixtures: test DB, test client, sample data
│       ├── test_importers.py     # ING, Revolut, DEGIRO CSV parsing
│       ├── test_categorizer.py   # Rule engine + AI fallback (Claude mocked)
│       ├── test_imports.py       # /import/preview and /import/confirm endpoints
│       ├── test_transactions.py  # /transactions endpoints
│       ├── test_budget.py        # /budget endpoints + auto-populate logic
│       ├── test_rules.py         # /rules CRUD + test endpoint
│       └── test_dashboard.py    # /dashboard/summary endpoint
├── frontend/
│   ├── package.json
│   ├── vite.config.ts            # Proxy /api → localhost:8000
│   ├── src/
│   │   ├── main.tsx
│   │   ├── App.tsx               # Router setup, Nav
│   │   ├── api.ts                # All fetch calls to backend
│   │   ├── types.ts              # Shared TypeScript interfaces
│   │   ├── pages/
│   │   │   ├── Dashboard.tsx
│   │   │   ├── Import.tsx
│   │   │   ├── Transactions.tsx
│   │   │   ├── Budget.tsx
│   │   │   └── Rules.tsx
│   │   └── components/
│   │       ├── Nav.tsx
│   │       ├── SummaryCards.tsx
│   │       ├── ReviewCard.tsx
│   │       └── TransactionTable.tsx
│   └── src/tests/
│       ├── ReviewCard.test.tsx
│       └── Import.test.tsx
└── data/                         # SQLite DB + uploads (gitignored)
```

---

## Task 1: Project Scaffolding

**Files:**
- Create: `.gitignore`
- Create: `backend/pyproject.toml`
- Create: `backend/main.py`
- Create: `backend/db.py`
- Create: `frontend/package.json`
- Create: `frontend/vite.config.ts`
- Create: `frontend/src/main.tsx`
- Create: `frontend/src/App.tsx`

- [ ] **Step 1: Create `.gitignore`**

```
data/
__pycache__/
*.pyc
.env
backend/.venv/
frontend/node_modules/
frontend/dist/
.superpowers/
```

- [ ] **Step 2: Create `backend/pyproject.toml`**

```toml
[project]
name = "household-finance"
version = "0.1.0"
requires-python = ">=3.11"
dependencies = [
    "fastapi>=0.111.0",
    "uvicorn[standard]>=0.29.0",
    "sqlalchemy>=2.0.0",
    "python-multipart>=0.0.9",
    "anthropic>=0.28.0",
    "pydantic>=2.0.0",
]

[project.optional-dependencies]
dev = [
    "pytest>=8.0.0",
    "httpx>=0.27.0",
    "pytest-asyncio>=0.23.0",
]
```

- [ ] **Step 3: Install backend deps**

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
```

- [ ] **Step 4: Create `backend/db.py`**

```python
from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker
import os

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./data/finance.db")

engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)

class Base(DeclarativeBase):
    pass

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
```

- [ ] **Step 5: Create `backend/main.py`**

```python
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from db import Base, engine

app = FastAPI(title="Household Finance")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

Base.metadata.create_all(bind=engine)

@app.get("/health")
def health():
    return {"status": "ok"}
```

- [ ] **Step 6: Verify backend starts**

```bash
cd backend && mkdir -p ../data
uvicorn main:app --reload
# Visit http://localhost:8000/health → {"status": "ok"}
```

- [ ] **Step 7: Scaffold frontend**

```bash
cd frontend
npm create vite@latest . -- --template react-ts
npm install
npm install react-router-dom @tanstack/react-query recharts
npm install -D vitest @testing-library/react @testing-library/jest-dom jsdom
```

- [ ] **Step 8: Add proxy to `frontend/vite.config.ts`**

```typescript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': { target: 'http://localhost:8000', rewrite: (p) => p.replace(/^\/api/, '') }
    }
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/tests/setup.ts'],
  }
})
```

- [ ] **Step 9: Create `frontend/src/tests/setup.ts`**

```typescript
import '@testing-library/jest-dom'
```

- [ ] **Step 10: Verify frontend starts**

```bash
cd frontend && npm run dev
# Visit http://localhost:5173 → Vite default page
```

- [ ] **Step 11: Commit**

```bash
git add .gitignore backend/ frontend/
git commit -m "feat: project scaffolding — FastAPI backend + Vite React frontend"
```

---

## Task 2: Database Models

**Files:**
- Create: `backend/models.py`
- Create: `backend/tests/conftest.py`

- [ ] **Step 1: Write failing test for models**

Create `backend/tests/conftest.py`:

```python
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from db import Base

@pytest.fixture(scope="function")
def db():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    session = Session()
    yield session
    session.close()
    Base.metadata.drop_all(engine)
```

Create `backend/tests/test_models.py`:

```python
from models import Category, Transaction, Rule, Budget
from decimal import Decimal
from datetime import date

def test_category_creation(db):
    cat = Category(name="Food - Essential", type="needs", sort_order=1)
    db.add(cat)
    db.commit()
    assert cat.id is not None
    assert cat.name == "Food - Essential"

def test_transaction_creation(db):
    cat = Category(name="Food", type="needs", sort_order=1)
    db.add(cat)
    db.commit()
    tx = Transaction(
        date=date(2026, 3, 1),
        amount=Decimal("-45.00"),
        description="Albert Heijn",
        source="ing",
        category_id=cat.id,
        confirmed=True,
        categorised_by="rule",
        import_hash="abc123",
    )
    db.add(tx)
    db.commit()
    assert tx.id is not None

def test_rule_creation(db):
    cat = Category(name="Food", type="needs", sort_order=1)
    db.add(cat)
    db.commit()
    rule = Rule(pattern="albert heijn", category_id=cat.id, priority=10)
    db.add(rule)
    db.commit()
    assert rule.id is not None

def test_budget_creation(db):
    cat = Category(name="Food", type="needs", sort_order=1)
    db.add(cat)
    db.commit()
    b = Budget(category_id=cat.id, month=None, planned_amount=Decimal("350.00"))
    db.add(b)
    db.commit()
    assert b.id is not None
```

- [ ] **Step 2: Run to verify failure**

```bash
cd backend && pytest tests/test_models.py -v
# Expected: ImportError or AttributeError (models not defined yet)
```

- [ ] **Step 3: Create `backend/models.py`**

```python
from sqlalchemy import Column, Integer, String, Numeric, Date, Boolean, Float, UniqueConstraint, Enum as SAEnum
from sqlalchemy.orm import relationship
from db import Base
import enum

class CategoryType(str, enum.Enum):
    needs = "needs"
    wants = "wants"
    savings = "savings"

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
    category_id = Column(Integer, nullable=True)
    confirmed = Column(Boolean, default=False)
    categorised_by = Column(SAEnum(CategorisedBy), nullable=True)
    ai_confidence = Column(Float, nullable=True)
    import_hash = Column(String, nullable=False, unique=True)
    category = relationship("Category", back_populates="transactions")

class Rule(Base):
    __tablename__ = "rules"
    id = Column(Integer, primary_key=True)
    pattern = Column(String, nullable=False)
    category_id = Column(Integer, nullable=False)
    priority = Column(Integer, default=0)
    category = relationship("Category", back_populates="rules")

class Budget(Base):
    __tablename__ = "budgets"
    id = Column(Integer, primary_key=True)
    category_id = Column(Integer, nullable=False)
    month = Column(Date, nullable=True)  # NULL = default template
    planned_amount = Column(Numeric(12, 2), nullable=False)
    __table_args__ = (UniqueConstraint("category_id", "month"),)
    category = relationship("Category", back_populates="budgets")
```

- [ ] **Step 4: Update `main.py` to import models**

Add after the `from db import Base, engine` line:

```python
import models  # noqa: F401 — ensures models are registered before create_all
```

- [ ] **Step 5: Run tests and verify pass**

```bash
cd backend && pytest tests/test_models.py -v
# Expected: 4 passed
```

- [ ] **Step 6: Commit**

```bash
git add backend/models.py backend/tests/
git commit -m "feat: SQLAlchemy models — Category, Transaction, Rule, Budget"
```

---

## Task 3: Seed Data

**Files:**
- Create: `backend/seed.py`
- Create: `backend/tests/test_seed.py`

- [ ] **Step 1: Write failing test**

```python
# backend/tests/test_seed.py
from seed import run_seed
from models import Category, Budget

def test_seed_creates_categories(db):
    run_seed(db)
    cats = db.query(Category).all()
    names = [c.name for c in cats]
    assert "Food - Essential" in names
    assert "Taxes & Mortgage" in names
    assert "DEGIRO" in names

def test_seed_categories_have_correct_types(db):
    run_seed(db)
    food = db.query(Category).filter_by(name="Food - Essential").first()
    assert food.type == "needs"
    entertainment = db.query(Category).filter_by(name="Recreation & Entertainment").first()
    assert entertainment.type == "wants"
    degiro = db.query(Category).filter_by(name="DEGIRO").first()
    assert degiro.type == "savings"

def test_seed_creates_default_budgets(db):
    run_seed(db)
    defaults = db.query(Budget).filter_by(month=None).all()
    assert len(defaults) > 0

def test_seed_is_idempotent(db):
    run_seed(db)
    run_seed(db)  # should not raise or duplicate
    cats = db.query(Category).all()
    names = [c.name for c in cats]
    assert names.count("Food - Essential") == 1
```

- [ ] **Step 2: Run to verify failure**

```bash
pytest tests/test_seed.py -v
# Expected: ImportError (seed.py not created)
```

- [ ] **Step 3: Create `backend/seed.py`**

```python
from decimal import Decimal
from sqlalchemy.orm import Session
from models import Category, Budget

CATEGORIES = [
    ("Taxes & Mortgage",         "needs",   1,  Decimal("2000")),
    ("Utilities",                "needs",   2,  Decimal("200")),
    ("Food - Essential",         "needs",   3,  Decimal("350")),
    ("Transportation",           "needs",   4,  Decimal("200")),
    ("Insurance",                "needs",   5,  Decimal("400")),
    ("Medical & Healthcare",     "needs",   6,  Decimal("100")),
    ("Food - Not Essential",     "wants",   7,  Decimal("200")),
    ("Recreation & Entertainment","wants",  8,  Decimal("100")),
    ("Miscellaneous",            "wants",   9,  Decimal("300")),
    ("DEGIRO",                   "savings", 10, Decimal("300")),
    ("Fun Account",              "savings", 11, Decimal("100")),
]

def run_seed(db: Session) -> None:
    for name, type_, order, default_amount in CATEGORIES:
        cat = db.query(Category).filter_by(name=name).first()
        if not cat:
            cat = Category(name=name, type=type_, sort_order=order)
            db.add(cat)
            db.flush()
        existing = db.query(Budget).filter_by(category_id=cat.id, month=None).first()
        if not existing:
            db.add(Budget(category_id=cat.id, month=None, planned_amount=default_amount))
    db.commit()
```

- [ ] **Step 4: Add seed call to `main.py` startup**

```python
from db import Base, engine, SessionLocal
import models  # noqa
from seed import run_seed

# After Base.metadata.create_all(bind=engine):
with SessionLocal() as session:
    run_seed(session)
```

- [ ] **Step 5: Run tests and verify pass**

```bash
pytest tests/test_seed.py -v
# Expected: 4 passed
```

- [ ] **Step 6: Commit**

```bash
git add backend/seed.py backend/tests/test_seed.py backend/main.py
git commit -m "feat: seed categories and default budgets"
```

---

## Task 4: CSV Importers

**Files:**
- Create: `backend/importers/base.py`
- Create: `backend/importers/ing.py`
- Create: `backend/importers/revolut.py`
- Create: `backend/importers/degiro.py`
- Create: `backend/tests/test_importers.py`

Use sample CSV fixtures embedded in the test (no real bank files needed).

- [ ] **Step 1: Write failing tests**

```python
# backend/tests/test_importers.py
import io
from decimal import Decimal
from datetime import date
from importers.ing import INGImporter
from importers.revolut import RevolutImporter
from importers.degiro import DEGIROImporter

ING_CSV = """Datum;Naam / Omschrijving;Rekening;Tegenrekening;Code;Af Bij;Bedrag (EUR);Mutatiesoort;Mededelingen
20260301;Albert Heijn;NL00INGB0000000000;NL00INGB0001111111;GT;Af;67,40;Betaalautomaat;
20260302;Salaris Bedrijf BV;NL00INGB0000000000;NL00INGB0002222222;OV;Bij;3460,26;Overschrijving;Maandloon
"""

REVOLUT_CSV = """Type,Product,Started Date,Completed Date,Description,Amount,Fee,Currency,State,Balance
CARD_PAYMENT,Current,2026-03-05 14:22:00,2026-03-05 14:22:01,Spotify,-9.99,0.00,EUR,COMPLETED,120.01
TRANSFER,Current,2026-03-06 09:00:00,2026-03-06 09:00:01,Top-up by *1234,500.00,0.00,EUR,COMPLETED,620.01
"""

DEGIRO_CSV = """Date,Time,Product,ISIN,Description,FX,Change,,Balance,,Order ID
01-03-2026,10:00,VWRL ETF,IE00B3RBWM25,Buy 2 VWRL,,-300.00,EUR,100.00,EUR,order1
"""

def test_ing_parses_expense():
    rows = INGImporter().parse(io.StringIO(ING_CSV))
    expense = next(r for r in rows if r.amount < 0)
    assert expense.amount == Decimal("-67.40")
    assert expense.description == "Albert Heijn"
    assert expense.date == date(2026, 3, 1)
    assert expense.source == "ing"

def test_ing_parses_income():
    rows = INGImporter().parse(io.StringIO(ING_CSV))
    income = next(r for r in rows if r.amount > 0)
    assert income.amount == Decimal("3460.26")

def test_ing_generates_import_hash():
    rows = INGImporter().parse(io.StringIO(ING_CSV))
    assert all(r.import_hash for r in rows)
    hashes = [r.import_hash for r in rows]
    assert len(hashes) == len(set(hashes))  # unique

def test_revolut_parses_expense():
    rows = RevolutImporter().parse(io.StringIO(REVOLUT_CSV))
    expense = next(r for r in rows if r.amount < 0)
    assert expense.amount == Decimal("-9.99")
    assert expense.description == "Spotify"
    assert expense.date == date(2026, 3, 5)
    assert expense.source == "revolut"

def test_revolut_parses_income():
    rows = RevolutImporter().parse(io.StringIO(REVOLUT_CSV))
    income = next(r for r in rows if r.amount > 0)
    assert income.amount == Decimal("500.00")

def test_degiro_parses_transaction():
    rows = DEGIROImporter().parse(io.StringIO(DEGIRO_CSV))
    assert len(rows) == 1
    assert rows[0].amount == Decimal("-300.00")
    assert rows[0].description == "VWRL ETF"
    assert rows[0].date == date(2026, 3, 1)
    assert rows[0].source == "degiro"
```

- [ ] **Step 2: Run to verify failure**

```bash
pytest tests/test_importers.py -v
# Expected: ImportError
```

- [ ] **Step 3: Create `backend/importers/base.py`**

```python
from dataclasses import dataclass
from decimal import Decimal
from datetime import date
from typing import IO
import hashlib

@dataclass
class ParsedTransaction:
    date: date
    amount: Decimal
    description: str
    source: str
    import_hash: str

def make_hash(source: str, date: date, amount: Decimal, description: str) -> str:
    raw = f"{source}|{date}|{amount}|{description}"
    return hashlib.sha256(raw.encode()).hexdigest()

class BaseImporter:
    source: str

    def parse(self, file: IO[str]) -> list[ParsedTransaction]:
        raise NotImplementedError
```

- [ ] **Step 4: Create `backend/importers/__init__.py`** (empty)

- [ ] **Step 5: Create `backend/importers/ing.py`**

```python
import csv
import io
from decimal import Decimal
from datetime import datetime
from .base import BaseImporter, ParsedTransaction, make_hash

class INGImporter(BaseImporter):
    source = "ing"

    def parse(self, file) -> list[ParsedTransaction]:
        content = file.read() if hasattr(file, 'read') else file
        if isinstance(content, bytes):
            content = content.decode("utf-8")
        reader = csv.DictReader(io.StringIO(content), delimiter=";")
        results = []
        for row in reader:
            raw_date = row.get("Datum", "").strip()
            if not raw_date:
                continue
            tx_date = datetime.strptime(raw_date, "%Y%m%d").date()

            naam = row.get("Naam / Omschrijving", "").strip()
            omschrijving = row.get("Mededelingen", "").strip()
            description = naam if naam else omschrijving

            raw_amount = row.get("Bedrag (EUR)", "0").strip().replace(",", ".")
            amount = Decimal(raw_amount)
            if row.get("Af Bij", "").strip().lower() == "af":
                amount = -amount

            results.append(ParsedTransaction(
                date=tx_date,
                amount=amount,
                description=description,
                source=self.source,
                import_hash=make_hash(self.source, tx_date, amount, description),
            ))
        return results
```

- [ ] **Step 6: Create `backend/importers/revolut.py`**

```python
import csv
import io
from decimal import Decimal
from datetime import datetime
from .base import BaseImporter, ParsedTransaction, make_hash

class RevolutImporter(BaseImporter):
    source = "revolut"

    def parse(self, file) -> list[ParsedTransaction]:
        content = file.read() if hasattr(file, 'read') else file
        if isinstance(content, bytes):
            content = content.decode("utf-8")
        reader = csv.DictReader(io.StringIO(content))
        results = []
        for row in reader:
            raw_date = row.get("Started Date", "").strip()
            if not raw_date:
                continue
            tx_date = datetime.fromisoformat(raw_date).date()
            description = row.get("Description", "").strip()
            amount = Decimal(row.get("Amount", "0").strip())
            results.append(ParsedTransaction(
                date=tx_date,
                amount=amount,
                description=description,
                source=self.source,
                import_hash=make_hash(self.source, tx_date, amount, description),
            ))
        return results
```

- [ ] **Step 7: Create `backend/importers/degiro.py`**

```python
import csv
import io
from decimal import Decimal
from datetime import datetime
from .base import BaseImporter, ParsedTransaction, make_hash

class DEGIROImporter(BaseImporter):
    source = "degiro"

    def parse(self, file) -> list[ParsedTransaction]:
        content = file.read() if hasattr(file, 'read') else file
        if isinstance(content, bytes):
            content = content.decode("utf-8")
        reader = csv.DictReader(io.StringIO(content))
        results = []
        for row in reader:
            raw_date = row.get("Date", "").strip()
            if not raw_date:
                continue
            tx_date = datetime.strptime(raw_date, "%d-%m-%Y").date()
            description = row.get("Product", "").strip()
            # Find the EUR amount column (header is "Change" with empty next col header)
            # DEGIRO CSV has "Change,,Balance,," — amount is in column index 6
            headers = list(reader.fieldnames or [])
            change_idx = next((i for i, h in enumerate(headers) if h == "Change"), None)
            if change_idx is None:
                continue
            values = list(row.values())
            raw_amount = values[change_idx].strip() if change_idx < len(values) else "0"
            if not raw_amount:
                continue
            amount = Decimal(raw_amount.replace(",", "."))
            results.append(ParsedTransaction(
                date=tx_date,
                amount=amount,
                description=description,
                source=self.source,
                import_hash=make_hash(self.source, tx_date, amount, description),
            ))
        return results
```

- [ ] **Step 8: Run tests and verify pass**

```bash
pytest tests/test_importers.py -v
# Expected: all passed
```

- [ ] **Step 9: Commit**

```bash
git add backend/importers/ backend/tests/test_importers.py
git commit -m "feat: CSV importers for ING, Revolut, DEGIRO"
```

---

## Task 5: Categorisation Engine

**Files:**
- Create: `backend/categorizer/rules.py`
- Create: `backend/categorizer/ai.py`
- Create: `backend/categorizer/__init__.py`
- Create: `backend/tests/test_categorizer.py`

- [ ] **Step 1: Write failing tests**

```python
# backend/tests/test_categorizer.py
from unittest.mock import patch, MagicMock
from decimal import Decimal
from datetime import date
from categorizer.rules import apply_rules
from categorizer.ai import categorise_with_ai
from models import Rule, Category
from importers.base import ParsedTransaction

def make_tx(description):
    return ParsedTransaction(
        date=date(2026, 3, 1),
        amount=Decimal("-10.00"),
        description=description,
        source="ing",
        import_hash=f"hash-{description}",
    )

def test_rule_matches_by_substring(db):
    cat = Category(name="Food", type="needs", sort_order=1)
    db.add(cat)
    db.flush()
    db.add(Rule(pattern="albert heijn", category_id=cat.id, priority=10))
    db.commit()

    result = apply_rules(make_tx("Albert Heijn #123"), db)
    assert result is not None
    assert result.id == cat.id

def test_rule_match_is_case_insensitive(db):
    cat = Category(name="Food", type="needs", sort_order=1)
    db.add(cat)
    db.flush()
    db.add(Rule(pattern="ZIGGO", category_id=cat.id, priority=5))
    db.commit()
    result = apply_rules(make_tx("ziggo internet"), db)
    assert result is not None

def test_rule_returns_none_when_no_match(db):
    result = apply_rules(make_tx("Unknown Merchant XYZ"), db)
    assert result is None

def test_rule_higher_priority_wins(db):
    cat1 = Category(name="Food", type="needs", sort_order=1)
    cat2 = Category(name="Misc", type="wants", sort_order=2)
    db.add_all([cat1, cat2])
    db.flush()
    db.add(Rule(pattern="test", category_id=cat1.id, priority=5))
    db.add(Rule(pattern="test", category_id=cat2.id, priority=10))
    db.commit()
    result = apply_rules(make_tx("test merchant"), db)
    assert result.id == cat2.id

def test_ai_categoriser_returns_category_and_confidence(db):
    cat = Category(name="Food - Essential", type="needs", sort_order=1)
    db.add(cat)
    db.commit()

    mock_response = MagicMock()
    mock_response.content = [MagicMock(text='{"category": "Food - Essential", "confidence": 0.85}')]

    with patch("categorizer.ai.anthropic.Anthropic") as MockClient:
        MockClient.return_value.messages.create.return_value = mock_response
        result = categorise_with_ai(make_tx("Albert Heijn"), db)

    assert result is not None
    category, confidence = result
    assert category.name == "Food - Essential"
    assert confidence == 0.85

def test_ai_categoriser_returns_none_on_invalid_json(db):
    mock_response = MagicMock()
    mock_response.content = [MagicMock(text="I don't know")]

    with patch("categorizer.ai.anthropic.Anthropic") as MockClient:
        MockClient.return_value.messages.create.return_value = mock_response
        result = categorise_with_ai(make_tx("Unknown"), db)

    assert result is None
```

- [ ] **Step 2: Run to verify failure**

```bash
pytest tests/test_categorizer.py -v
# Expected: ImportError
```

- [ ] **Step 3: Create `backend/categorizer/__init__.py`** (empty)

- [ ] **Step 4: Create `backend/categorizer/rules.py`**

```python
from sqlalchemy.orm import Session
from models import Rule, Category

def apply_rules(transaction, db: Session) -> Category | None:
    rules = db.query(Rule).order_by(Rule.priority.desc()).all()
    desc_lower = transaction.description.lower()
    for rule in rules:
        if rule.pattern.lower() in desc_lower:
            return db.query(Category).get(rule.category_id)
    return None
```

- [ ] **Step 5: Create `backend/categorizer/ai.py`**

```python
import json
import anthropic
from sqlalchemy.orm import Session
from models import Category

def categorise_with_ai(transaction, db: Session) -> tuple[Category, float] | None:
    categories = db.query(Category).all()
    category_names = [c.name for c in categories]

    client = anthropic.Anthropic()
    prompt = (
        f"Transaction description: \"{transaction.description}\"\n"
        f"Available categories: {', '.join(category_names)}\n"
        "Respond with JSON only: {\"category\": \"<name>\", \"confidence\": <0.0-1.0>}"
    )
    try:
        response = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=64,
            system="You are a financial transaction categoriser. Respond with JSON only.",
            messages=[{"role": "user", "content": prompt}],
        )
        data = json.loads(response.content[0].text)
        cat = next((c for c in categories if c.name == data["category"]), None)
        if cat is None:
            return None
        return cat, float(data["confidence"])
    except (json.JSONDecodeError, KeyError, Exception):
        return None
```

- [ ] **Step 6: Run tests and verify pass**

```bash
pytest tests/test_categorizer.py -v
# Expected: all passed
```

- [ ] **Step 7: Commit**

```bash
git add backend/categorizer/ backend/tests/test_categorizer.py
git commit -m "feat: rule-based and AI categorisation engine"
```

---

## Task 6: Import API Endpoints

**Files:**
- Create: `backend/routers/imports.py`
- Create: `backend/tests/test_imports.py`
- Modify: `backend/main.py`

- [ ] **Step 1: Create `backend/schemas.py`** (base schemas needed by all routers)

```python
from pydantic import BaseModel
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

    class Config:
        from_attributes = True

class TransactionPatch(BaseModel):
    category_id: Optional[int] = None
    confirmed: Optional[bool] = None

class CategoryOut(BaseModel):
    id: int
    name: str
    type: str
    sort_order: int

    class Config:
        from_attributes = True

class BudgetRow(BaseModel):
    id: int
    category_id: int
    category_name: str
    month: Optional[date]
    planned_amount: Decimal
    actual_amount: Optional[Decimal] = None

    class Config:
        from_attributes = True

class BudgetPatch(BaseModel):
    planned_amount: Decimal

class RuleOut(BaseModel):
    id: int
    pattern: str
    category_id: int
    category_name: str
    priority: int

    class Config:
        from_attributes = True

class RuleCreate(BaseModel):
    pattern: str
    category_id: int
    priority: int = 0

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
```

- [ ] **Step 2: Write failing tests for import endpoints**

```python
# backend/tests/test_imports.py
import io
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from db import Base, get_db
from main import app
from seed import run_seed

ING_CSV = b"""Datum;Naam / Omschrijving;Rekening;Tegenrekening;Code;Af Bij;Bedrag (EUR);Mutatiesoort;Mededelingen
20260301;Albert Heijn;NL00;;GT;Af;67,40;Betaalautomaat;
20260302;Salaris;;NL00;;Bij;3460,26;Overschrijving;
"""

@pytest.fixture
def client(db):
    app.dependency_overrides[get_db] = lambda: db
    run_seed(db)
    yield TestClient(app)
    app.dependency_overrides.clear()

def test_preview_returns_parsed_rows(client):
    r = client.post("/import/preview",
        data={"source": "ing"},
        files={"file": ("ing.csv", ING_CSV, "text/csv")})
    assert r.status_code == 200
    body = r.json()
    assert body["total"] == 2
    assert body["duplicates"] == 0

def test_confirm_saves_transactions(client):
    # Preview first
    client.post("/import/preview", data={"source": "ing"},
        files={"file": ("ing.csv", ING_CSV, "text/csv")})
    # Confirm
    r = client.post("/import/confirm", data={"source": "ing"},
        files={"file": ("ing.csv", ING_CSV, "text/csv")})
    assert r.status_code == 200
    body = r.json()
    assert body["imported"] == 2
    assert body["skipped_duplicates"] == 0

def test_confirm_deduplicates_on_reimport(client):
    for _ in range(2):
        r = client.post("/import/confirm", data={"source": "ing"},
            files={"file": ("ing.csv", ING_CSV, "text/csv")})
    body = r.json()
    assert body["imported"] == 0
    assert body["skipped_duplicates"] == 2
```

- [ ] **Step 3: Run to verify failure**

```bash
pytest tests/test_imports.py -v
# Expected: 404 or ImportError
```

- [ ] **Step 4: Create `backend/routers/imports.py`**

```python
from fastapi import APIRouter, UploadFile, Form, Depends
from sqlalchemy.orm import Session
from db import get_db
from importers.ing import INGImporter
from importers.revolut import RevolutImporter
from importers.degiro import DEGIROImporter
from categorizer.rules import apply_rules
from categorizer.ai import categorise_with_ai
from models import Transaction
from schemas import ImportPreviewResponse, ImportConfirmResponse, ParsedTransactionOut
import io

router = APIRouter(prefix="/import", tags=["import"])

IMPORTERS = {"ing": INGImporter, "revolut": RevolutImporter, "degiro": DEGIROImporter}

def _parse(file: UploadFile, source: str):
    importer = IMPORTERS[source]()
    content = file.file.read()
    return importer.parse(io.StringIO(content.decode("utf-8")))

@router.post("/preview", response_model=ImportPreviewResponse)
async def preview(source: str = Form(...), file: UploadFile = ..., db: Session = Depends(get_db)):
    rows = _parse(file, source)
    existing_hashes = {t.import_hash for t in db.query(Transaction.import_hash).all()}
    out = []
    for r in rows:
        out.append(ParsedTransactionOut(
            date=r.date, amount=r.amount, description=r.description,
            source=r.source, import_hash=r.import_hash,
            duplicate=r.import_hash in existing_hashes,
        ))
    duplicates = sum(1 for r in out if r.duplicate)
    return ImportPreviewResponse(rows=out, total=len(out), duplicates=duplicates)

@router.post("/confirm", response_model=ImportConfirmResponse)
async def confirm(source: str = Form(...), file: UploadFile = ..., db: Session = Depends(get_db)):
    rows = _parse(file, source)
    existing_hashes = {t.import_hash for t in db.query(Transaction.import_hash).all()}
    imported = skipped = by_rule = by_ai = uncategorised = 0

    for r in rows:
        if r.import_hash in existing_hashes:
            skipped += 1
            continue
        tx = Transaction(
            date=r.date, amount=r.amount, description=r.description,
            source=r.source, import_hash=r.import_hash, confirmed=False,
        )
        cat = apply_rules(r, db)
        if cat:
            tx.category_id = cat.id
            tx.confirmed = True
            tx.categorised_by = "rule"
            by_rule += 1
        else:
            result = categorise_with_ai(r, db)
            if result:
                cat, confidence = result
                tx.category_id = cat.id
                tx.ai_confidence = confidence
                tx.categorised_by = "ai"
                by_ai += 1
            else:
                uncategorised += 1
        db.add(tx)
        imported += 1

    db.commit()
    return ImportConfirmResponse(
        imported=imported, skipped_duplicates=skipped,
        categorised_by_rule=by_rule, categorised_by_ai=by_ai,
        uncategorised=uncategorised,
    )
```

- [ ] **Step 5: Create `backend/routers/__init__.py`** (empty)

- [ ] **Step 6: Register router in `main.py`**

```python
from routers.imports import router as imports_router
app.include_router(imports_router)
```

- [ ] **Step 7: Run tests and verify pass**

```bash
pytest tests/test_imports.py -v
# Expected: all passed (AI calls return None since no ANTHROPIC_API_KEY in test)
```

- [ ] **Step 8: Commit**

```bash
git add backend/schemas.py backend/routers/ backend/tests/test_imports.py backend/main.py
git commit -m "feat: import preview and confirm endpoints with deduplication"
```

---

## Task 7: Transactions API

**Files:**
- Create: `backend/routers/transactions.py`
- Create: `backend/tests/test_transactions.py`

- [ ] **Step 1: Write failing tests**

```python
# backend/tests/test_transactions.py
import pytest
from fastapi.testclient import TestClient
from decimal import Decimal
from datetime import date
from db import get_db
from main import app
from models import Transaction, Category
from seed import run_seed

@pytest.fixture
def client(db):
    app.dependency_overrides[get_db] = lambda: db
    run_seed(db)
    cat = db.query(Category).first()
    db.add(Transaction(
        date=date(2026, 3, 1), amount=Decimal("-45.00"),
        description="Albert Heijn", source="ing",
        category_id=cat.id, confirmed=True, categorised_by="rule",
        import_hash="hash1",
    ))
    db.add(Transaction(
        date=date(2026, 3, 2), amount=Decimal("-10.00"),
        description="Bol.com", source="revolut",
        category_id=cat.id, confirmed=False, categorised_by="ai",
        ai_confidence=0.7, import_hash="hash2",
    ))
    db.commit()
    yield TestClient(app)
    app.dependency_overrides.clear()

def test_list_transactions(client):
    r = client.get("/transactions")
    assert r.status_code == 200
    assert len(r.json()) == 2

def test_unconfirmed_first(client):
    r = client.get("/transactions")
    items = r.json()
    assert items[0]["confirmed"] is False

def test_filter_by_confirmed(client):
    r = client.get("/transactions?confirmed=false")
    items = r.json()
    assert all(not i["confirmed"] for i in items)

def test_patch_transaction(client, db):
    tx = db.query(Transaction).filter_by(import_hash="hash2").first()
    r = client.patch(f"/transactions/{tx.id}", json={"confirmed": True})
    assert r.status_code == 200
    assert r.json()["confirmed"] is True

def test_review_endpoint_returns_unconfirmed(client):
    r = client.get("/transactions/review")
    assert r.status_code == 200
    assert r.json()["confirmed"] is False
```

- [ ] **Step 2: Run to verify failure**

```bash
pytest tests/test_transactions.py -v
```

- [ ] **Step 3: Create `backend/routers/transactions.py`**

```python
from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy.orm import Session
from typing import Optional
from db import get_db
from models import Transaction, Category, Rule
from schemas import TransactionOut, TransactionPatch

router = APIRouter(prefix="/transactions", tags=["transactions"])

def _to_out(tx: Transaction) -> dict:
    return {
        "id": tx.id, "date": tx.date, "amount": tx.amount,
        "description": tx.description, "source": tx.source,
        "category_id": tx.category_id,
        "category_name": tx.category.name if tx.category else None,
        "confirmed": tx.confirmed,
        "categorised_by": tx.categorised_by,
        "ai_confidence": tx.ai_confidence,
    }

@router.get("")
def list_transactions(
    month: Optional[str] = None,
    category_id: Optional[int] = None,
    source: Optional[str] = None,
    confirmed: Optional[bool] = None,
    db: Session = Depends(get_db),
):
    q = db.query(Transaction)
    if month:
        from datetime import date
        year, mo = int(month[:4]), int(month[5:7])
        from sqlalchemy import extract
        q = q.filter(extract("year", Transaction.date) == year,
                     extract("month", Transaction.date) == mo)
    if category_id is not None:
        q = q.filter(Transaction.category_id == category_id)
    if source:
        q = q.filter(Transaction.source == source)
    if confirmed is not None:
        q = q.filter(Transaction.confirmed == confirmed)
    # Unconfirmed first
    q = q.order_by(Transaction.confirmed.asc(), Transaction.date.desc())
    return [_to_out(tx) for tx in q.all()]

@router.get("/review")
def next_review(db: Session = Depends(get_db)):
    tx = db.query(Transaction).filter(Transaction.confirmed == False).first()
    if not tx:
        return None
    return _to_out(tx)

@router.patch("/{tx_id}")
def patch_transaction(tx_id: int, body: TransactionPatch, db: Session = Depends(get_db)):
    tx = db.query(Transaction).get(tx_id)
    if not tx:
        raise HTTPException(404)
    if body.category_id is not None:
        tx.category_id = body.category_id
        if tx.categorised_by == "ai":
            tx.categorised_by = "manual"
    if body.confirmed is not None:
        tx.confirmed = body.confirmed
    db.commit()
    db.refresh(tx)
    return _to_out(tx)

@router.post("/{tx_id}/create-rule")
def create_rule_from_transaction(tx_id: int, db: Session = Depends(get_db)):
    """Create a rule from this transaction's description, confirm current tx,
    and retroactively confirm all matching unconfirmed transactions."""
    tx = db.query(Transaction).get(tx_id)
    if not tx or not tx.category_id:
        raise HTTPException(400, "Transaction must have a category before creating a rule")
    pattern = tx.description.lower().strip()
    rule = Rule(pattern=pattern, category_id=tx.category_id, priority=0)
    db.add(rule)
    # Retroactively confirm matching unconfirmed transactions
    unconfirmed = db.query(Transaction).filter(Transaction.confirmed == False).all()
    updated = 0
    for t in unconfirmed:
        if pattern in t.description.lower():
            t.confirmed = True
            t.category_id = tx.category_id
            t.categorised_by = "rule"
            updated += 1
    db.commit()
    return {"rule_created": pattern, "transactions_updated": updated}
```

- [ ] **Step 4: Register router in `main.py`**

```python
from routers.transactions import router as transactions_router
app.include_router(transactions_router)
```

- [ ] **Step 5: Run tests and verify pass**

```bash
pytest tests/test_transactions.py -v
```

- [ ] **Step 6: Commit**

```bash
git add backend/routers/transactions.py backend/tests/test_transactions.py backend/main.py
git commit -m "feat: transactions list, review, patch, and create-rule endpoints"
```

---

## Task 8: Budget & Rules & Dashboard APIs

**Files:**
- Create: `backend/routers/budget.py`
- Create: `backend/routers/rules.py`
- Create: `backend/routers/dashboard.py`
- Create: `backend/tests/test_budget.py`
- Create: `backend/tests/test_rules.py`
- Create: `backend/tests/test_dashboard.py`

- [ ] **Step 1: Write failing tests**

```python
# backend/tests/test_budget.py
import pytest
from fastapi.testclient import TestClient
from decimal import Decimal
from db import get_db
from main import app
from seed import run_seed

@pytest.fixture
def client(db):
    app.dependency_overrides[get_db] = lambda: db
    run_seed(db)
    yield TestClient(app)
    app.dependency_overrides.clear()

def test_budget_autopopulates_from_defaults(client):
    r = client.get("/budget?month=2026-03")
    assert r.status_code == 200
    rows = r.json()
    assert len(rows) > 0
    names = [r["category_name"] for r in rows]
    assert "Food - Essential" in names

def test_budget_patch_updates_amount(client, db):
    r = client.get("/budget?month=2026-03")
    row = r.json()[0]
    new_amount = float(row["planned_amount"]) + 100
    r2 = client.patch(f"/budget/{row['id']}", json={"planned_amount": new_amount})
    assert r2.status_code == 200
    assert float(r2.json()["planned_amount"]) == new_amount
```

```python
# backend/tests/test_rules.py
import pytest
from fastapi.testclient import TestClient
from db import get_db
from main import app
from seed import run_seed
from models import Category

@pytest.fixture
def client(db):
    app.dependency_overrides[get_db] = lambda: db
    run_seed(db)
    yield TestClient(app)
    app.dependency_overrides.clear()

def test_create_rule(client, db):
    cat = db.query(Category).first()
    r = client.post("/rules", json={"pattern": "ziggo", "category_id": cat.id, "priority": 5})
    assert r.status_code == 200
    assert r.json()["pattern"] == "ziggo"

def test_list_rules(client, db):
    cat = db.query(Category).first()
    client.post("/rules", json={"pattern": "ziggo", "category_id": cat.id, "priority": 5})
    r = client.get("/rules")
    assert r.status_code == 200
    assert any(rule["pattern"] == "ziggo" for rule in r.json())

def test_delete_rule(client, db):
    cat = db.query(Category).first()
    r = client.post("/rules", json={"pattern": "ziggo", "category_id": cat.id, "priority": 5})
    rule_id = r.json()["id"]
    client.delete(f"/rules/{rule_id}")
    r2 = client.get("/rules")
    assert all(rule["id"] != rule_id for rule in r2.json())
```

```python
# backend/tests/test_dashboard.py
import pytest
from fastapi.testclient import TestClient
from decimal import Decimal
from datetime import date
from db import get_db
from main import app
from seed import run_seed
from models import Transaction, Category

@pytest.fixture
def client(db):
    app.dependency_overrides[get_db] = lambda: db
    run_seed(db)
    cat = db.query(Category).filter_by(name="Food - Essential").first()
    db.add(Transaction(
        date=date(2026, 3, 5), amount=Decimal("-67.40"),
        description="Albert Heijn", source="ing",
        category_id=cat.id, confirmed=True, categorised_by="rule",
        import_hash="hash-test-1",
    ))
    db.add(Transaction(
        date=date(2026, 3, 10), amount=Decimal("3460.26"),
        description="Salaris", source="ing",
        confirmed=True, categorised_by="rule", import_hash="hash-test-2",
    ))
    db.commit()
    yield TestClient(app)
    app.dependency_overrides.clear()

def test_dashboard_summary(client):
    r = client.get("/dashboard/summary?month=2026-03")
    assert r.status_code == 200
    body = r.json()
    assert "total_income" in body
    assert "total_expenses" in body
    assert "category_breakdown" in body
    assert float(body["total_income"]) == 3460.26
    assert float(body["total_expenses"]) == 67.40
```

- [ ] **Step 2: Run to verify failure**

```bash
pytest tests/test_budget.py tests/test_rules.py tests/test_dashboard.py -v
```

- [ ] **Step 3: Create `backend/routers/budget.py`**

```python
from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy.orm import Session
from datetime import date
from decimal import Decimal
from db import get_db
from models import Budget, Category, Transaction
from schemas import BudgetPatch
from sqlalchemy import extract, func

router = APIRouter(prefix="/budget", tags=["budget"])

def _auto_populate(month_date: date, db: Session):
    """Create budget rows for month from defaults if they don't exist."""
    defaults = db.query(Budget).filter(Budget.month == None).all()
    for d in defaults:
        exists = db.query(Budget).filter_by(category_id=d.category_id, month=month_date).first()
        if not exists:
            db.add(Budget(category_id=d.category_id, month=month_date, planned_amount=d.planned_amount))
    db.commit()

@router.get("")
def get_budget(month: str = Query(...), db: Session = Depends(get_db)):
    year, mo = int(month[:4]), int(month[5:7])
    month_date = date(year, mo, 1)
    _auto_populate(month_date, db)
    rows = db.query(Budget).filter(Budget.month == month_date).all()
    result = []
    for row in rows:
        actual = db.query(func.sum(Transaction.amount)).filter(
            Transaction.category_id == row.category_id,
            extract("year", Transaction.date) == year,
            extract("month", Transaction.date) == mo,
            Transaction.confirmed == True,
        ).scalar() or Decimal("0")
        result.append({
            "id": row.id,
            "category_id": row.category_id,
            "category_name": row.category.name,
            "month": row.month,
            "planned_amount": row.planned_amount,
            "actual_amount": abs(actual) if actual < 0 else actual,
        })
    return result

@router.patch("/{budget_id}")
def patch_budget(budget_id: int, body: BudgetPatch, db: Session = Depends(get_db)):
    row = db.query(Budget).get(budget_id)
    if not row:
        raise HTTPException(404)
    row.planned_amount = body.planned_amount
    db.commit()
    db.refresh(row)
    return {"id": row.id, "planned_amount": row.planned_amount,
            "category_name": row.category.name, "month": row.month}

@router.patch("/defaults/{category_id}")
def patch_default(category_id: int, body: BudgetPatch, db: Session = Depends(get_db)):
    row = db.query(Budget).filter_by(category_id=category_id, month=None).first()
    if not row:
        raise HTTPException(404)
    row.planned_amount = body.planned_amount
    db.commit()
    return {"category_id": category_id, "planned_amount": row.planned_amount}
```

- [ ] **Step 4: Create `backend/routers/rules.py`**

```python
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from db import get_db
from models import Rule, Transaction
from schemas import RuleCreate, RuleTestRequest

router = APIRouter(prefix="/rules", tags=["rules"])

def _to_out(rule: Rule) -> dict:
    return {"id": rule.id, "pattern": rule.pattern, "category_id": rule.category_id,
            "category_name": rule.category.name, "priority": rule.priority}

@router.get("")
def list_rules(db: Session = Depends(get_db)):
    return [_to_out(r) for r in db.query(Rule).order_by(Rule.priority.desc()).all()]

@router.post("")
def create_rule(body: RuleCreate, db: Session = Depends(get_db)):
    rule = Rule(pattern=body.pattern, category_id=body.category_id, priority=body.priority)
    db.add(rule)
    db.commit()
    db.refresh(rule)
    return _to_out(rule)

@router.patch("/{rule_id}")
def update_rule(rule_id: int, body: RuleCreate, db: Session = Depends(get_db)):
    rule = db.query(Rule).get(rule_id)
    if not rule:
        raise HTTPException(404)
    rule.pattern = body.pattern
    rule.category_id = body.category_id
    rule.priority = body.priority
    db.commit()
    return _to_out(rule)

@router.delete("/{rule_id}")
def delete_rule(rule_id: int, db: Session = Depends(get_db)):
    rule = db.query(Rule).get(rule_id)
    if not rule:
        raise HTTPException(404)
    db.delete(rule)
    db.commit()
    return {"deleted": rule_id}

@router.post("/test")
def test_rule(body: RuleTestRequest, db: Session = Depends(get_db)):
    pattern = body.pattern.lower()
    matches = db.query(Transaction).filter(
        Transaction.description.ilike(f"%{pattern}%")
    ).limit(20).all()
    return {"matches": len(matches), "examples": [t.description for t in matches[:5]]}
```

- [ ] **Step 5: Create `backend/routers/dashboard.py`**

```python
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from sqlalchemy import extract, func
from decimal import Decimal
from datetime import date
from db import get_db
from models import Transaction, Budget, Category

router = APIRouter(prefix="/dashboard", tags=["dashboard"])

@router.get("/summary")
def summary(month: str = Query(...), db: Session = Depends(get_db)):
    year, mo = int(month[:4]), int(month[5:7])

    txs = db.query(Transaction).filter(
        extract("year", Transaction.date) == year,
        extract("month", Transaction.date) == mo,
        Transaction.confirmed == True,
    ).all()

    total_income = sum(t.amount for t in txs if t.amount > 0)
    total_expenses = abs(sum(t.amount for t in txs if t.amount < 0))

    cats = db.query(Category).all()
    cat_map = {c.id: c for c in cats}
    budgets = {b.category_id: b.planned_amount
               for b in db.query(Budget).filter(Budget.month == date(year, mo, 1)).all()}

    breakdown = {}
    for t in txs:
        if t.category_id and t.amount < 0:
            cid = t.category_id
            breakdown[cid] = breakdown.get(cid, Decimal("0")) + abs(t.amount)

    category_breakdown = [
        {"category_id": cid, "category_name": cat_map[cid].name,
         "actual": float(actual), "planned": float(budgets.get(cid, Decimal("0"))),
         "type": cat_map[cid].type}
        for cid, actual in breakdown.items() if cid in cat_map
    ]

    savings_cats = {c.id for c in cats if c.type == "savings"}
    total_savings = sum(
        abs(t.amount) for t in txs if t.category_id in savings_cats and t.amount < 0
    )
    needs_total = sum(d["actual"] for d in category_breakdown if d["type"] == "needs")
    wants_total = sum(d["actual"] for d in category_breakdown if d["type"] == "wants")

    # Last 6 months trend
    trend = []
    for i in range(5, -1, -1):
        m = mo - i
        y = year
        while m <= 0:
            m += 12; y -= 1
        month_txs = db.query(Transaction).filter(
            extract("year", Transaction.date) == y,
            extract("month", Transaction.date) == m,
            Transaction.confirmed == True,
            Transaction.amount < 0,
        ).all()
        trend.append({
            "month": f"{y}-{m:02d}",
            "total": float(abs(sum(t.amount for t in month_txs))),
        })

    return {
        "month": month,
        "total_income": float(total_income),
        "total_expenses": float(total_expenses),
        "total_savings": float(total_savings),
        "left_over": float(total_income - total_expenses),
        "category_breakdown": category_breakdown,
        "needs_wants_savings": {
            "needs": float(needs_total),
            "wants": float(wants_total),
            "savings": float(total_savings),
        },
        "monthly_trend": trend,
    }
```

- [ ] **Step 6: Register all routers in `main.py`**

```python
from routers.budget import router as budget_router
from routers.rules import router as rules_router
from routers.dashboard import router as dashboard_router

app.include_router(budget_router)
app.include_router(rules_router)
app.include_router(dashboard_router)
```

- [ ] **Step 7: Run all tests**

```bash
pytest backend/tests/ -v
# Expected: all passed
```

- [ ] **Step 8: Commit**

```bash
git add backend/routers/ backend/tests/ backend/main.py
git commit -m "feat: budget, rules, and dashboard API endpoints"
```

---

## Task 9: React App Shell + API Client

**Files:**
- Create: `frontend/src/types.ts`
- Create: `frontend/src/api.ts`
- Modify: `frontend/src/App.tsx`
- Create: `frontend/src/components/Nav.tsx`

- [ ] **Step 1: Create `frontend/src/types.ts`**

```typescript
export interface Transaction {
  id: number
  date: string
  amount: number
  description: string
  source: string
  category_id: number | null
  category_name: string | null
  confirmed: boolean
  categorised_by: string | null
  ai_confidence: number | null
}

export interface Category {
  id: number
  name: string
  type: string
  sort_order: number
}

export interface BudgetRow {
  id: number
  category_id: number
  category_name: string
  month: string | null
  planned_amount: number
  actual_amount: number | null
}

export interface Rule {
  id: number
  pattern: string
  category_id: number
  category_name: string
  priority: number
}

export interface DashboardSummary {
  month: string
  total_income: number
  total_expenses: number
  total_savings: number
  left_over: number
  category_breakdown: Array<{
    category_id: number
    category_name: string
    actual: number
    planned: number
    type: string
  }>
  needs_wants_savings: { needs: number; wants: number; savings: number }
  monthly_trend: Array<{ month: string; total: number }>
}
```

- [ ] **Step 2: Create `frontend/src/api.ts`**

```typescript
const BASE = '/api'

export const api = {
  getDashboard: (month: string): Promise<import('./types').DashboardSummary> =>
    fetch(`${BASE}/dashboard/summary?month=${month}`).then(r => r.json()),

  previewImport: (source: string, file: File) => {
    const fd = new FormData()
    fd.append('source', source)
    fd.append('file', file)
    return fetch(`${BASE}/import/preview`, { method: 'POST', body: fd }).then(r => r.json())
  },

  confirmImport: (source: string, file: File) => {
    const fd = new FormData()
    fd.append('source', source)
    fd.append('file', file)
    return fetch(`${BASE}/import/confirm`, { method: 'POST', body: fd }).then(r => r.json())
  },

  getTransactions: (params: Record<string, string> = {}): Promise<import('./types').Transaction[]> => {
    const q = new URLSearchParams(params).toString()
    return fetch(`${BASE}/transactions${q ? '?' + q : ''}`).then(r => r.json())
  },

  getNextReview: (): Promise<import('./types').Transaction | null> =>
    fetch(`${BASE}/transactions/review`).then(r => r.json()),

  patchTransaction: (id: number, body: Partial<import('./types').Transaction>) =>
    fetch(`${BASE}/transactions/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then(r => r.json()),

  createRuleFromTransaction: (id: number) =>
    fetch(`${BASE}/transactions/${id}/create-rule`, { method: 'POST' }).then(r => r.json()),

  getCategories: (): Promise<import('./types').Category[]> =>
    fetch(`${BASE}/categories`).then(r => r.json()),

  getBudget: (month: string): Promise<import('./types').BudgetRow[]> =>
    fetch(`${BASE}/budget?month=${month}`).then(r => r.json()),

  patchBudget: (id: number, planned_amount: number) =>
    fetch(`${BASE}/budget/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ planned_amount }),
    }).then(r => r.json()),

  getRules: (): Promise<import('./types').Rule[]> =>
    fetch(`${BASE}/rules`).then(r => r.json()),

  createRule: (body: { pattern: string; category_id: number; priority: number }) =>
    fetch(`${BASE}/rules`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then(r => r.json()),

  deleteRule: (id: number) =>
    fetch(`${BASE}/rules/${id}`, { method: 'DELETE' }).then(r => r.json()),
}
```

- [ ] **Step 3: Add GET /categories to backend**

Create `backend/routers/categories.py`:

```python
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from db import get_db
from models import Category

router = APIRouter(prefix="/categories", tags=["categories"])

@router.get("")
def list_categories(db: Session = Depends(get_db)):
    return [{"id": c.id, "name": c.name, "type": c.type, "sort_order": c.sort_order}
            for c in db.query(Category).order_by(Category.sort_order).all()]
```

Then register in `backend/main.py`:

```python
from routers.categories import router as categories_router
app.include_router(categories_router)
```

Add to `backend/tests/test_transactions.py`:

```python
def test_list_categories(client):
    r = client.get("/categories")
    assert r.status_code == 200
    names = [c["name"] for c in r.json()]
    assert "Food - Essential" in names
```

- [ ] **Step 4: Create `frontend/src/components/Nav.tsx`**

```tsx
import { Link, useLocation } from 'react-router-dom'

const links = [
  { to: '/', label: 'Dashboard' },
  { to: '/import', label: 'Import' },
  { to: '/transactions', label: 'Transactions' },
  { to: '/budget', label: 'Budget' },
  { to: '/rules', label: 'Rules' },
]

export default function Nav() {
  const { pathname } = useLocation()
  return (
    <nav style={{ display: 'flex', gap: 16, padding: '12px 24px', borderBottom: '1px solid #333', background: '#111' }}>
      <span style={{ fontWeight: 'bold', marginRight: 16, color: '#fff' }}>💰 Household Finance</span>
      {links.map(({ to, label }) => (
        <Link key={to} to={to} style={{
          color: pathname === to ? '#60a5fa' : '#999',
          textDecoration: 'none', fontWeight: pathname === to ? 'bold' : 'normal',
        }}>{label}</Link>
      ))}
    </nav>
  )
}
```

- [ ] **Step 5: Update `frontend/src/App.tsx`**

```tsx
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import Nav from './components/Nav'
import Dashboard from './pages/Dashboard'
import Import from './pages/Import'
import Transactions from './pages/Transactions'
import Budget from './pages/Budget'
import Rules from './pages/Rules'

const queryClient = new QueryClient()

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <div style={{ minHeight: '100vh', background: '#0f0f13', color: '#e0e0e0', fontFamily: 'system-ui, sans-serif' }}>
          <Nav />
          <div style={{ padding: '24px', maxWidth: 1200, margin: '0 auto' }}>
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/import" element={<Import />} />
              <Route path="/transactions" element={<Transactions />} />
              <Route path="/budget" element={<Budget />} />
              <Route path="/rules" element={<Rules />} />
            </Routes>
          </div>
        </div>
      </BrowserRouter>
    </QueryClientProvider>
  )
}
```

- [ ] **Step 6: Create stub pages so the app compiles**

Create each page as a minimal stub:

```tsx
// frontend/src/pages/Dashboard.tsx
export default function Dashboard() { return <div><h1>Dashboard</h1></div> }

// frontend/src/pages/Import.tsx
export default function Import() { return <div><h1>Import</h1></div> }

// frontend/src/pages/Transactions.tsx
export default function Transactions() { return <div><h1>Transactions</h1></div> }

// frontend/src/pages/Budget.tsx
export default function Budget() { return <div><h1>Budget</h1></div> }

// frontend/src/pages/Rules.tsx
export default function Rules() { return <div><h1>Rules</h1></div> }
```

- [ ] **Step 7: Verify app compiles and runs**

```bash
cd frontend && npm run dev
# Visit http://localhost:5173 — nav should show with all 5 links
```

- [ ] **Step 8: Commit**

```bash
git add frontend/src/
git commit -m "feat: React app shell with routing, nav, and API client"
```

---

## Task 10: Dashboard Page

**Files:**
- Modify: `frontend/src/pages/Dashboard.tsx`
- Create: `frontend/src/components/SummaryCards.tsx`

- [ ] **Step 1: Write failing component test**

```tsx
// frontend/src/tests/SummaryCards.test.tsx
import { render, screen } from '@testing-library/react'
import SummaryCards from '../components/SummaryCards'

const mockData = {
  total_income: 5860.26,
  total_expenses: 3420.00,
  total_savings: 400.00,
  left_over: 2040.26,
}

test('renders all four summary cards', () => {
  render(<SummaryCards {...mockData} />)
  expect(screen.getByText('Income')).toBeInTheDocument()
  expect(screen.getByText('Spent')).toBeInTheDocument()
  expect(screen.getByText('Saved')).toBeInTheDocument()
  expect(screen.getByText('Left Over')).toBeInTheDocument()
  expect(screen.getByText('€5,860.26')).toBeInTheDocument()
})
```

- [ ] **Step 2: Run to verify failure**

```bash
cd frontend && npx vitest run src/tests/SummaryCards.test.tsx
```

- [ ] **Step 3: Create `frontend/src/components/SummaryCards.tsx`**

```tsx
interface Props {
  total_income: number
  total_expenses: number
  total_savings: number
  left_over: number
}

const fmt = (n: number) => `€${n.toLocaleString('nl-NL', { minimumFractionDigits: 2 })}`

const Card = ({ label, value, color }: { label: string; value: string; color: string }) => (
  <div style={{ background: '#1a1f2e', borderRadius: 8, padding: '16px 20px', flex: 1 }}>
    <div style={{ fontSize: 12, color: '#888', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 1 }}>{label}</div>
    <div style={{ fontSize: 24, fontWeight: 'bold', color }}>{value}</div>
  </div>
)

export default function SummaryCards({ total_income, total_expenses, total_savings, left_over }: Props) {
  return (
    <div style={{ display: 'flex', gap: 16, marginBottom: 24 }}>
      <Card label="Income" value={fmt(total_income)} color="#4ade80" />
      <Card label="Spent" value={fmt(total_expenses)} color="#f87171" />
      <Card label="Saved" value={fmt(total_savings)} color="#60a5fa" />
      <Card label="Left Over" value={fmt(left_over)} color="#facc15" />
    </div>
  )
}
```

- [ ] **Step 4: Run test and verify pass**

```bash
npx vitest run src/tests/SummaryCards.test.tsx
```

- [ ] **Step 5: Implement `frontend/src/pages/Dashboard.tsx`**

```tsx
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { BarChart, Bar, XAxis, YAxis, Tooltip, PieChart, Pie, Cell, LineChart, Line, ResponsiveContainer, Legend } from 'recharts'
import { api } from '../api'
import SummaryCards from '../components/SummaryCards'

const COLORS = { needs: '#f87171', wants: '#facc15', savings: '#60a5fa' }

function currentMonth() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export default function Dashboard() {
  const [month, setMonth] = useState(currentMonth)
  const { data, isLoading } = useQuery({
    queryKey: ['dashboard', month],
    queryFn: () => api.getDashboard(month),
  })

  if (isLoading || !data) return <div>Loading...</div>

  const pieData = [
    { name: 'Needs', value: data.needs_wants_savings.needs },
    { name: 'Wants', value: data.needs_wants_savings.wants },
    { name: 'Savings', value: data.needs_wants_savings.savings },
  ]

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h1 style={{ margin: 0 }}>Dashboard</h1>
        <input type="month" value={month} onChange={e => setMonth(e.target.value)}
          style={{ background: '#1a1f2e', color: '#e0e0e0', border: '1px solid #333', borderRadius: 6, padding: '6px 12px' }} />
      </div>

      <SummaryCards
        total_income={data.total_income}
        total_expenses={data.total_expenses}
        total_savings={data.total_savings}
        left_over={data.left_over}
      />

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 24, marginBottom: 24 }}>
        <div style={{ background: '#1a1f2e', borderRadius: 8, padding: 20 }}>
          <h3 style={{ marginTop: 0 }}>Planned vs Actual by Category</h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={data.category_breakdown}>
              <XAxis dataKey="category_name" tick={{ fontSize: 10 }} angle={-30} textAnchor="end" height={60} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip formatter={(v: number) => `€${v.toFixed(2)}`} />
              <Legend />
              <Bar dataKey="planned" fill="#374151" name="Planned" />
              <Bar dataKey="actual" fill="#60a5fa" name="Actual" />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div style={{ background: '#1a1f2e', borderRadius: 8, padding: 20 }}>
          <h3 style={{ marginTop: 0 }}>50/30/20 Split</h3>
          <ResponsiveContainer width="100%" height={300}>
            <PieChart>
              <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}>
                {pieData.map((_, i) => <Cell key={i} fill={Object.values(COLORS)[i]} />)}
              </Pie>
              <Tooltip formatter={(v: number) => `€${v.toFixed(2)}`} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div style={{ background: '#1a1f2e', borderRadius: 8, padding: 20 }}>
        <h3 style={{ marginTop: 0 }}>6-Month Spending Trend</h3>
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={data.monthly_trend}>
            <XAxis dataKey="month" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip formatter={(v: number) => `€${v.toFixed(2)}`} />
            <Line type="monotone" dataKey="total" stroke="#60a5fa" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
```

- [ ] **Step 6: Verify dashboard renders with real backend running**

Start both servers and visit http://localhost:5173. Dashboard should show charts (empty for a fresh DB).

- [ ] **Step 7: Commit**

```bash
git add frontend/src/
git commit -m "feat: Dashboard page with summary cards, bar chart, pie chart, trend line"
```

---

## Task 11: Import Page

**Files:**
- Modify: `frontend/src/pages/Import.tsx`

- [ ] **Step 1: Write failing test**

```tsx
// frontend/src/tests/Import.test.tsx
import { render, screen, fireEvent } from '@testing-library/react'
import Import from '../pages/Import'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const wrap = (ui: React.ReactElement) =>
  render(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>)

test('renders source selector and file upload', () => {
  wrap(<Import />)
  expect(screen.getByText(/ING/)).toBeInTheDocument()
  expect(screen.getByRole('combobox')).toBeInTheDocument()
})

test('shows preview button after file selected', () => {
  wrap(<Import />)
  const input = screen.getByLabelText(/CSV file/i)
  const file = new File(['test'], 'test.csv', { type: 'text/csv' })
  fireEvent.change(input, { target: { files: [file] } })
  expect(screen.getByRole('button', { name: /preview/i })).toBeInTheDocument()
})
```

- [ ] **Step 2: Run to verify failure**

```bash
npx vitest run src/tests/Import.test.tsx
```

- [ ] **Step 3: Implement `frontend/src/pages/Import.tsx`**

```tsx
import { useState } from 'react'
import { api } from '../api'

const SOURCES = ['ing', 'revolut', 'degiro']

export default function Import() {
  const [source, setSource] = useState('ing')
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<any | null>(null)
  const [result, setResult] = useState<any | null>(null)
  const [loading, setLoading] = useState(false)

  const handlePreview = async () => {
    if (!file) return
    setLoading(true)
    const data = await api.previewImport(source, file)
    setPreview(data)
    setResult(null)
    setLoading(false)
  }

  const handleConfirm = async () => {
    if (!file) return
    setLoading(true)
    const data = await api.confirmImport(source, file)
    setResult(data)
    setPreview(null)
    setFile(null)
    setLoading(false)
  }

  return (
    <div>
      <h1>Import Transactions</h1>

      <div style={{ background: '#1a1f2e', borderRadius: 8, padding: 24, maxWidth: 600 }}>
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', marginBottom: 6, fontSize: 13, color: '#888' }}>Source</label>
          <select value={source} onChange={e => setSource(e.target.value)}
            style={{ background: '#111', color: '#e0e0e0', border: '1px solid #333', borderRadius: 6, padding: '8px 12px', width: '100%' }}>
            {SOURCES.map(s => <option key={s} value={s}>{s.toUpperCase()}</option>)}
          </select>
        </div>

        <div style={{ marginBottom: 16 }}>
          <label htmlFor="csv-file" style={{ display: 'block', marginBottom: 6, fontSize: 13, color: '#888' }}>CSV file</label>
          <input id="csv-file" type="file" accept=".csv"
            onChange={e => { setFile(e.target.files?.[0] ?? null); setPreview(null); setResult(null) }}
            style={{ color: '#e0e0e0' }} />
        </div>

        {file && (
          <button onClick={handlePreview} disabled={loading}
            style={{ background: '#374151', color: '#e0e0e0', border: 'none', borderRadius: 6, padding: '10px 20px', cursor: 'pointer', marginRight: 10 }}>
            {loading ? 'Loading...' : 'Preview'}
          </button>
        )}
      </div>

      {preview && (
        <div style={{ background: '#1a1f2e', borderRadius: 8, padding: 24, maxWidth: 800, marginTop: 24 }}>
          <h3 style={{ marginTop: 0 }}>Preview — {preview.total} transactions ({preview.duplicates} duplicates)</h3>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ color: '#888', textAlign: 'left', borderBottom: '1px solid #333' }}>
                <th style={{ padding: '6px 8px' }}>Date</th>
                <th style={{ padding: '6px 8px' }}>Description</th>
                <th style={{ padding: '6px 8px' }}>Amount</th>
                <th style={{ padding: '6px 8px' }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {preview.rows.map((r: any, i: number) => (
                <tr key={i} style={{ borderBottom: '1px solid #222', opacity: r.duplicate ? 0.4 : 1 }}>
                  <td style={{ padding: '6px 8px' }}>{r.date}</td>
                  <td style={{ padding: '6px 8px' }}>{r.description}</td>
                  <td style={{ padding: '6px 8px', color: r.amount < 0 ? '#f87171' : '#4ade80' }}>
                    €{Math.abs(r.amount).toFixed(2)}
                  </td>
                  <td style={{ padding: '6px 8px', color: r.duplicate ? '#f97316' : '#4ade80' }}>
                    {r.duplicate ? 'duplicate' : 'new'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button onClick={handleConfirm} disabled={loading}
            style={{ marginTop: 16, background: '#1d4ed8', color: '#fff', border: 'none', borderRadius: 6, padding: '10px 24px', cursor: 'pointer', fontWeight: 'bold' }}>
            {loading ? 'Importing...' : `Import ${preview.total - preview.duplicates} new transactions`}
          </button>
        </div>
      )}

      {result && (
        <div style={{ background: '#0f2d0f', border: '1px solid #4ade80', borderRadius: 8, padding: 24, maxWidth: 600, marginTop: 24 }}>
          <h3 style={{ marginTop: 0, color: '#4ade80' }}>Import Complete</h3>
          <p>Imported: {result.imported} | Skipped (duplicates): {result.skipped_duplicates}</p>
          <p>Categorised by rule: {result.categorised_by_rule} | By AI: {result.categorised_by_ai} | Uncategorised: {result.uncategorised}</p>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run tests and verify pass**

```bash
npx vitest run src/tests/Import.test.tsx
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/Import.tsx
git commit -m "feat: Import page with CSV preview and confirm flow"
```

---

## Task 12: Transactions Page + Review Card

**Files:**
- Modify: `frontend/src/pages/Transactions.tsx`
- Create: `frontend/src/components/ReviewCard.tsx`

- [ ] **Step 1: Write failing test for ReviewCard**

```tsx
// frontend/src/tests/ReviewCard.test.tsx
import { render, screen, fireEvent } from '@testing-library/react'
import ReviewCard from '../components/ReviewCard'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const mockTx = {
  id: 1, date: '2026-03-12', amount: -34.99, description: 'Bol.com',
  source: 'ing', category_id: 5, category_name: 'Recreation & Entertainment',
  confirmed: false, categorised_by: 'ai', ai_confidence: 0.72,
}

const mockCategories = [
  { id: 1, name: 'Food - Essential', type: 'needs', sort_order: 1 },
  { id: 5, name: 'Recreation & Entertainment', type: 'wants', sort_order: 8 },
]

test('renders transaction description and amount', () => {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ReviewCard transaction={mockTx} categories={mockCategories} onConfirm={vi.fn()} onSkip={vi.fn()} />
    </QueryClientProvider>
  )
  expect(screen.getByText('Bol.com')).toBeInTheDocument()
  expect(screen.getByText(/34.99/)).toBeInTheDocument()
})

test('shows AI suggestion and confidence', () => {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ReviewCard transaction={mockTx} categories={mockCategories} onConfirm={vi.fn()} onSkip={vi.fn()} />
    </QueryClientProvider>
  )
  expect(screen.getByText(/72%/)).toBeInTheDocument()
  expect(screen.getByText(/Recreation & Entertainment/)).toBeInTheDocument()
})

test('calls onConfirm when confirm button clicked', () => {
  const onConfirm = vi.fn()
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ReviewCard transaction={mockTx} categories={mockCategories} onConfirm={onConfirm} onSkip={vi.fn()} />
    </QueryClientProvider>
  )
  fireEvent.click(screen.getByRole('button', { name: /confirm/i }))
  expect(onConfirm).toHaveBeenCalledWith(mockTx.id, mockTx.category_id)
})
```

- [ ] **Step 2: Run to verify failure**

```bash
npx vitest run src/tests/ReviewCard.test.tsx
```

- [ ] **Step 3: Create `frontend/src/components/ReviewCard.tsx`**

```tsx
import { useState } from 'react'
import { Transaction, Category } from '../types'

interface Props {
  transaction: Transaction
  categories: Category[]
  onConfirm: (id: number, categoryId: number) => void
  onSkip: () => void
  onCreateRule: (id: number, categoryId: number) => void
}

export default function ReviewCard({ transaction: tx, categories, onConfirm, onSkip, onCreateRule }: Props) {
  const [selectedCategory, setSelectedCategory] = useState<number>(tx.category_id ?? categories[0]?.id)

  return (
    <div style={{ background: '#1a1f2e', border: '1px solid #333', borderRadius: 10, padding: 24, maxWidth: 480 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 'bold' }}>{tx.description}</div>
          <div style={{ fontSize: 12, color: '#888', marginTop: 4 }}>
            {tx.date} · {tx.source.toUpperCase()}
          </div>
        </div>
        <div style={{ fontSize: 22, fontWeight: 'bold', color: tx.amount < 0 ? '#f87171' : '#4ade80' }}>
          €{Math.abs(tx.amount).toFixed(2)}
        </div>
      </div>

      {tx.categorised_by === 'ai' && tx.category_name && (
        <div style={{ marginBottom: 16, padding: '8px 12px', background: '#111', borderRadius: 6, fontSize: 13, color: '#888' }}>
          🤖 AI suggests: <span style={{ color: '#facc15' }}>{tx.category_name}</span>
          {tx.ai_confidence && <span style={{ marginLeft: 8, color: '#555' }}>{Math.round(tx.ai_confidence * 100)}% confident</span>}
        </div>
      )}

      <div style={{ marginBottom: 16 }}>
        <label style={{ display: 'block', marginBottom: 6, fontSize: 12, color: '#888' }}>Category</label>
        <select
          value={selectedCategory}
          onChange={e => setSelectedCategory(Number(e.target.value))}
          style={{ width: '100%', background: '#111', color: '#e0e0e0', border: '1px solid #444', borderRadius: 6, padding: '8px 12px' }}
        >
          {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>

      <div style={{ display: 'flex', gap: 10, marginBottom: 10 }}>
        <button
          onClick={() => onConfirm(tx.id, selectedCategory)}
          style={{ flex: 1, background: '#1d4ed8', color: '#fff', border: 'none', borderRadius: 6, padding: '10px', cursor: 'pointer', fontWeight: 'bold' }}
        >
          Confirm
        </button>
        <button
          onClick={onSkip}
          style={{ background: '#374151', color: '#e0e0e0', border: 'none', borderRadius: 6, padding: '10px 16px', cursor: 'pointer' }}
        >
          Skip
        </button>
      </div>
      <button
        onClick={() => onCreateRule(tx.id, selectedCategory)}
        style={{ width: '100%', background: 'transparent', color: '#888', border: '1px solid #444', borderRadius: 6, padding: '8px', cursor: 'pointer', fontSize: 12 }}
      >
        Always categorise "{tx.description}" as this category
      </button>
    </div>
  )
}
```

- [ ] **Step 4: Run test and verify pass**

```bash
npx vitest run src/tests/ReviewCard.test.tsx
```

- [ ] **Step 5: Implement `frontend/src/pages/Transactions.tsx`**

```tsx
import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api'
import ReviewCard from '../components/ReviewCard'

export default function Transactions() {
  const qc = useQueryClient()
  const [showReview, setShowReview] = useState(false)

  const { data: transactions = [] } = useQuery({
    queryKey: ['transactions'],
    queryFn: () => api.getTransactions(),
  })
  const { data: categories = [] } = useQuery({
    queryKey: ['categories'],
    queryFn: () => api.getCategories(),
  })
  const { data: reviewTx } = useQuery({
    queryKey: ['review'],
    queryFn: () => api.getNextReview(),
    enabled: showReview,
  })

  const unconfirmedCount = transactions.filter(t => !t.confirmed).length

  const handleConfirm = async (id: number, categoryId: number) => {
    await api.patchTransaction(id, { category_id: categoryId, confirmed: true })
    qc.invalidateQueries({ queryKey: ['transactions'] })
    qc.invalidateQueries({ queryKey: ['review'] })
  }

  const handleCreateRule = async (id: number, categoryId: number) => {
    await api.patchTransaction(id, { category_id: categoryId })
    await api.createRuleFromTransaction(id)
    qc.invalidateQueries({ queryKey: ['transactions'] })
    qc.invalidateQueries({ queryKey: ['review'] })
    qc.invalidateQueries({ queryKey: ['rules'] })
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h1 style={{ margin: 0 }}>Transactions</h1>
        {unconfirmedCount > 0 && (
          <button
            onClick={() => setShowReview(!showReview)}
            style={{ background: '#f97316', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 16px', cursor: 'pointer', fontWeight: 'bold' }}
          >
            {unconfirmedCount} need review
          </button>
        )}
      </div>

      {showReview && reviewTx && (
        <div style={{ marginBottom: 32 }}>
          <h3 style={{ marginTop: 0 }}>Review Queue</h3>
          <ReviewCard
            transaction={reviewTx}
            categories={categories}
            onConfirm={handleConfirm}
            onSkip={() => qc.invalidateQueries({ queryKey: ['review'] })}
            onCreateRule={handleCreateRule}
          />
        </div>
      )}

      <div style={{ background: '#1a1f2e', borderRadius: 8, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: '#111', color: '#888' }}>
              <th style={{ padding: '10px 16px', textAlign: 'left' }}>Date</th>
              <th style={{ padding: '10px 16px', textAlign: 'left' }}>Description</th>
              <th style={{ padding: '10px 16px', textAlign: 'right' }}>Amount</th>
              <th style={{ padding: '10px 16px', textAlign: 'left' }}>Category</th>
              <th style={{ padding: '10px 16px', textAlign: 'left' }}>Source</th>
              <th style={{ padding: '10px 16px', textAlign: 'left' }}>Status</th>
            </tr>
          </thead>
          <tbody>
            {transactions.map(tx => (
              <tr key={tx.id} style={{ borderBottom: '1px solid #222', opacity: tx.confirmed ? 1 : 0.7 }}>
                <td style={{ padding: '8px 16px', color: '#888' }}>{tx.date}</td>
                <td style={{ padding: '8px 16px' }}>{tx.description}</td>
                <td style={{ padding: '8px 16px', textAlign: 'right', color: tx.amount < 0 ? '#f87171' : '#4ade80', fontWeight: 'bold' }}>
                  €{Math.abs(tx.amount).toFixed(2)}
                </td>
                <td style={{ padding: '8px 16px', color: '#aaa' }}>{tx.category_name ?? '—'}</td>
                <td style={{ padding: '8px 16px', color: '#666', textTransform: 'uppercase', fontSize: 11 }}>{tx.source}</td>
                <td style={{ padding: '8px 16px' }}>
                  <span style={{
                    padding: '2px 8px', borderRadius: 4, fontSize: 11,
                    background: tx.confirmed ? '#0f2d0f' : '#2d1b00',
                    color: tx.confirmed ? '#4ade80' : '#f97316',
                    border: `1px solid ${tx.confirmed ? '#4ade80' : '#f97316'}`,
                  }}>
                    {tx.confirmed ? `✓ ${tx.categorised_by ?? 'confirmed'}` : '? review'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
```

- [ ] **Step 6: Commit**

```bash
git add frontend/src/
git commit -m "feat: Transactions page with review card and transaction table"
```

---

## Task 13: Budget & Rules Pages

**Files:**
- Modify: `frontend/src/pages/Budget.tsx`
- Modify: `frontend/src/pages/Rules.tsx`

- [ ] **Step 1: Implement `frontend/src/pages/Budget.tsx`**

```tsx
import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api'

function currentMonth() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export default function Budget() {
  const [month, setMonth] = useState(currentMonth)
  const [editing, setEditing] = useState<Record<number, string>>({})
  const qc = useQueryClient()

  const { data: rows = [] } = useQuery({
    queryKey: ['budget', month],
    queryFn: () => api.getBudget(month),
  })

  const handleSave = async (id: number) => {
    const val = parseFloat(editing[id])
    if (!isNaN(val)) {
      await api.patchBudget(id, val)
      qc.invalidateQueries({ queryKey: ['budget', month] })
    }
    setEditing(e => { const n = { ...e }; delete n[id]; return n })
  }

  const pct = (actual: number | null, planned: number) =>
    planned > 0 && actual != null ? Math.round((actual / planned) * 100) : 0

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h1 style={{ margin: 0 }}>Budget</h1>
        <input type="month" value={month} onChange={e => setMonth(e.target.value)}
          style={{ background: '#1a1f2e', color: '#e0e0e0', border: '1px solid #333', borderRadius: 6, padding: '6px 12px' }} />
      </div>

      <div style={{ background: '#1a1f2e', borderRadius: 8, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: '#111', color: '#888' }}>
              <th style={{ padding: '10px 16px', textAlign: 'left' }}>Category</th>
              <th style={{ padding: '10px 16px', textAlign: 'right' }}>Planned</th>
              <th style={{ padding: '10px 16px', textAlign: 'right' }}>Actual</th>
              <th style={{ padding: '10px 16px', textAlign: 'left', width: 160 }}>Progress</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(row => {
              const p = pct(row.actual_amount, row.planned_amount)
              const over = p > 100
              return (
                <tr key={row.id} style={{ borderBottom: '1px solid #222' }}>
                  <td style={{ padding: '10px 16px' }}>{row.category_name}</td>
                  <td style={{ padding: '10px 16px', textAlign: 'right' }}>
                    {row.id in editing ? (
                      <input
                        type="number"
                        value={editing[row.id] ?? row.planned_amount}
                        onChange={e => setEditing(prev => ({ ...prev, [row.id]: e.target.value }))}
                        onBlur={() => handleSave(row.id)}
                        autoFocus
                        style={{ width: 80, background: '#111', color: '#e0e0e0', border: '1px solid #60a5fa', borderRadius: 4, padding: '4px 8px', textAlign: 'right' }}
                      />
                    ) : (
                      <span
                        onClick={() => setEditing(prev => ({ ...prev, [row.id]: String(row.planned_amount) }))}
                        style={{ cursor: 'pointer', color: '#aaa' }}
                        title="Click to edit"
                      >
                        €{Number(row.planned_amount).toFixed(2)}
                      </span>
                    )}
                  </td>
                  <td style={{ padding: '10px 16px', textAlign: 'right', color: over ? '#f87171' : '#4ade80' }}>
                    €{(row.actual_amount ?? 0).toFixed(2)}
                  </td>
                  <td style={{ padding: '10px 16px' }}>
                    <div style={{ background: '#333', borderRadius: 4, height: 8, overflow: 'hidden' }}>
                      <div style={{
                        height: '100%', borderRadius: 4,
                        width: `${Math.min(p, 100)}%`,
                        background: over ? '#f87171' : p > 80 ? '#facc15' : '#4ade80',
                      }} />
                    </div>
                    <span style={{ fontSize: 11, color: '#666', marginTop: 2, display: 'block' }}>{p}%</span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p style={{ color: '#555', fontSize: 12, marginTop: 8 }}>Click any planned amount to edit. Changes apply to this month only.</p>
    </div>
  )
}
```

- [ ] **Step 2: Implement `frontend/src/pages/Rules.tsx`**

```tsx
import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api'

export default function Rules() {
  const qc = useQueryClient()
  const [newPattern, setNewPattern] = useState('')
  const [newCategory, setNewCategory] = useState<number | null>(null)
  const [editing, setEditing] = useState<Record<number, { pattern: string; category_id: number }>>({})

  const { data: rules = [] } = useQuery({ queryKey: ['rules'], queryFn: api.getRules })
  const { data: categories = [] } = useQuery({ queryKey: ['categories'], queryFn: api.getCategories })

  const handleCreate = async () => {
    if (!newPattern || !newCategory) return
    await api.createRule({ pattern: newPattern, category_id: newCategory, priority: 0 })
    qc.invalidateQueries({ queryKey: ['rules'] })
    setNewPattern('')
  }

  const handleDelete = async (id: number) => {
    await api.deleteRule(id)
    qc.invalidateQueries({ queryKey: ['rules'] })
  }

  const handleSaveEdit = async (id: number) => {
    const e = editing[id]
    if (!e) return
    await fetch(`/api/rules/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pattern: e.pattern, category_id: e.category_id, priority: 0 }),
    })
    qc.invalidateQueries({ queryKey: ['rules'] })
    setEditing(prev => { const n = { ...prev }; delete n[id]; return n })
  }

  return (
    <div>
      <h1>Categorisation Rules</h1>

      <div style={{ background: '#1a1f2e', borderRadius: 8, padding: 20, marginBottom: 24, maxWidth: 600 }}>
        <h3 style={{ marginTop: 0 }}>Add Rule</h3>
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: 12, color: '#888', display: 'block', marginBottom: 4 }}>Pattern (substring match)</label>
            <input
              value={newPattern}
              onChange={e => setNewPattern(e.target.value)}
              placeholder="e.g. albert heijn"
              style={{ width: '100%', background: '#111', color: '#e0e0e0', border: '1px solid #333', borderRadius: 6, padding: '8px 12px', boxSizing: 'border-box' }}
            />
          </div>
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: 12, color: '#888', display: 'block', marginBottom: 4 }}>Category</label>
            <select
              value={newCategory ?? ''}
              onChange={e => setNewCategory(Number(e.target.value))}
              style={{ width: '100%', background: '#111', color: '#e0e0e0', border: '1px solid #333', borderRadius: 6, padding: '8px 12px' }}
            >
              <option value="">Select...</option>
              {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <button
            onClick={handleCreate}
            disabled={!newPattern || !newCategory}
            style={{ background: '#1d4ed8', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 16px', cursor: 'pointer', whiteSpace: 'nowrap' }}
          >
            Add Rule
          </button>
        </div>
      </div>

      <div style={{ background: '#1a1f2e', borderRadius: 8, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: '#111', color: '#888' }}>
              <th style={{ padding: '10px 16px', textAlign: 'left' }}>Pattern</th>
              <th style={{ padding: '10px 16px', textAlign: 'left' }}>→ Category</th>
              <th style={{ padding: '10px 16px', textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rules.map(rule => {
              const e = editing[rule.id]
              return (
                <tr key={rule.id} style={{ borderBottom: '1px solid #222' }}>
                  <td style={{ padding: '10px 16px' }}>
                    {e ? (
                      <input value={e.pattern} onChange={ev => setEditing(prev => ({ ...prev, [rule.id]: { ...prev[rule.id], pattern: ev.target.value } }))}
                        style={{ background: '#111', color: '#60a5fa', border: '1px solid #60a5fa', borderRadius: 4, padding: '4px 8px', fontFamily: 'monospace', width: '100%' }} />
                    ) : (
                      <span style={{ fontFamily: 'monospace', color: '#60a5fa' }}>{rule.pattern}</span>
                    )}
                  </td>
                  <td style={{ padding: '10px 16px' }}>
                    {e ? (
                      <select value={e.category_id} onChange={ev => setEditing(prev => ({ ...prev, [rule.id]: { ...prev[rule.id], category_id: Number(ev.target.value) } }))}
                        style={{ background: '#111', color: '#e0e0e0', border: '1px solid #444', borderRadius: 4, padding: '4px 8px' }}>
                        {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                    ) : (
                      <span style={{ color: '#aaa' }}>{rule.category_name}</span>
                    )}
                  </td>
                  <td style={{ padding: '10px 16px', textAlign: 'right', display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                    {e ? (
                      <>
                        <button onClick={() => handleSaveEdit(rule.id)}
                          style={{ background: '#1d4ed8', color: '#fff', border: 'none', borderRadius: 4, padding: '4px 10px', cursor: 'pointer', fontSize: 12 }}>Save</button>
                        <button onClick={() => setEditing(prev => { const n = { ...prev }; delete n[rule.id]; return n })}
                          style={{ background: 'transparent', color: '#888', border: '1px solid #555', borderRadius: 4, padding: '4px 10px', cursor: 'pointer', fontSize: 12 }}>Cancel</button>
                      </>
                    ) : (
                      <>
                        <button onClick={() => setEditing(prev => ({ ...prev, [rule.id]: { pattern: rule.pattern, category_id: rule.category_id } }))}
                          style={{ background: 'transparent', color: '#60a5fa', border: '1px solid #60a5fa', borderRadius: 4, padding: '4px 10px', cursor: 'pointer', fontSize: 12 }}>Edit</button>
                        <button onClick={() => handleDelete(rule.id)}
                          style={{ background: 'transparent', color: '#f87171', border: '1px solid #f87171', borderRadius: 4, padding: '4px 10px', cursor: 'pointer', fontSize: 12 }}>Delete</button>
                      </>
                    )}
                  </td>
                </tr>
              )
            })}
            {rules.length === 0 && (
              <tr><td colSpan={3} style={{ padding: 24, textAlign: 'center', color: '#555' }}>No rules yet. Add one above.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Run all frontend tests**

```bash
cd frontend && npx vitest run
# Expected: all passed
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/
git commit -m "feat: Budget and Rules pages"
```

---

## Task 14: End-to-End Smoke Test

- [ ] **Step 1: Start backend**

```bash
cd backend && source .venv/bin/activate && uvicorn main:app --reload
```

- [ ] **Step 2: Start frontend**

```bash
cd frontend && npm run dev
```

- [ ] **Step 3: Manual smoke test checklist**

- [ ] Open http://localhost:5173 — Dashboard loads with empty charts
- [ ] Navigate to Import — file upload form visible
- [ ] Import an ING CSV export — preview shows rows, confirm imports them
- [ ] Navigate to Transactions — imported transactions visible, unconfirmed ones at top
- [ ] Click "N need review" — ReviewCard appears for an AI-categorised transaction
- [ ] Confirm a transaction — it moves to confirmed state
- [ ] Navigate to Budget — current month auto-populated with default amounts, actual amounts updating
- [ ] Navigate to Rules — add a rule for a known merchant, verify it shows in the list
- [ ] Return to Dashboard — charts now reflect imported data

- [ ] **Step 4: Run full backend test suite**

```bash
cd backend && pytest tests/ -v
# Expected: all passed
```

- [ ] **Step 5: Final commit**

```bash
git add .
git commit -m "feat: complete household finance tracker v1"
```
