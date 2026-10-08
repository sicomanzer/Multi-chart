"""
Are the absolute-currency columns trustworthy, or only the ratios?

Earlier measurement: `earnings_per_share_diluted_ttm` came back exactly 33.3x too
small on all 15 SET names, and market cap was off too. Ratios and percentages are
scale-free so they cannot be affected — but if the money columns are consistent
with each other *through* those ratios, they are usable, and if they are not, the
ratio is constant and recoverable.

Each identity below is an accounting tautology, so it must hold to within a few
percent if the numbers come from one set of filings:

    equity x P/B      = market cap
    revenue x P/S     = market cap
    FCF    x P/FCF    = market cap
    EV     x EV/EBITDA = EBITDA

A ratio near 1.00 means the money columns are internally consistent. A ratio that
is the *same wrong number* on every symbol means a unit mismatch we can correct
or route around. A ratio that varies per symbol means the columns come from
different as-of dates and should not be mixed.
"""
import statistics
import sys

from tradingview_screener import Query, Column

SYMBOLS = ["SET:TU", "SET:TISCO", "SET:SCB", "SET:MC", "SET:PTT", "SET:KCE",
           "SET:ADVANC", "SET:CPF", "SET:KBANK", "SET:AOT"]

FIELDS = ["market_cap_basic", "total_equity_fq", "total_revenue_fq",
          "free_cash_flow_fq", "price_book_fq", "price_sales_current",
          "price_free_cash_flow_current"]


def rows():
    _, frame = (Query().set_tickers(*SYMBOLS)
                .select(*(Column(f) for f in FIELDS))
                .limit(len(SYMBOLS))
                .get_scanner_data())
    return {str(r["ticker"]).upper(): r for r in frame.to_dict("records")
            if str(r.get("ticker", "")).upper() in SYMBOLS}


def num(v):
    if isinstance(v, bool) or not isinstance(v, (int, float)) or v != v:
        return None
    return v


data = rows()
if not data:
    print("no rows", file=sys.stderr)
    sys.exit(1)

print(f"{'symbol':<12} {'mcap':>12} {'equity':>12} {'equity*P/B':>13} {'ratio':>7}"
      f" {'rev*P/S':>13} {'ratio':>7} {'fcf*P/fcf':>12} {'ratio':>7}")
print("-" * 108)

ratios_pb, ratios_ps, ratios_pfcf = [], [], []
for ticker, r in sorted(data.items()):
    mcap = num(r.get("market_cap_basic"))
    eq = num(r.get("total_equity_fq"))
    rev = num(r.get("total_revenue_fq"))
    fcf = num(r.get("free_cash_flow_fq"))
    pb = num(r.get("price_book_fq"))
    ps = num(r.get("price_sales_current"))
    pfcf = num(r.get("price_free_cash_flow_current"))

    def fmt(v, f="{:.4g}"):
        return f.format(v) if v is not None else "—"

    eq_pb = eq * pb if (eq and pb) else None
    rev_ps = rev * ps if (rev and ps) else None
    fcf_pfcf = fcf * pfcf if (fcf and pfcf) else None

    r1 = eq_pb / mcap if (eq_pb and mcap) else None
    r2 = rev_ps / mcap if (rev_ps and mcap) else None
    r3 = fcf_pfcf / mcap if (fcf_pfcf and mcap) else None
    for bucket, value in ((ratios_pb, r1), (ratios_ps, r2), (ratios_pfcf, r3)):
        if value is not None:
            bucket.append(value)

    print(f"{ticker.replace('SET:', ''):<12} {fmt(mcap, '{:>12,.0f}')} {fmt(eq, '{:>12,.0f}')}"
          f" {fmt(eq_pb, '{:>13,.0f}')} {fmt(r1, '{:>7.4f}')}"
          f" {fmt(rev_ps, '{:>13,.0f}')} {fmt(r2, '{:>7.4f}')}"
          f" {fmt(fcf_pfcf, '{:>12,.0f}')} {fmt(r3, '{:>7.4f}')}")


def verdict(name, ratios):
    if not ratios:
        print(f"\n{name}: no data")
        return
    lo, hi = min(ratios), max(ratios)
    med = statistics.median(ratios)
    print(f"\n{name}  n={len(ratios)}  median={med:.4f}  min={lo:.4f}  max={hi:.4f}")
    if 0.9 <= med <= 1.1 and lo > 0.8 and hi < 1.25:
        print("  -> internally consistent: the money columns can be shown")
    elif lo > 0.5 * hi and hi < 2 * lo:
        print(f"  -> consistent but off by a constant x{med:.4g}: correctable or avoidable")
    else:
        print("  -> varies per symbol: columns come from different as-of dates, do not mix")


verdict("equity x P/B vs market cap", ratios_pb)
verdict("revenue x P/S vs market cap", ratios_ps)
verdict("FCF x P/FCF vs market cap", ratios_pfcf)

print("\n=== what a value investor can compute WITHOUT the money columns ===")
print("  FCF yield   = 1 / price_free_cash_flow_current")
print("  Sales yield = 1 / price_sales_current")
print("  Earnings yield = 1 / price_earnings_ttm")
print("  These are scale-free, so they survive whatever the money columns are doing.")
print("\n=== working set: scale-free fields a VI screen can rank on ===")
print("  price_earnings_ttm, price_book_fq, price_free_cash_flow_current,")
print("  price_sales_current, return_on_equity_fq, return_on_invested_capital_fq,")
print("  earnings_per_share_diluted_yoy_growth_ttm, total_revenue_yoy_growth_ttm,")
print("  debt_to_equity_fq, dividends_yield_current, sector, industry, beta_1_year")
