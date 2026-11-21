"""Reminders the household asks the chat to set.

Revision ID: d9a4c7e2b5f1
Revises: b3f7d2a9e6c1
"""
from alembic import op
import sqlalchemy as sa

revision = "d9a4c7e2b5f1"
down_revision = "b3f7d2a9e6c1"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "reminders",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("text", sa.String(), nullable=False),
        sa.Column("next_at", sa.DateTime(), nullable=True),
        sa.Column("anchor_at", sa.DateTime(), nullable=False),
        sa.Column("every", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("last_sent_at", sa.DateTime(), nullable=True),
    )


def downgrade():
    op.drop_table("reminders")
