"""The date a single financial month begins, when it differs from the start day.

Revision ID: c8a1f5d2e7b4
Revises: b3f9e2d71c58
"""
from alembic import op
import sqlalchemy as sa

revision = "c8a1f5d2e7b4"
down_revision = "b3f9e2d71c58"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "month_starts",
        sa.Column("year", sa.Integer(), nullable=False),
        sa.Column("month", sa.Integer(), nullable=False),
        sa.Column("start_date", sa.Date(), nullable=False),
        sa.PrimaryKeyConstraint("year", "month"),
    )


def downgrade() -> None:
    op.drop_table("month_starts")
