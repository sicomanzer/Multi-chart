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

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/sicomanzer/Multi-chart)

The button opens the Render blueprint for this repository — it builds the
Dockerfile in the root and asks for a `DECK_PASSWORD` before deploying. Read
[Deploying](#deploying) first: this app needs a host that can run Python, not a
static host, and it has no authentication of its own.

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
| `PORT` | `8787` | HTTP port. Setting it also switches the bind address to `0.0.0.0`, which is what a container platform expects |
| `HOST` | `127.0.0.1` | Bind address, if you need to override the above |
| `DATA_DIR` | `./data` | Where `workspaces.json` is written. Point it at a mounted volume to keep boards across deploys |
| `TVMCP_PYTHON` | auto | Python executable used to start the MCP server. Resolved against `PATH`, so `python3`-only Linux images work |
| `DECK_PASSWORD` | *(unset)* | When set, every route needs HTTP Basic auth as `DECK_USER` (default `deck`). Off by default so local use is unchanged |
| `DECK_USER` | `deck` | Username for the above |

---

## Deploying

**It has to run on a host that can hold a Python process, not on static
hosting.** Three things make that non-negotiable:

1. `/vendor/lightweight-charts.js` is served from `node_modules/` by Express
   (`server/index.js`), it is not a file inside `public/`.
2. Every data route is `/api/*` on that same Express server.
3. Quotes and the ratio strip come from Python processes — the MCP server and
   the `fundamentals.py` sidecar — which hold a websocket session open to
   TradingView. Serverless functions are stateless and short-lived; they cannot
   keep that session, so each cold start would reconnect from scratch and the
   quotes would never settle.

Verified against a live Vercel deployment of this repository: `/` and
`/js/main.js` return 200 while `/vendor/lightweight-charts.js` and every
`/api/*` return 404, so the page renders an empty board and the console reports
`Cannot destructure property 'createChart' of 'window.LightweightCharts'`. The
candle source itself cannot be called from a browser either — Yahoo sends no
`Access-Control-Allow-Origin` — so a static-only build would need a proxy for
candles *and* would still have no MCP.

### Render

The repo contains a `render.yaml` blueprint and a deploy button at the top of
this file, so this is the short path:

1. Click the button, or go to Render → **New → Blueprint** → pick
   `sicomanzer/Multi-chart`.
2. Render asks for `DECK_PASSWORD` because the blueprint marks it
   `sync: false`. Set one — see the warning below.
3. Deploy. The first build installs Python 3, `tradingview-mcp-server` and the
   npm dependencies, which takes a few minutes.

### Railway

1. **New Project → Deploy from GitHub repo** → `sicomanzer/Multi-chart`.
2. Railway's default builder is Nixpacks, which does *not* read the Dockerfile.
   Set **Settings → Build → Builder** to `Dockerfile`, or the deploy will fail
   with no `python3` in the image and the board will load candles but never a
   quote.
3. Add the `DECK_PASSWORD` variable.
4. Generate a domain: the app must see `PORT` in the environment, which Railway
   sets automatically, and that is what flips the bind address to `0.0.0.0`.

Fly.io, any VPS, or `docker compose` on your own machine work too — the image
is self-contained:

```bash
docker build -t multi-chart-desk .
docker run -p 8787:8787 -e DECK_PASSWORD=choose-something multi-chart-desk
```

`data/workspaces.json` is deliberately *not* in `.dockerignore`, so a fresh
container opens with the 15-chart SET board rather than an empty grid. Override
it with `-e DATA_DIR=/some/volume/path` once boards need to survive a deploy.

### Before you expose it

**Set `DECK_PASSWORD`.** This app has no authentication of its own: the MCP
console can call any of the 37 upstream tools, and boards can be created,
rewritten and deleted by anyone who loads the page. On a laptop bound to
loopback that is fine, which is why the default is off. On a public URL it is
not, and Basic auth over HTTPS is the minimum — put it behind a real identity
provider if it matters.

### What a free tier changes

- **The filesystem is wiped on every deploy**, so boards go back to whatever is
  committed in `data/workspaces.json`. Attach a disk and set `DATA_DIR` to its
  mount path (Render: paid plans only; Railway and Fly: any volume) to keep them.
- **The service sleeps** after a period without traffic, and the first request
  pays for Node and the MCP starting up again.
- The SSE quote stream reconnects on its own, so a sleeping instance recovers
  without a page reload.

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

Two toolbar buttons work across the whole board, and they do different things:

| Button | Does |
| --- | --- |
| `ƒx All` | **Adds** the indicator to every chart on the board |
| `ƒx Edit All` | **Edits** one existing indicator's settings on every chart at once |

`ƒx Edit All` lists what is actually on the board, with a chart count per
indicator, and opens the normal editor in a board-wide scope: change one value
and every chart carrying that indicator redraws immediately. The dialog says so
in a banner and in the button labels (`Apply on 15 charts`) rather than letting
you believe you changed a single chart. If some charts hold different settings
for that indicator, the banner names how many will be overwritten. Charts
*without* the indicator are left alone — this changes settings, it does not add
studies; that is what `ƒx All` is for.

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
  (read-only), and real user accounts — `DECK_PASSWORD` is a single shared
  Basic-auth password, which is a door, not an identity system. Put a real
  authenticating proxy in front of it before it matters.
- Cosmetic: the Ichimoku cloud uses a single tint rather than up/down colouring,
  and bounded oscillator panes (RSI, Stoch, %R) autoscale with their reference
  lines drawn, because lightweight-charts cannot pin a pane's min/max.