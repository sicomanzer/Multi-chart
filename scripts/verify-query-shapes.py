"""
The direct-ticker query returns money columns ~33x too small. Is that a property
of the *columns*, or of that query shape?

The screener can be asked the same question two ways:
  * by ticker   — set_tickers(...) + select(...)   -> what the app uses today
  * by market   — where(exchange == SET) + select(...) -> a screen over the
    whole market, paged

If the two shapes disagree by a constant factor, the data is recoverable: keep
using the fast per-ticker path for ratios and prices, and use a market scan for
the handful of rows that need real money figures.

Ground truth for the check: PTT's market cap is about 1.18 trillion baht
(~28.5bn shares at ~41.5). A value in that neighbourhood proves the market-scan
path is the correct one; 3.5e10 proves the ticker path is not.
"""
import sys

from tradingview_screener import Query, Column

SYMBOLS = ["SET:TU", "SET:TISCO", "SET:SCB", "SET:PTT", "SET:KCE", "SET:ADVANC"]

FIELDS = ["market_cap_basic", "total_equity_fq", "total_revenue_fq",
          "free_cash_flow_fq", "price_book_fq", "price_earnings_ttm",
          "price_free_cash_flow_current", "return_on_equity_fq"]


def num(v):
    if isinstance(v, bool) or not isinstance(v, (int, float)) or v != v:
        return None
    return v


def by_ticker():
    _, frame = (Query().set_tickers(*SYMBOLS)
                .select(*(Column(f) for f in FIELDS))
                .limit(len(SYMBOLS))
                .get_scanner_data())
    return {str(r["ticker"]).upper(): r for r in frame.to_dict("records")}


def by_market():
    """Screen the whole SET market once and keep the rows we care about."""
    q = Query()
    for f in FIELDS:
        q = q.select(Column(f))
    q = q.where(Column("exchange") == "SET")
    # The scanner pages at 50; ask for enough to plausibly contain blue chips.
    try:
        total, frame = q.limit(3000).get_scanner_data()
    except Exception as e:                              # noqa: BLE001
        print(f"market scan failed: {e}", file=sys.stderr)
        return {}, total if "total" in dir() else None
    return {str(r["ticker"]).upper(): r for r in frame.to_dict("records")}, total


ticker_rows = by_ticker()
market_rows, total = by_market()
print(f"ticker path: {len(ticker_rows)} rows")
print(f"market path: {len(market_rows)} rows (screener reported {total} SET instruments)\n")

if not market_rows:
    print("market scan returned nothing; cannot cross-check", file=sys.stderr)
    sys.exit(1)

print(f"{'symbol':<10} {'mcap byTicker':>16} {'mcap byMarket':>16} {'factor':>8}"
      f" {'P/B t':>7} {'P/B m':>7} {'P/FCF t':>8} {'P/FCF m':>8}")
print("-" * 96)

factors, found = [], 0
for ticker in sorted(SYMBOLS):
    t = ticker_rows.get(ticker)
    m = market_rows.get(ticker)
    if not t or not m:
        print(f"{ticker.replace('SET:', ''):<10}  (missing: ticker={bool(t)} market={bool(m)})")
        continue
    found += 1
    mt, mm = num(t.get("market_cap_basic")), num(m.get("market_cap_basic"))
    f = (mm / mt) if (mt and mm) else None
    if f:
        factors.append(f)

    def n(v, fmt="{:,.3f}"):
        return fmt.format(v) if v is not None else "—"

    print(f"{ticker.replace('SET:', ''):<10} {n(mt, '{:>16,.0f}')} {n(mm, '{:>16,.0f}')}"
          f" {n(f, '{:>8.2f}')}"
          f" {n(num(t.get('price_book_fq')), '{:>7.3f}')} {n(num(m.get('price_book_fq')), '{:>7.3f}')}"
          f" {n(num(t.get('price_free_cash_flow_current')), '{:>8.3f}')}"
          f" {n(num(m.get('price_free_cash_flow_current')), '{:>8.3f}')}")

if factors:
    lo, hi = min(factors), max(factors)
    print(f"\nmarket-cap factor: n={len(factors)} min={lo:.2f} max={hi:.2f}")
    if lo > 25 and hi < 40:
        print("  -> a constant x~33: the ticker path mis-scales money columns, the market path does not")
    elif hi / lo < 1.5:
        print("  -> constant but not ~33; needs a closer look")
    else:
        print("  -> varies per symbol; the two shapes are not interchangeable")
else:
    print("\nno overlapping symbols, nothing to compare")
