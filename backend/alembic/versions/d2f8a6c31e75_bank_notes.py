"""The bank's note is kept with each payment.

Revision ID: d2f8a6c31e75
Revises: b7e4d1c9a2f0

Payments imported before this have no note; importing their file again fills it in.
"""
from alembic import op
import sqlalchemy as sa

revision = "d2f8a6c31e75"
down_revision = "b7e4d1c9a2f0"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("transactions", sa.Column("note", sa.Text(), nullable=True))


def downgrade():
    with op.batch_alter_table("transactions") as batch:
        batch.drop_column("note")
