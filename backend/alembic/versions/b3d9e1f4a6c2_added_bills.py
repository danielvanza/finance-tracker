"""Fixed bills a person adds by hand, and corrections to the ones the app found.

Revision ID: b3d9e1f4a6c2
Revises: c5e8b2a7d913

added_bills: a fixed bill the payments do not show (new, or paid in a way the app cannot see repeat).
bill_changes: a new amount and/or day for a fixed bill found from repeating payments, by its key.
"""
from alembic import op
import sqlalchemy as sa

revision = "b3d9e1f4a6c2"
down_revision = "c5e8b2a7d913"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "added_bills",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("amount", sa.Numeric(12, 2), nullable=False),
        sa.Column("day", sa.Integer(), nullable=False),
        sa.Column("every_months", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("starts", sa.Date(), nullable=False),
        sa.Column("matches", sa.String(), nullable=False),
        sa.Column("category_id", sa.Integer(), sa.ForeignKey("categories.id", ondelete="SET NULL"), nullable=True),
    )
    op.create_table(
        "bill_changes",
        sa.Column("key", sa.String(), primary_key=True),
        sa.Column("amount", sa.Numeric(12, 2), nullable=True),
        sa.Column("day", sa.Integer(), nullable=True),
    )


def downgrade():
    op.drop_table("bill_changes")
    op.drop_table("added_bills")
