"""Just works for two: the shared account only, set-asides, and guesses that are sure or doubtful.

Revision ID: b7e4d1c9a2f0
Revises: a9d3e6b17c42

Data, on a database that already has a household in it:
- Standing adjustments go, with the payments they invented. The two categories that were seeded for
  them ("Retained Salary", "Personal Allowance") go too when they are then empty; "Personal Allowance"
  with real payments in it stays as "To personal accounts". Any other category an adjustment used is
  kept as it is. An expense category that stays has its plan lowered by what the invented payments took.
- The "Refunds" income category goes. Payments that were in it wait for an answer again, to be booked
  as refunds against what was bought.
- A guess a person already confirmed is marked as theirs, so "sorted automatically" can mean the app.
- Rows from a bank the app no longer imports are kept as manual entries.
- A "To personal accounts" category and the 50/30/20 target split are added.
- The Telegram conversation starts afresh, because it moves from a private chat to the household's
  group: a card left open in the old chat is withdrawn and cannot be applied from the group.
"""
from alembic import op
import sqlalchemy as sa

revision = "b7e4d1c9a2f0"
down_revision = "a9d3e6b17c42"
branch_labels = None
depends_on = None

PERSONAL = "To personal accounts"
SEEDED_FOR_ADJUSTMENTS = ("Retained Salary", "Personal Allowance")


def _unused(conn, category_id: int) -> bool:
    for table in ("transactions", "transaction_splits", "rules"):
        if conn.execute(sa.text(f"SELECT 1 FROM {table} WHERE category_id = :c LIMIT 1"), {"c": category_id}).first():
            return False
    return True


def _drop_category(conn, category_id: int) -> None:
    conn.execute(sa.text("DELETE FROM rules WHERE category_id = :c"), {"c": category_id})
    conn.execute(sa.text("DELETE FROM budgets WHERE category_id = :c"), {"c": category_id})
    conn.execute(sa.text("DELETE FROM categories WHERE id = :c"), {"c": category_id})


def upgrade() -> None:
    conn = op.get_bind()

    adjustments = conn.execute(sa.text(
        "SELECT income_category_id, expense_category_id, amount, active FROM standing_adjustments"
    )).fetchall()
    invented = "SELECT id FROM transactions WHERE standing_adjustment_id IS NOT NULL"
    conn.execute(sa.text(f"DELETE FROM transaction_splits WHERE transaction_id IN ({invented})"))
    conn.execute(sa.text("DELETE FROM transactions WHERE standing_adjustment_id IS NOT NULL"))
    planned_for_invented: dict[int, float] = {}
    for row in adjustments:
        # Only an adjustment that was switched on still had a plan made for it.
        taken = float(row.amount) if row.active else 0
        planned_for_invented[row.expense_category_id] = planned_for_invented.get(row.expense_category_id, 0) + taken
    for category_id in {row.income_category_id for row in adjustments} | set(planned_for_invented):
        name = conn.execute(sa.text("SELECT name FROM categories WHERE id = :c"), {"c": category_id}).scalar()
        # Only the categories that existed for the adjustments are removed or renamed. One the household
        # also uses for other things ("Food - Essential", "Other Income") is theirs and stays as it is.
        seeded = name in SEEDED_FOR_ADJUSTMENTS
        if seeded and _unused(conn, category_id):
            _drop_category(conn, category_id)
        elif category_id in planned_for_invented:
            # The category stays, without the part of its plan that only covered the invented payments.
            conn.execute(sa.text(
                "UPDATE budgets SET planned_amount = MAX(0, planned_amount - :a) WHERE category_id = :c"
            ), {"a": planned_for_invented[category_id], "c": category_id})
            # Real payments in the allowance category were money moved to a personal account.
            if seeded and not conn.execute(sa.text("SELECT 1 FROM categories WHERE name = :n"), {"n": PERSONAL}).first():
                conn.execute(sa.text("UPDATE categories SET name = :n WHERE id = :c AND type IN ('needs', 'wants')"),
                             {"n": PERSONAL, "c": category_id})

    refunds = conn.execute(sa.text("SELECT id FROM categories WHERE name = 'Refunds' AND type = 'income'")).first()
    if refunds:
        waiting_again = "category_id = NULL, confirmed = 0, categorised_by = NULL, ai_confidence = NULL"
        split = "SELECT transaction_id FROM transaction_splits WHERE category_id = :c"
        conn.execute(sa.text(f"UPDATE transactions SET {waiting_again} WHERE id IN ({split})"), {"c": refunds.id})
        conn.execute(sa.text(
            f"DELETE FROM transaction_splits WHERE transaction_id IN (SELECT id FROM transactions WHERE confirmed = 0) "
            f"AND transaction_id IN ({split})"
        ), {"c": refunds.id})
        conn.execute(sa.text(f"UPDATE transactions SET {waiting_again} WHERE category_id = :c"), {"c": refunds.id})
        _drop_category(conn, refunds.id)

    conn.execute(sa.text("UPDATE transactions SET categorised_by = 'manual' WHERE categorised_by = 'ai' AND confirmed = 1"))
    conn.execute(sa.text("UPDATE transactions SET source = 'manual' WHERE source NOT IN ('ing', 'manual')"))

    if conn.execute(sa.text("SELECT 1 FROM chat_messages WHERE channel = 'telegram' LIMIT 1")).first():
        conn.execute(sa.text(
            "UPDATE chat_proposals SET status = 'superseded' WHERE channel = 'telegram' AND status = 'pending' AND op != 'merge'"
        ))
        conn.execute(sa.text(
            "INSERT INTO chat_messages (channel, role, kind, text, status, created_at) "
            "VALUES ('telegram', 'system', 'new_chat', '', 'done', CURRENT_TIMESTAMP)"
        ))

    op.create_table(
        "set_asides",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("amount", sa.Numeric(12, 2), nullable=False),
        sa.Column("start_month", sa.Date(), nullable=False),
        sa.Column("due_month", sa.Date(), nullable=False),
        sa.Column("yearly", sa.Boolean(), nullable=False, server_default="1"),
    )
    op.create_table("ignored_bills", sa.Column("key", sa.String(), primary_key=True))

    with op.batch_alter_table("transactions", recreate="always") as batch:
        batch.drop_column("standing_adjustment_id")
        batch.add_column(sa.Column("ai_options", sa.JSON(), nullable=True))
        batch.add_column(sa.Column("set_aside_id", sa.Integer(), nullable=True))
        batch.create_foreign_key("fk_transactions_set_aside", "set_asides", ["set_aside_id"], ["id"], ondelete="SET NULL")
    op.drop_table("standing_adjustments")
    with op.batch_alter_table("rules") as batch:
        batch.drop_column("priority")

    # A fresh database is filled by the seed, which only runs while there are no categories.
    if conn.execute(sa.text("SELECT 1 FROM categories LIMIT 1")).first():
        if not conn.execute(sa.text("SELECT 1 FROM categories WHERE name = :n"), {"n": PERSONAL}).first():
            last = conn.execute(sa.text("SELECT COALESCE(MAX(sort_order), 0) FROM categories")).scalar()
            conn.execute(sa.text("INSERT INTO categories (name, type, sort_order) VALUES (:n, 'wants', :o)"),
                         {"n": PERSONAL, "o": last + 1})
            new_id = conn.execute(sa.text("SELECT id FROM categories WHERE name = :n"), {"n": PERSONAL}).scalar()
            conn.execute(sa.text("INSERT INTO budgets (category_id, month, planned_amount) VALUES (:c, NULL, 0)"), {"c": new_id})
        if not conn.execute(sa.text("SELECT 1 FROM settings WHERE key = 'target_split'")).first():
            conn.execute(sa.text("INSERT INTO settings (key, value) VALUES ('target_split', '50/30/20')"))


def downgrade() -> None:
    """The earlier tables and columns come back empty; what the upgrade removed is not restored."""
    op.create_table(
        "standing_adjustments",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(), nullable=False, unique=True),
        sa.Column("amount", sa.Numeric(12, 2), nullable=False),
        sa.Column("income_category_id", sa.Integer(), sa.ForeignKey("categories.id", ondelete="CASCADE"), nullable=False),
        sa.Column("expense_category_id", sa.Integer(), sa.ForeignKey("categories.id", ondelete="CASCADE"), nullable=False),
        sa.Column("active", sa.Boolean(), nullable=False, server_default="1"),
        sa.Column("start_month", sa.Date(), nullable=False),
    )
    with op.batch_alter_table("rules") as batch:
        batch.add_column(sa.Column("priority", sa.Integer(), nullable=True))
    with op.batch_alter_table("transactions", recreate="always") as batch:
        batch.drop_column("set_aside_id")
        batch.drop_column("ai_options")
        batch.add_column(sa.Column("standing_adjustment_id", sa.Integer(), nullable=True))
        batch.create_foreign_key(
            "fk_transactions_standing_adjustment", "standing_adjustments", ["standing_adjustment_id"], ["id"],
            ondelete="SET NULL",
        )
    op.drop_table("ignored_bills")
    op.drop_table("set_asides")
