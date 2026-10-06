"""
Fundamentals sidecar — a small persistent process the Node server talks to.

Why this exists
---------------
The MCP server ships no fundamentals tool. Its `stock_prices` returns price and
% change only, and `stock_screener` returns a fixed column set. The same
`tradingview-screener` package the MCP depends on *can* return P/E, P/BV,
D/E and dividend yield, but only when you name the columns yourself — so the
lookup lives here instead of in a tool.

Protocol: newline-delimited JSON on stdin/stdout. One request per line:

    → {"id":1,"symbols":["SET:PTT"],"fields":["price_earnings_ttm"]}
    ← {"id":1,"data":{"SET:PTT":{"pe":9.56, ...}}}

The process is long-lived on purpose: importing pandas and
tradingview_screener costs a couple of seconds, and a board refreshes
fundamentals far more often than that.

Field names are TradingView's, and several differ from the obvious guess
(`debt_to_equity_fq`, not `debt_equity_fq`; `dividends_yield_current`, plural
"dividends"). The wrong ones come back as all-null rather than erroring, which
is why METRICS below is the single place that maps them.
"""

from __future__ import annotations

import json
import sys

# key -> (tradingview field, kind)
#   kind drives formatting: "ratio" -> 2 decimals, "percent" -> 1 decimal + %,
#   "money" -> compact (not currently used — see the note below), "number"
#
# Only scale-free fields are exposed: ratios and percentages. Absolute currency
# columns are deliberately excluded because the direct-ticker scan returns them
# scaled wrong — measured against P/E, `earnings_per_share_diluted_ttm` came back
# exactly 33.3x too small for all 15 SET names, `dividends_per_share_fq` and
# `market_cap_basic` were off by a similar order. Ratios and percentages are
# unit-free, so they survive that quirk intact; absolute amounts do not.
METRICS = {
    "pe": ("price_earnings_ttm", "ratio"),
    "pbv": ("price_book_fq", "ratio"),
    "de": ("debt_to_equity_fq", "ratio"),
    "dividendYield": ("dividends_yield_current", "percent"),
    "roe": ("return_on_equity_fq", "percent"),
    "roa": ("return_on_assets_fq", "percent"),
    "ps": ("price_sales_current", "ratio"),
    "evEbitda": ("enterprise_value_ebitda_ttm", "ratio"),
    "currentRatio": ("current_ratio", "ratio"),
    # Cross-checkable but not displayed: `earnings_per_share_diluted_ttm`,
    # `dividends_per_share_fq`, `market_cap_basic`, `net_debt`, `total_debt`.
    # Verified wrong on this endpoint; EPS can still be reconstructed exactly as
    # price / P/E if it is ever needed.
}

# Extra columns worth having even when not displayed: the exchange-scoped
# currency keeps "100M" unambiguous, and `name` doubles as a sanity check that
# the screener matched the symbol we asked for.
# NOTE: do not add "ticker" here — the scanner adds it on its own, and selecting
# it twice produces duplicate columns, which makes `to_dict("records")` drop
# the field entirely.
ALWAYS = ["name", "close", "currency", "description"]


def _clean(value):
    """NaN -> None; numpy scalars -> plain Python types."""
    if value is None:
        return None
    try:
        import math

        if isinstance(value, float) and math.isnan(value):
            return None
    except Exception:  # pragma: no cover - defensive only
        pass
    if hasattr(value, "item"):
        try:
            return value.item()
        except Exception:
            pass
    return value


def fetch(symbols: list[str], metrics: list[str]) -> dict:
    from tradingview_screener import Query

    wanted = [m for m in metrics if m in METRICS]
    fields = [*ALWAYS, *(METRICS[m][0] for m in wanted)]

    # Order matters: set_tickers() before select(), and a limit() equal to the
    # request size — the scanner's default page is 50 rows, so a larger board
    # would silently come back truncated.
    query = Query().set_tickers(*symbols).select(*fields).limit(len(symbols))
    _total, frame = query.get_scanner_data()

    out: dict[str, dict] = {}
    for record in frame.to_dict("records"):
        ticker = _clean(record.get("ticker"))
        if not ticker:
            continue
        key = str(ticker).upper()
        row = {
            "symbol": key,
            "name": _clean(record.get("name")),
            "description": _clean(record.get("description")),
            "price": _clean(record.get("close")),
            "currency": _clean(record.get("currency")),
        }
        for metric in wanted:
            field, kind = METRICS[metric]
            row[metric] = {"value": _clean(record.get(field)), "kind": kind}
        # A screener row can come back with a share-class suffix (SET:PTT.R);
        # the plain ticker is the one the board asks for, so prefer it.
        out[key] = row
        base = key.split(".")[0]
        if base not in out:
            out[base] = row
    return out


def main() -> int:
    try:
        import pandas  # noqa: F401  (preload; the scanner imports it lazily)
    except Exception as exc:  # pragma: no cover
        print(json.dumps({"fatal": f"pandas unavailable: {exc}"}), flush=True)
        return 1

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            request = json.loads(line)
        except json.JSONDecodeError:
            continue

        if request.get("cmd") == "quit":
            break
        if request.get("cmd") == "ping":
            print(json.dumps({"id": request.get("id"), "pong": True}), flush=True)
            continue

        symbols = [str(s).upper() for s in (request.get("symbols") or []) if s]
        if not symbols:
            print(json.dumps({"id": request.get("id"), "error": "no symbols"}), flush=True)
            continue

        try:
            data = fetch(symbols, request.get("metrics") or list(METRICS))
            print(json.dumps({"id": request.get("id"), "data": data}), flush=True)
        except Exception as exc:  # keep the process alive on upstream errors
            print(
                json.dumps({"id": request.get("id"), "error": str(exc)}),
                flush=True,
            )

    return 0


if __name__ == "__main__":
    sys.exit(main())