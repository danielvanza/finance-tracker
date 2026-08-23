"""Compare content of the two divergent finance.db copies. Throwaway probe."""
import sqlite3

def dump(f):
    con = sqlite3.connect(f"file:{f}?mode=ro", uri=True)
    lines = []
    for (t,) in con.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"):
        cols = [c[1] for c in con.execute(f'PRAGMA table_info("{t}")')]
        lines.append(f"TABLE {t} {cols}")
        for row in con.execute(f'SELECT * FROM "{t}" ORDER BY 1'):
            lines.append(repr(row))
    con.close()
    return lines

a, b = dump("data/finance.db"), dump("backend/data/finance.db")
print("identical content:", a == b)
if a != b:
    import difflib
    for l in difflib.unified_diff(a, b, "root", "backend", lineterm=""):
        print(l)
