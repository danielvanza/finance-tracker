"""Files made in the chat: a spreadsheet of what was asked for, kept 30 days.

Revision ID: b3f9e2d71c58
Revises: b3d9e1f4a6c2
"""
from alembic import op
import sqlalchemy as sa

revision = "b3f9e2d71c58"
down_revision = "b3d9e1f4a6c2"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "exports",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("filename", sa.String(), nullable=False),
        sa.Column("content", sa.LargeBinary(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )


def downgrade():
    op.drop_table("exports")
