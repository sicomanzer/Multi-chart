"""
What fundamental data does this data source actually give us, and can it be
trusted?

A VI assistant needs owner earnings, growth, payout, balance-sheet strength and
sector. Rather than assume, measure it.

Two failure modes matter and they look different:
  * empty    -> the column name is wrong, or the screener has no such field
  * wrong    -> the column returns something but scaled wrong (we already know
                absolute-currency columns come back off by a constant factor:
                EPS was 33.3x too small on every symbol)

An invalid column name does not raise — it silently poisons the whole query and
returns nothing — so each candidate is probed on its own rather than in one
batch, otherwise a single typo reads as "the source has no fundamentals".

Scale-free columns (ratios, percentages) cannot have the scaling problem, so
they are what a build should rest on.
"""
import sys

from tradingview_screener import Query, Column

SYMBOLS = ["SET:TU", "SET:SCB", "SET:PTT", "SET:KCE", "SET:ADVANC"]

KNOWN_GOOD = "price_earnings_ttm"  # control: proves the query shape works

CANDIDATES = [
    # valuation
    ("price_earnings_forward", "ratio"),
    ("price_book_fq", "ratio"),
    ("price_sales_current", "ratio"),
    ("price_cash_flow_current", "ratio"),
    ("price_free_cash_flow_current", "ratio"),
    ("enterprise_value_ebitda_ttm", "ratio"),
    ("enterprise_value_fq", "money"),
    ("ev_to_sales_fq", "ratio"),
    # quality / returns
    ("return_on_equity_fq", "percent"),
    ("return_on_invested_capital_fq", "percent"),
    ("gross_margin_fq", "percent"),
    ("operating_margin_fq", "percent"),
    ("net_margin_fq", "percent"),
    # growth
    ("earnings_per_share_diluted_yoy_growth_ttm", "percent"),
    ("earnings_growth_ttm", "percent"),
    ("total_revenue_yoy_growth_ttm", "percent"),
    ("revenue_growth_ttm", "percent"),
    # balance sheet / safety
    ("debt_to_equity_fq", "ratio"),
    ("net_debt_to_ebitda_ttm", "ratio"),
    ("total_debt_to_ebitda_ttm", "ratio"),
    ("cash_flow_to_debt_fq", "ratio"),
    ("interest_coverage_fq", "ratio"),
    ("quick_ratio", "ratio"),
    # dividends
    ("dividends_yield_current", "percent"),
    ("dividends_payout_ratio_fq", "percent"),
    # owner earnings / cash (absolute — expect the scaling problem)
    ("free_cash_flow_fq", "money"),
    ("operating_cash_flow_fq", "money"),
    ("cash_flow_fq", "money"),
    ("capital_expenditures_fq", "money"),
    ("total_revenue_fq", "money"),
    ("market_cap_basic", "money"),
    ("shares_outstanding_fq", "money"),
    ("total_equity_fq", "money"),
    # classification / risk
    ("sector", "text"),
    ("industry", "text"),
    ("beta_1_year", "ratio"),
    ("Volatility.D", "percent"),
    ("Perf.Y", "percent"),
]


def fetch(column):
    """Return {symbol: value} for one column, or None if the column is invalid.

    The scanner adds its own `ticker` column, so that — not `symbol` — is what
    identifies a row here; asking for it again would duplicate the column.
    """
    try:
        _, frame = (Query().set_tickers(*SYMBOLS)
                    .select(Column(KNOWN_GOOD), Column(column))
                    .limit(len(SYMBOLS))
                    .get_scanner_data())
    except Exception:                                   # noqa: BLE001
        return None
    if frame is None or len(frame) == 0:
        return None
    rows = frame.to_dict("records")
    if not any(r.get(KNOWN_GOOD) is not None for r in rows):
        return None                                    # the control failed: bad column
    return {str(r["ticker"]).upper(): r.get(column)
            for r in rows if str(r.get("ticker", "")).upper() in SYMBOLS}


def main():
    control = fetch(KNOWN_GOOD)
    if not control:
        print("control query failed — the ticker/select shape is wrong", file=sys.stderr)
        return 1
    print(f"control {KNOWN_GOOD}: {len(control)} symbols\n")

    good, partial, money, bad = [], [], [], []
    print(f"{'column':<44} {'kind':<8} {'filled':<9} sample")
    print("-" * 108)
    for name, kind in CANDIDATES:
        values = fetch(name)
        if values is None:
            bad.append(name)
            continue
        usable = {s: v for s, v in values.items()
                  if (isinstance(v, (int, float)) and not isinstance(v, bool) and v == v)
                  or (isinstance(v, str) and v.strip())}
        if not usable:
            bad.append(name)
            continue
        sample = next(iter(usable.values()))
        if isinstance(sample, float):
            sample = f"{sample:,.4g}"
        row = (name, kind, len(usable), len(control))
        print(f"{name:<44} {kind:<8} {len(usable)}/{len(control):<5} {str(sample)[:40]}")
        if len(usable) < len(control):
            partial.append(row)
        elif kind == "money":
            money.append(row)
        else:
            good.append(row)

    print("\n=== scale-free, filled on every symbol: safe to build on ===")
    for name, *_ in good:
        print(f"  {name}")
    print("\n=== scale-free but only some symbols: usable, shows blanks ===")
    for name, _kind, filled, total in partial:
        print(f"  {name}  ({filled}/{total})")
    print("\n=== absolute currency: NEEDS a cross-check before it can be shown ===")
    for name, _kind, filled, total in money:
        print(f"  {name}  ({filled}/{total})")
    print(f"\n=== no such column / rejected by the scanner ({len(bad)}) ===")
    print("  " + ", ".join(bad))
    return 0


if __name__ == "__main__":
    sys.exit(main())
