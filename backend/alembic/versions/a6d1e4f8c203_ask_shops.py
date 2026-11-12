"""Shops that are different every time: their payments are always asked about.

Revision ID: a6d1e4f8c203
Revises: f3a7c2e9d184
"""
from alembic import op
import sqlalchemy as sa

revision = "a6d1e4f8c203"
down_revision = "f3a7c2e9d184"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table("ask_shops", sa.Column("pattern", sa.String(), primary_key=True))


def downgrade():
    op.drop_table("ask_shops")
