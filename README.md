# Multi-chart trading desk

A browser dashboard for watching many instruments at once — the Pi-Securities
style grid of small candlestick charts, each with its own indicator panes,
editable indicator settings, and live prices.

Market data comes from the **[tradingview-mcp](https://github.com/atilaahmettaner/tradingview-mcp)**
server, which the Node backend drives over stdio JSON-RPC, exactly like an AI
client would. The same MCP is reachable from the UI (`MCP` button) for screeners,
technical analysis, backtests, sentiment and news.

```
browser ──HTTP/SSE──▶ Node/Express ──stdio JSON-RPC──▶ python -m tradingview_mcp.server
                          │
                          └──OHLCV history──▶ Yahoo Finance chart API (same endpoint the MCP uses)
```

---

## Quick start

```bash
# 1. the MCP server (Python 3.10 – 3.13)
pip install tradingview-mcp-server

# 2. this app (Node 20+)
npm install
npm start
```

Open <http://127.0.0.1:8787>.

On Windows, `npm.ps1` is often blocked by the execution policy; use `npm.cmd`:

```powershell
npm.cmd install
npm.cmd start
```

### Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `8787` | HTTP port |
| `HOST` | `127.0.0.1` | Bind address |
| `TVMCP_PYTHON` | auto | Python executable used to start the MCP server |

---

## What the board does

**Multi-chart.** 1–6 columns, up to 60 charts. Every tile has its own symbol,
timeframe, chart style, log scale, price levels and indicator set. Click a
tile's `⛶` (or `Esc`) to maximise it.

**Layout fits the screen.** In *auto fit* mode (the default) the board measures
the viewport and picks the column count whose tiles land closest to a readable
aspect ratio, then sets an exact row height so the last row is never clipped —
15 charts on a laptop become 5 × 3 with no scrolling. Re-computed on every
window resize. When a chart count cannot be shown legibly at the current
viewport (below ~240 × 150 px per tile) it falls back to fixed columns and
scrolls, and says so in the status bar. The `Fit` button forces a recompute;
*Settings → Board sizing* switches between `Auto fit to screen` and
`Fixed columns`. Tile headers adapt to their width via container queries —
the company name drops first, then the timeframe badge, then the percentage —
so the close/maximise controls are never clipped.

**Indicators — add, edit, configure.** `ƒx` on a tile opens the picker;
`ƒx All` in the toolbar adds one to every chart at once. Clicking a legend
entry (or the tile's `⚙`) opens the editor, which is generated from a server
side catalog, so every parameter is a real control with its own range, default
and colour swatch:

| Group | Indicators |
| --- | --- |
| Moving average | SMA, EMA, WMA, VWMA, HMA |
| Volatility | Bollinger Bands, Keltner Channels, Donchian Channels, ATR |
| Trend | MACD, SuperTrend, Parabolic SAR, ADX/DMI, Ichimoku Cloud |
| Momentum | RSI, Stochastic, Stochastic RSI, CCI, ROC, MFI, Williams %R |
| Volume | Volume, OBV |

Per indicator you control the parameters, the colours and line width, whether
it renders as an **overlay on the price chart** or in **its own pane** below it,
and the pane height. Enable/disable and delete from the same dialog.

**Live quotes.** The server polls the MCP `stock_prices` screener once per
interval for the union of symbols on screen (one upstream request carries up to
2000 tickers, so a 24-chart board costs the same as a 3-chart one) and pushes
results to each browser over SSE. The interval is per client and configurable
(5 s … 2 min); a hidden tab backs off automatically. The last price updates the
forming candle in place, so intraday boards move without a refetch.

**Zoom the whole board at once.** The `−` `+` `⤢` cluster in the toolbar, or the
`+` / `-` / `0` keys, zooms every chart simultaneously. Each click multiplies
every chart's candle width by 1.25, so "in" means fewer, wider bars — the same
feel as TradingView's wheel, applied to the board. Three details worth knowing:

- **It is proportional, not absolute.** A chart already showing 40 bars and one
  showing 400 both step by 25%, so a board of mixed histories stays readable
  instead of flattening the detail views. Verified: all 15 tiles move by exactly
  the same factor (1.25ⁿ).
- **A manual zoom survives the data refresh.** Otherwise the next candle tick
  would auto-fit and throw the view away. It is released by `⤢` / `0`, or by
  changing that chart's symbol or timeframe (only that tile — the rest of the
  board keeps its own zoom).
- **Scrolling over one chart still zooms only that chart**, and is now
  remembered the same way. Panning or scrolling over the price axis changes
  nothing, so those do not pin the view.

`⤢` resets to the full loaded range and puts every chart back into auto-fit
mode. Zoom is not saved with the board — a reload always starts fitted.

**Everything else.** Global timeframe switch, crosshair mirroring across
charts, optional linked zoom, light/dark theme, price levels (alert/target
lines), symbol search backed by the screener, saved boards (rename/duplicate/
delete) stored in `data/workspaces.json`, and an MCP console that can call any
of the 37 tools.

### Adding charts from the command line

```bash
node scripts/add-charts.mjs TU TISCO PTTEP          # add to the newest board
node scripts/add-charts.mjs --board "My board" --tf 1d --rsi AAPL MSFT
node scripts/add-charts.mjs --dry TU                 # check first, save nothing
```

Each symbol is resolved through the same normaliser the UI uses (`CPF`,
`SET:CPF` and `CPF.BK` are equivalent) and verified to have candles before it
is added, so a typo is reported instead of producing an empty tile. `--tf`
defaults to the board's own timeframe and `--rsi`/`--no-rsi` controls whether
the new charts start with an RSI pane.

Boards use optimistic concurrency: every board carries a `revision`, and a save
that quotes a stale revision is rejected with **409**. A browser tab that was
left open therefore cannot overwrite a change made from the CLI or another
machine — it shows a notice and reloads the newer copy instead. A tab with
pending edits sends them on `beforeunload` (with `keepalive`), so unsaved work
still survives a refresh.

---

## Where the numbers come from

| Data | Source | Why |
| --- | --- | --- |
| Quotes, % change, currency, company name | MCP `stock_prices` | TradingView screener; one request for the whole board |
| OHLCV history | Yahoo Finance chart API | The MCP ships **no historical OHLC tool**; this is the same endpoint its own `yahoo_finance_service` calls for quotes, so the candles and the quote line agree |
| Screeners, TA, backtests, news, sentiment | MCP tools | Exposed verbatim through `POST /api/mcp/tools/:name` |
| Fundamentals (P/E, P/BV, D/E, yield, ROE, …) | `server/fundamentals.py` | Also not an MCP tool — a small sidecar driving the same `tradingview-screener` package the MCP depends on, because that package returns these columns only when you name them explicitly |

### Fundamentals strip

Each chart carries a strip under it with valuation ratios. What it shows — and
whether the indicator readout sits below it — is set in *Settings → Chart
footer*:

| Mode | Shows |
| --- | --- |
| Fundamentals only | P/E · P/BV · D/E · Y% |
| Indicator values only | the live indicator readings, click to edit |
| Both | ratios on top, indicators below |

Pick any subset of nine metrics (P/E, P/BV, D/E, Y%, ROE, ROA, P/S, EV/EBITDA,
current ratio). A narrow chart shows as many as fit and names the rest in the
tooltip rather than clipping them silently.

**What is verified and what is not.** Ratios and percentages are exposed;
absolute-currency columns are not. On this endpoint `earnings_per_share_diluted_ttm`
comes back exactly **33.3× too small** (checked against P/E for all 15 SET names,
identical factor every time), and `dividends_per_share_fq` / `market_cap_basic`
are off by a similar order — so they are deliberately omitted rather than shown
wrong. The four metrics the strip defaults to were checked two ways:

- the price inside every screener row matches the live MCP quote to 0.000%
- the accounting identity `P/BV = price / (price ÷ P/E ÷ ROE)` reproduces the
  reported P/BV to within ~1% for most names (worst case ~11% on BKIH) —
  numbers that were invented or mis-scaled could not satisfy that

Cross-checking against a *second* provider was not possible from here: the SET
website's JSON API answers `403` to non-browser clients and Yahoo's
`quoteSummary` endpoint refused the connection. The figures come from
TradingView's screener (which aggregates company filings), not from the exchange
directly, and are TTM/last-reported rather than audited. Treat them as
decision support, not as the audited figure on a company's own IR page.

Field names are TradingView's and several are counter-intuitive —
`debt_to_equity_fq`, not `debt_equity_fq`; `dividends_yield_current`, plural
"dividends". A wrong name returns all-null instead of failing, which is why the
mapping lives in one table (`METRICS` in `fundamentals.py`).

The sidecar is a long-lived process speaking newline-delimited JSON, because
importing pandas costs a couple of seconds and a board refreshes often.
Results are cached per symbol for 30 minutes, and an entry is only reused when
it already contains every metric the caller asked for.

Indicators are computed **client-side** from the candle series. That is what
makes parameters instantly editable: changing an RSI length re-renders the
pane without a round trip. Use the MCP console when you want the server's own
opinion (e.g. `combined_analysis`) rather than your own settings.

---

## HTTP API

| Route | Purpose |
| --- | --- |
| `GET /api/meta` | timeframes, exchanges, default settings |
| `GET /api/health` | uptime, MCP status, live round-trip ping |
| `GET /api/indicators` | indicator catalog (drives every editor form) |
| `GET /api/symbols?q=&country=` | screener-backed symbol search |
| `GET /api/symbol/resolve?symbol=` | normalise `CPF` / `SET:CPF` / `CPF.BK` |
| `GET /api/candles?symbol=&timeframe=` | OHLCV history |
| `POST /api/candles` | `{ symbols: [], timeframe }` → batch |
| `GET /api/quotes?symbols=` | MCP quotes |
| `GET /api/fundamentals?symbols=&metrics=&refresh=1` | valuation ratios (P/E, P/BV, D/E, yield, …) |
| `GET /api/fundamentals/metrics` | metric labels/hints and sidecar status |
| `GET /api/stream?symbols=&intervalMs=` | SSE quote stream |
| `GET/POST/PATCH/DELETE /api/workspaces` | saved boards |
| `GET /api/mcp/tools` · `POST /api/mcp/tools/:name` | MCP passthrough |

---

## Layout

```
server/
  index.js              HTTP + SSE surface, static hosting
  mcp-client.js         stdio JSON-RPC client: handshake, queue, timeouts, restart
  market.js             candles (Yahoo) + quotes (MCP), TTL caches, single-flight
  symbols.js            TradingView <-> Yahoo symbol mapping
  indicator-catalog.js  indicator metadata + parameter validation
  realtime.js           per-client subscription hub and poll loop
  workspace-store.js    board persistence (atomic, debounced)
  fundamentals.py       long-lived sidecar: TradingView screener ratios
  fundamentals.js       sidecar client: queue, timeouts, per-symbol cache
public/
  index.html
  css/app.css
  js/ta.js              indicator maths
  js/chart-tile.js      one chart: panes, series, price lines, theming
  js/board.js           board model, data loading, syncing, persistence
  js/stream.js          SSE client
  js/main.js            bootstrap and toolbar
  js/dialogs/           indicator, chart, board and MCP dialogs
scripts/
  verify-indicators.mjs numeric check of all 23 indicators (npm run verify)
data/workspaces.json    saved boards (created on first run)
```

## Verifying the indicator maths

```bash
npm start        # terminal 1
npm run verify   # terminal 2
```

`npm run verify` runs the browser maths module against live candles and checks
every indicator against a second implementation written independently in
`scripts/verify-indicators.mjs`, plus structural invariants: series are finite
and time-ordered, oscillator ranges (Stoch/MFI/%R/ADX inside their bounds),
band ordering (upper ≥ basis ≥ lower), `MACD histogram = MACD − signal`,
`OBV = signed cumulative volume`, SuperTrend and PSAR against reference
recursions *including that they actually flip state*, warm-up lengths, and
degenerate inputs (flat series → RSI 100 / ATR 0). It exits non-zero on any
mismatch. Override the sample with `SYMBOL=NASDAQ:AAPL TIMEFRAME=1h npm run verify`.

## Notes and limits

- The MCP throttles some tools and can rate-limit under bursts; calls are
  serialised through one queue, and the board retries nothing silently — errors
  surface in the tile or in the MCP console.
- Prices are as-reported by the upstream providers and may be delayed. Nothing
  here is investment advice.
- If the MCP cannot start, candles still load; the status pill shows
  `mcp offline` and quotes fall back to the Yahoo chart metadata.
- **Not implemented, on purpose or by limitation:** tick-level streaming (quotes
  arrive by polling, not a websocket feed), alert/notification firing (price
  levels are drawn, they do not notify), custom formula indicators (the 23 in the
  catalog are the supported set), broker connectivity and order placement
  (read-only), and any authentication — the server binds to `127.0.0.1`, so put
  it behind a reverse proxy with auth before exposing it to a network.
- Cosmetic: the Ichimoku cloud uses a single tint rather than up/down colouring,
  and bounded oscillator panes (RSI, Stoch, %R) autoscale with their reference
  lines drawn, because lightweight-charts cannot pin a pane's min/max.