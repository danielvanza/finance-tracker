"""Chat assistant: which Telegram messages show a reply.

Revision ID: e7b2c9a14f30
Revises: c41f9a7d2b10
"""
from alembic import op
import sqlalchemy as sa

revision = "e7b2c9a14f30"
down_revision = "c41f9a7d2b10"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("chat_messages") as batch:
        batch.add_column(sa.Column("delivered_ids", sa.JSON(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("chat_messages") as batch:
        batch.drop_column("delivered_ids")
