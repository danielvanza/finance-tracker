"""baseline — schema matching backend/models.py exactly

Revision ID: afe0635828ba
Revises:
Create Date: 2026-08-23

Hand-written (autogen-free) baseline of the seven application tables:
categories, standing_adjustments, transactions, transaction_splits, rules,
budgets, settings. Every column type, nullability, server default, unique
constraint and FK ondelete mirrors backend/models.py as of FIN-E3.

Existing databases whose schema already equals this baseline (i.e. anything
migrated by the retired hand-rolled run_migrations in db.py) are registered
with `alembic stamp head`; fresh databases are created by `upgrade head`.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "afe0635828ba"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Creation order follows FK dependencies:
    # categories -> standing_adjustments -> transactions -> transaction_splits.
    op.create_table(
        "categories",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(), nullable=False, unique=True),
        sa.Column(
            "type",
            sa.Enum("needs", "wants", "savings", "income", "exclude", name="categorytype"),
            nullable=False,
        ),
        sa.Column("sort_order", sa.Integer(), nullable=True),
    )

    op.create_table(
        "standing_adjustments",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(), nullable=False, unique=True),
        sa.Column("amount", sa.Numeric(12, 2), nullable=False),
        sa.Column("income_category_id", sa.Integer(), nullable=False),
        sa.Column("expense_category_id", sa.Integer(), nullable=False),
        sa.Column("active", sa.Boolean(), nullable=False, server_default="1"),
        sa.Column("start_month", sa.Date(), nullable=False),
        sa.ForeignKeyConstraint(
            ["income_category_id"], ["categories.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["expense_category_id"], ["categories.id"], ondelete="CASCADE"
        ),
    )

    op.create_table(
        "transactions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column("amount", sa.Numeric(12, 2), nullable=False),
        sa.Column("description", sa.String(), nullable=False),
        sa.Column(
            "source",
            sa.Enum("ing", "revolut", "degiro", "manual", name="transactionsource"),
            nullable=False,
        ),
        sa.Column("category_id", sa.Integer(), nullable=True),
        sa.Column("confirmed", sa.Boolean(), nullable=True),
        sa.Column(
            "categorised_by",
            sa.Enum("rule", "ai", "manual", name="categorisedby"),
            nullable=True,
        ),
        sa.Column("ai_confidence", sa.Float(), nullable=True),
        sa.Column("import_hash", sa.String(), nullable=False, unique=True),
        # R7 columns.
        sa.Column("is_refund", sa.Boolean(), nullable=False, server_default="0"),
        sa.Column("standing_adjustment_id", sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(
            ["category_id"], ["categories.id"], ondelete="SET NULL"
        ),
        sa.ForeignKeyConstraint(
            ["standing_adjustment_id"],
            ["standing_adjustments.id"],
            ondelete="SET NULL",
        ),
    )

    op.create_table(
        "transaction_splits",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("transaction_id", sa.Integer(), nullable=False),
        sa.Column("category_id", sa.Integer(), nullable=True),
        sa.Column("amount", sa.Numeric(12, 2), nullable=False),
        # BOOLEAN NULL — NULL inherits the parent transaction's is_refund.
        sa.Column("is_refund", sa.Boolean(), nullable=True),
        sa.ForeignKeyConstraint(
            ["transaction_id"], ["transactions.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["category_id"], ["categories.id"], ondelete="SET NULL"
        ),
    )

    op.create_table(
        "rules",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("pattern", sa.String(), nullable=False),
        sa.Column("category_id", sa.Integer(), nullable=False),
        sa.Column("priority", sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(["category_id"], ["categories.id"], ondelete="CASCADE"),
    )

    op.create_table(
        "budgets",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("category_id", sa.Integer(), nullable=False),
        sa.Column("month", sa.Date(), nullable=True),  # NULL = default template
        sa.Column("planned_amount", sa.Numeric(12, 2), nullable=False),
        sa.ForeignKeyConstraint(["category_id"], ["categories.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("category_id", "month"),
    )

    op.create_table(
        "settings",
        sa.Column("key", sa.String(length=100), primary_key=True),
        sa.Column("value", sa.String(length=500), nullable=False),
    )


def downgrade() -> None:
    # Reverse creation order.
    op.drop_table("settings")
    op.drop_table("budgets")
    op.drop_table("rules")
    op.drop_table("transaction_splits")
    op.drop_table("transactions")
    op.drop_table("standing_adjustments")
    op.drop_table("categories")
