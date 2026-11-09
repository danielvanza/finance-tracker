"""Chat assistant: a message or card id is never given out twice.

Work in progress holds on to a message's id, so after a Clear a reused id would tie the old work
to the next message.

Revision ID: a9d3e6b17c42
Revises: e7b2c9a14f30
"""
from alembic import op

revision = "a9d3e6b17c42"
down_revision = "e7b2c9a14f30"
branch_labels = None
depends_on = None

_TABLES = ("chat_messages", "chat_proposals")


def upgrade() -> None:
    for table in _TABLES:
        with op.batch_alter_table(table, recreate="always", table_kwargs={"sqlite_autoincrement": True}):
            pass


def downgrade() -> None:
    for table in _TABLES:
        with op.batch_alter_table(table, recreate="always"):
            pass
