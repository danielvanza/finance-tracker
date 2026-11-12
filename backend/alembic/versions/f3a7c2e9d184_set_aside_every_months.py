"""A set-aside comes back every so many months, not only every year.

Revision ID: f3a7c2e9d184
Revises: d2f8a6c31e75

A yearly bill becomes every 12 months; a one-off has no number.
"""
from alembic import op
import sqlalchemy as sa

revision = "f3a7c2e9d184"
down_revision = "d2f8a6c31e75"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("set_asides", sa.Column("every_months", sa.Integer(), nullable=True))
    op.execute("UPDATE set_asides SET every_months = 12 WHERE yearly")
    with op.batch_alter_table("set_asides") as batch:
        batch.drop_column("yearly")


def downgrade():
    op.add_column("set_asides", sa.Column("yearly", sa.Boolean(), nullable=False, server_default="1"))
    op.execute("UPDATE set_asides SET yearly = every_months IS NOT NULL")
    with op.batch_alter_table("set_asides") as batch:
        batch.drop_column("every_months")
