"""Turns Claude's references to query results into the figures people read.

Claude never types a figure into an analytical answer. It writes {q1.r3.spent_cents} and the app fills in
that cell, so an amount cannot be mistyped, invented or shown in the wrong unit.
"""
import re
from dataclasses import dataclass
from datetime import date

from assistant import charts

_REFERENCE = re.compile(r"\{(q\d+)\.r(\d+)\.(\w+)\}")
_QUERY_WORDS = ("SELECT ", " FROM ", "WHERE ", "GROUP BY", "ORDER BY")
_QUERY_NAMES = ("_cents", "_eur", "_pct", "_count", "category_months", "month_totals", "spending table", "coverage table")
_QUERY_CLAUSES = (" where ", " group by ", " order by ", " join ", " limit ", "count(", "sum(", "avg(", "*")
_UNITS = ("_cents", "_eur", "_pct", "_count")
_MONEY_SIGNS = ("€", "$", "%")
# Words that make an amount out of plain prose. Small numbers such as "six months" are fine in words.
_AMOUNT_WORDS = {
    "euro", "euros", "eur", "cent", "cents", "bucks", "hundred", "thousand", "million", "percent", "percentage",
    "honderd", "duizend", "miljoen", "procent",
    # From thirteen up a number word is an amount in disguise; counts up to twelve read naturally in words.
    "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty", "thirty", "forty",
    "fifty", "sixty", "seventy", "eighty", "ninety", "dertien", "veertien", "vijftien", "zestien", "zeventien",
    "achttien", "negentien", "twintig", "dertig", "veertig", "vijftig", "zestig", "zeventig", "tachtig", "negentig",
}
_MONTHS = ("January", "February", "March", "April", "May", "June", "July", "August", "September", "October",
           "November", "December")


def month_name(label: str) -> str:
    year, month = label.split("-")
    return f"{_MONTHS[int(month) - 1]} {year}"


def period_name(first: str, last: str) -> str:
    if first == last:
        return month_name(first)
    start = _MONTHS[int(first[5:]) - 1] if first[:4] == last[:4] else month_name(first)
    return f"{start} to {month_name(last)}"


def _shown(column: str, value) -> str:
    if isinstance(value, str):
        try:
            if column == "month":
                return month_name(value)
            if column == "date":
                day = date.fromisoformat(value)
                return f"{day.day} {_MONTHS[day.month - 1]} {day.year}"
        except (ValueError, IndexError):
            pass  # a label that only looks like a month is shown as it is
        return value
    return charts.exact_label(value, charts.unit_of(column))


def _without_names(prose: str, names) -> str:
    """The words with every category and merchant name taken out, so "Euro Shop" is a name, not an amount."""
    lowered = " ".join(prose.lower().split())
    candidates = set()
    for name in names:
        words = name.split()
        candidates |= {" ".join(words[:n]) for n in range(min(2, len(words)), len(words) + 1)}
    for candidate in sorted((c for c in candidates if len(c) >= 3), key=len, reverse=True):
        lowered = lowered.replace(candidate, " ")
    return lowered


def _reads_like_a_query(prose: str) -> bool:
    lowered = f" {' '.join(prose.lower().split())} "
    if any(name in lowered for name in _QUERY_NAMES) or any(word in prose for word in _QUERY_WORDS):
        return True
    return "select " in lowered and " from " in lowered and any(clause in lowered for clause in _QUERY_CLAUSES)


def wording_problems(text: str, names=()) -> list[str]:
    """What the words around the references may not contain, said precisely enough to fix."""
    prose = _REFERENCE.sub(" ", text)
    plain = _without_names(prose, names)
    words = set("".join(c if c.isalpha() else " " for c in plain).split())
    found = sorted(words & _AMOUNT_WORDS) + [sign for sign in _MONEY_SIGNS if sign in plain]
    if any(c.isdigit() for c in plain):
        found.append("digits")
    problems = []
    if found:
        problems.append(
            f"The words contain {', '.join(repr(f) for f in found)}. Amounts, counts above twelve, percentages and "
            "dates come only from references such as {q1.r2.spent_cents}, which already carry their € or % sign. "
            "Small counts and lengths of time are fine in words, such as three shops or six months."
        )
    if _reads_like_a_query(prose):
        problems.append("Say this in plain words, without query text, table or column names.")
    return problems


@dataclass
class Filled:
    text: str
    cited: set[str]
    problems: list[str]


def fill(text: str, results: list[dict]) -> Filled:
    """The words with every reference replaced by its cell, and what could not be resolved."""
    by_id = {r["id"]: r for r in results if "rows" in r}
    cited: set[str] = set()
    problems: list[str] = []

    def replace(match: re.Match) -> str:
        query, row, column = match.group(1), int(match.group(2)), match.group(3)
        result = by_id.get(query)
        if result is None:
            problems.append(f"{match.group(0)}: there is no result {query}.")
        elif not 1 <= row <= len(result["rows"]):
            problems.append(f"{match.group(0)}: {query} has rows r1 to r{len(result['rows'])}.")
        elif column not in result["columns"]:
            problems.append(f"{match.group(0)}: {query} has columns {result['columns']}.")
        else:
            value = result["rows"][row - 1][result["columns"].index(column)]
            if isinstance(value, (int, float)) and not column.endswith(_UNITS):
                problems.append(
                    f"{match.group(0)}: name the column for its unit, ending in _cents, _eur, _pct or _count, "
                    "so it is shown the right way."
                )
            elif value is None:
                problems.append(f"{match.group(0)}: that cell is empty.")
            else:
                cited.add(query)
                return _shown(column, value)
        return match.group(0)

    return Filled(_REFERENCE.sub(replace, text), cited, problems)
