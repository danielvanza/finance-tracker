import sqlite3

con = sqlite3.connect("data/finance.db")
for t in ["categories", "transactions", "transaction_splits", "standing_adjustments", "rules", "budgets", "settings"]:
    cols = [r[1] for r in con.execute("PRAGMA table_info(%s)" % t)]
    n = con.execute("SELECT COUNT(*) FROM %s" % t).fetchone()[0]
    print(t, n, cols)
tables = [r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table'")]
print("has alembic_version:", "alembic_version" in tables)
