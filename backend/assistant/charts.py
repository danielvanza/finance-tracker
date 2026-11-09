"""Charts for the chats. Claude only says which result to draw; the numbers come from that result."""
import io
import math
import re
import threading

MAX_SERIES = 6
_WIDTH_INCHES, _HEIGHT_INCHES, _ROW_INCHES = 5.2, 3.5, 0.2
OTHER = "Other"

# Validated for colour-blind separation on the card colour of each theme (dataviz validator).
_THEMES = {
    "day": {
        "surface": "#f4ecdd", "ink": "#2a2520", "quiet": "#6a6259", "grid": "#ddd2bf", "other": "#8c8378",
        "series": ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300"],
    },
    "night": {
        "surface": "#2f2a26", "ink": "#efe5d3", "quiet": "#b1a797", "grid": "#463f38", "other": "#8f8576",
        "series": ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300"],
    },
}
_MARKERS = ["o", "s", "^", "D", "v", "P", "X"]  # so a line is never told apart by colour alone
_lock = threading.Lock()  # the font machinery underneath is not safe to share between threads


class ChartProblem(Exception):
    pass


def _column(result: dict, name) -> int:
    try:
        return result["columns"].index(name)
    except ValueError:
        raise ChartProblem(f"no column {name}") from None


def prepare(spec, results: list[dict]) -> dict | None:
    """What to draw, taken from one query result. None if there is nothing worth drawing.

    Raises ChartProblem if the chart asked for can't be made from that result.
    """
    if not isinstance(spec, dict):
        raise ChartProblem("not a chart description")
    result = next((r for r in results if r.get("id") == spec.get("query")), None)
    if result is None or "rows" not in result:
        raise ChartProblem("no such result")
    if result["cut_off"]:
        raise ChartProblem("the result was cut off")

    x_at, y_at = _column(result, spec.get("x")), _column(result, spec.get("y"))
    series_at = _column(result, spec["series"]) if spec.get("series") else None
    labels: list[str] = []
    table: dict[str, dict[str, float]] = {}
    for row in result["rows"]:
        value = row[y_at]
        if value is None:
            continue
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise ChartProblem("the values are not numbers")
        label, name = str(row[x_at]), str(row[series_at]) if series_at is not None else str(spec.get("y"))
        if label not in labels:
            labels.append(label)
        if label in table.setdefault(name, {}):
            raise ChartProblem("two values for one point")
        table[name][label] = value
    if sum(len(points) for points in table.values()) < 2:
        return None  # a single number is said, not drawn
    if all(re.fullmatch(r"\d{4}-\d{2}(-\d{2})?", label) for label in labels):
        labels.sort()

    ranked = sorted(table, key=lambda n: -sum(abs(v) for v in table[n].values()))
    kept, rest = ranked[:MAX_SERIES], ranked[MAX_SERIES:]
    if len(rest) == 1:
        kept, rest = ranked, []
    series = [{"name": n, "values": [table[n].get(label, 0) for label in labels]} for n in kept]
    if rest:
        series.append({"name": OTHER, "values": [sum(table[n].get(label, 0) for n in rest) for label in labels]})
    return {
        "type": "line" if spec.get("type") == "line" else "bars",
        "title": str(spec.get("title") or "")[:90],
        "labels": labels,
        "series": series,
        "unit": unit_of(str(spec.get("y"))),
    }


def unit_of(column: str) -> str:
    """How a column's values are shown, from the unit its name ends in."""
    for suffix, unit in (("_cents", "cents"), ("_eur", "euros"), ("_pct", "percent")):
        if column.endswith(suffix):
            return unit
    return "number"


def _dutch(value: float, decimals: int) -> str:
    return f"{value:,.{decimals}f}".translate(str.maketrans(",.", ".,"))


def exact_label(value: float, unit: str) -> str:
    """A figure as the text writes it, to the cent."""
    sign = "-" if value < 0 else ""
    size = abs(value)
    if unit in ("cents", "euros"):
        return f"{sign}€{_dutch(size / 100 if unit == 'cents' else size, 2)}"
    written = f"{size:.2f}".rstrip("0").rstrip(".").replace(".", ",")
    return f"{sign}{written}{'%' if unit == 'percent' else ''}"


def _tick_label(value: float, unit: str) -> str:
    """The scale along the axis: round numbers, not data."""
    sign = "-" if value < 0 else ""
    if unit in ("cents", "euros"):
        return f"{sign}€{_dutch(abs(value) / 100 if unit == 'cents' else abs(value), 0)}"
    return exact_label(value, unit)


def _colour(colours: dict, index: int, name: str) -> str:
    return colours["other"] if name == OTHER else colours["series"][index % len(colours["series"])]


def _place_legend(figure, count: int, colours: dict) -> None:
    """A legend that fits: as many columns as its names allow, and a taller picture when it needs more rows."""
    for columns in range(min(count, 4), 0, -1):
        legend = figure.legend(
            loc="outside lower center", ncols=columns, frameon=False, fontsize=9, labelcolor=colours["quiet"],
        )
        figure.set_size_inches(_WIDTH_INCHES, _HEIGHT_INCHES + _ROW_INCHES * (math.ceil(count / columns) - 1))
        figure.canvas.draw()
        box = legend.get_window_extent(figure.canvas.get_renderer())
        if columns == 1 or (box.x0 >= 0 and box.x1 <= figure.bbox.x1):
            return
        legend.remove()


def render(chart: dict, theme: str = "day") -> bytes:
    """The chart as a PNG. Drawn fresh from the saved numbers, so it can follow the app's theme."""
    from matplotlib.backends.backend_agg import FigureCanvasAgg
    from matplotlib.figure import Figure
    from matplotlib.ticker import FuncFormatter

    colours = _THEMES["night" if theme == "night" else "day"]
    labels, series, unit = chart["labels"], chart["series"], chart["unit"]
    with _lock:
        figure = Figure(figsize=(_WIDTH_INCHES, _HEIGHT_INCHES), dpi=220, facecolor=colours["surface"], layout="constrained")
        FigureCanvasAgg(figure)
        axes = figure.add_subplot(facecolor=colours["surface"])
        positions = list(range(len(labels)))
        negative = any(v < 0 for s in series for v in s["values"])

        if chart["type"] == "line" or (len(series) > 1 and negative):
            for i, s in enumerate(series):
                axes.plot(
                    positions, s["values"], label=s["name"], color=_colour(colours, i, s["name"]), linewidth=2,
                    marker=_MARKERS[i % len(_MARKERS)], markersize=7, markeredgecolor=colours["surface"],
                    markeredgewidth=1.5, zorder=3,
                )
            if len(series) == 1:
                last = series[0]["values"][-1]
                axes.annotate(
                    exact_label(last, unit), (positions[-1], last), textcoords="offset points", xytext=(0, 9),
                    ha="center", color=colours["ink"], fontsize=9,
                )
        else:
            base = [0.0] * len(labels)
            for i, s in enumerate(series):
                bars = axes.bar(
                    positions, s["values"], bottom=base, width=0.62, label=s["name"],
                    color=_colour(colours, i, s["name"]), edgecolor=colours["surface"], linewidth=1.5, zorder=3,
                )
                if len(series) == 1:
                    axes.bar_label(
                        bars, labels=[exact_label(v, unit) for v in s["values"]], padding=3, color=colours["ink"], fontsize=9,
                    )
                base = [b + v for b, v in zip(base, s["values"])]

        from assistant.figures import month_name  # here, because figures itself draws on this module

        shown = [month_name(label).replace(" ", "\n") if re.fullmatch(r"\d{4}-\d{2}", label) else label for label in labels]
        axes.set_xticks(positions, shown)
        if len(labels) > 8:
            axes.tick_params(axis="x", labelrotation=45)
        axes.yaxis.set_major_formatter(FuncFormatter(lambda value, _: _tick_label(value, unit)))
        axes.tick_params(colors=colours["quiet"], labelsize=9, length=0)
        axes.grid(axis="y", color=colours["grid"], linewidth=0.8, zorder=0)
        axes.set_axisbelow(True)
        for side in ("top", "right", "left"):
            axes.spines[side].set_visible(False)
        axes.spines["bottom"].set_color(colours["grid"])
        if chart["title"]:
            axes.set_title(chart["title"], loc="left", color=colours["ink"], fontsize=12, pad=12)
        if len(series) > 1:
            _place_legend(figure, len(series), colours)

        output = io.BytesIO()
        figure.savefig(output, format="png", facecolor=colours["surface"])
    return output.getvalue()
