"""Chat assistant: saved conversations and proposed changes.

Revision ID: c41f9a7d2b10
Revises: afe0635828ba
"""
from alembic import op
import sqlalchemy as sa

revision = "c41f9a7d2b10"
down_revision = "afe0635828ba"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "chat_messages",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("channel", sa.String(), nullable=False),
        sa.Column("role", sa.String(), nullable=False),
        sa.Column("kind", sa.String(), nullable=False),
        sa.Column("text", sa.Text(), nullable=False, server_default=""),
        sa.Column("status", sa.String(), nullable=False, server_default="done"),
        sa.Column("reply_to", sa.Integer(), nullable=True),
        sa.Column("payload", sa.JSON(), nullable=True),
        sa.Column("file_content", sa.LargeBinary(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_chat_messages_channel", "chat_messages", ["channel", "id"])
    op.create_index("ix_chat_messages_status", "chat_messages", ["status"])
    op.create_table(
        "chat_proposals",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("channel", sa.String(), nullable=False),
        sa.Column(
            "message_id", sa.Integer(),
            sa.ForeignKey("chat_messages.id", ondelete="CASCADE"), nullable=False,
        ),
        sa.Column("op", sa.String(), nullable=False),
        sa.Column("args", sa.JSON(), nullable=False),
        sa.Column("summary", sa.Text(), nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("preview", sa.JSON(), nullable=False),
        sa.Column("status", sa.String(), nullable=False, server_default="pending"),
        sa.Column("result", sa.JSON(), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
    )
    op.create_index("ix_chat_proposals_channel_status", "chat_proposals", ["channel", "status"])


def downgrade() -> None:
    op.drop_table("chat_proposals")
    op.drop_table("chat_messages")
