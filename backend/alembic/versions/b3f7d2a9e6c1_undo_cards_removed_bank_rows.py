"""Undo for applied chat cards, and imported bank rows that were removed and must not come back.

Revision ID: b3f7d2a9e6c1
Revises: c5e8b2a7d913
"""
from alembic import op
import sqlalchemy as sa

revision = "b3f7d2a9e6c1"
down_revision = "c5e8b2a7d913"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "removed_bank_rows",
        sa.Column("import_hash", sa.String(), primary_key=True),
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column("amount", sa.Numeric(12, 2), nullable=False),
        sa.Column("description", sa.String(), nullable=False),
    )
    op.create_table(
        "applied_changes",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("card_id", sa.Integer(), nullable=False, unique=True),
        sa.Column("op", sa.String(), nullable=False),
        sa.Column("rows", sa.JSON(), nullable=False),
        sa.Column("applied_at", sa.DateTime(), nullable=False),
        sa.Column("undone_at", sa.DateTime(), nullable=True),
    )


def downgrade():
    op.drop_table("applied_changes")
    op.drop_table("removed_bank_rows")
