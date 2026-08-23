"""R7 regression guard: importing db.py must create missing sqlite directories.

Runs a subprocess so DATABASE_URL is set before db is ever imported (the
module reads the env var at import time and would otherwise already be
initialised with the default URL in this process).
"""
import os
import subprocess
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent

PROBE = (
    "import db\n"
    "from sqlalchemy import text\n"
    "session = db.SessionLocal()\n"
    "print(session.execute(text('SELECT 1')).scalar())\n"
)

def test_import_creates_missing_sqlite_dirs(tmp_path):
    target = tmp_path / "x" / "y" / "probe.db"
    assert not target.parent.exists()  # nested dir must not pre-exist

    result = subprocess.run(
        [sys.executable, "-c", PROBE],
        cwd=BACKEND_DIR,
        env={**os.environ, "DATABASE_URL": f"sqlite:///{target}"},
        capture_output=True,
        text=True,
        timeout=60,
    )

    assert result.returncode == 0, result.stderr
    assert result.stdout.strip().endswith("1")  # SELECT 1 worked end-to-end
    assert target.parent.is_dir()


PROBE_URL = (
    f"import sys; sys.path.insert(0, r'{BACKEND_DIR}'); "
    "import db; print(db.DATABASE_URL)"
)


def test_default_db_path_is_cwd_independent(tmp_path):
    expected = f"sqlite:///{(BACKEND_DIR / 'data' / 'finance.db')}"
    seen = set()
    for cwd in (BACKEND_DIR, tmp_path):
        result = subprocess.run(
            [sys.executable, "-c", PROBE_URL],
            cwd=cwd,
            capture_output=True,
            text=True,
            timeout=60,
            env={k: v for k, v in os.environ.items() if k != "DATABASE_URL"},
        )
        assert result.returncode == 0, result.stderr
        seen.add(result.stdout.strip())
    assert len(seen) == 1
    assert seen.pop() == expected
