"""Small wording helpers for the chats: month names, and spotting query text where plain words belong."""

_QUERY_WORDS = ("SELECT ", " FROM ", "WHERE ", "GROUP BY", "ORDER BY")
_QUERY_NAMES = ("_cents", "_eur", "_pct", "_count", "category_months", "month_totals", "spending table", "coverage table")
_QUERY_CLAUSES = (" where ", " group by ", " order by ", " join ", " limit ", "count(", "sum(", "avg(", "*")
_MONTHS = ("January", "February", "March", "April", "May", "June", "July", "August", "September", "October",
           "November", "December")


def month_name(label: str) -> str:
    year, month = label.split("-")
    return f"{_MONTHS[int(month) - 1]} {year}"


def reads_like_a_query(prose: str) -> bool:
    lowered = f" {' '.join(prose.lower().split())} "
    if any(name in lowered for name in _QUERY_NAMES) or any(word in prose for word in _QUERY_WORDS):
        return True
    return "select " in lowered and " from " in lowered and any(clause in lowered for clause in _QUERY_CLAUSES)
