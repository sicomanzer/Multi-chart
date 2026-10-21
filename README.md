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

The interface speaks **English and Thai**. The button in the top bar switches
between them; the choice is remembered in `localStorage`. See
[Two languages](#two-languages).

A **value screener** sits behind the `Screener` button: seventeen fundamental
rules, a two-stage dividend discount model with live sliders, and the stock's
own P/E and P/BV bands. See [The value screener](#the-value-screener).

What has been built, what is still open and what comes next is written up in
**[PROGRESS.md](PROGRESS.md)** — the handover note, in Thai.

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

**Fundamentals history — the trend series.** The screener only ever reports the
*current* value of each ratio, but a value-investing view needs the line, not the
point: is ROE holding up, is this P/E cheap against its own five years, did the
reason I bought still hold. So every board load writes today's ratios to
`data/fundamentals-history.jsonl` — one JSON line per symbol per day, appended
and never rewritten, fifteen ratios plus the price.

It starts the day this ships and **cannot be back-filled**; the first weeks are
one row per symbol, and any trend read off that would be noise. Settings shows
what exists so far and has a button to record today by hand (useful the day a
company reports). Missing a day is normal — nothing schedules itself in here,
the file grows when you look at a board.

```bash
# the recorded series, as JSON
curl 'http://127.0.0.1:8787/api/fundamentals/history?symbol=SET:TU&metrics=pe,roe'
curl 'http://127.0.0.1:8787/api/fundamentals/history/summary'
```

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

Pick any subset of fifteen metrics (P/E, P/BV, P/FCF, P/S, P/CF, EV/EBITDA, D/E,
Quick, current ratio, Y%, ROE, ROIC, ROA, EPS growth, revenue growth). A narrow
chart shows as many as fit and names the rest in the tooltip rather than clipping
them silently.

**What is verified and what is not.** Ratios and percentages are exposed;
absolute-currency columns are not. On this endpoint `earnings_per_share_diluted_ttm`
comes back exactly **33.3× too small** (checked against P/E for all 15 SET names,
identical factor every time), and `dividends_per_share_fq` / `market_cap_basic`
are off by a similar order — so they are deliberately omitted rather than shown
wrong. `scripts/probe-fundamental-fields.py` probes 37 candidate columns one at a
time against real SET tickers and reports which exist, which are only partly
populated, and which are currency amounts; 15 names (margins, payout ratio,
interest coverage, net debt/EBITDA, operating cash flow, forward P/E, share
count) are rejected by the screener outright.

Because the endpoint will not hand over a trustworthy absolute amount, **there
is no DCF, no owner-earnings number and no price target** — a valuation figure
built on it would be wrong in a way that looks authoritative. `P/FCF` is the
workaround: it is a ratio, so its reciprocal is a free-cash-flow *yield* with no
currency amount involved at all. A DCF you enter yourself is the other honest
option.

The four metrics the strip defaults to were checked two ways:

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

## The value screener

A second data layer, used only by the screener. It answers a different question
from the fundamentals strip: not "what is this company's P/E today" but "has it
earned more than 15% on equity every year for four years, and is the dividend
safe".

Where the numbers come from matters here, so the shortcuts are listed rather
than hidden:

| Need | Source | Spans |
| --- | --- | --- |
| Annual statements (net income, equity, debt, EBIT, cash flow, EPS, shares) | Yahoo `ws/fundamentals-timeseries` | 4–5 fiscal years |
| Trailing EPS, latest-quarter equity and share count | the same endpoint (`trailing*`, `quarterly*`) | latest quarter |
| Per-share figures in the trading currency | Yahoo `v7/finance/quote` (crumb) | now |
| Dividend ex-dates and amounts | Yahoo `chart?events=div` | 10–15 years |
| Long annual history for the annual charts (net profit, revenue, EPS, margin, D/E) | Finnomena public market-info API | 10 fiscal years |
| Daily closes | Yahoo `chart` | 15 years |
| Current price | the last close in that chart | now |

**Statements are in the reporting currency; prices are not.** BANPU files in US
dollars and trades in baht, so a baht price over a dollar EPS is not a P/E — it
is a P/E divided by the exchange rate, and the same error runs through P/BV, the
yield and the dividend model. The quote endpoint publishes trailing EPS and book
value already converted, so those are what the current multiples use; the
statement history is converted with the ratio between the two EPS figures, and
only when Yahoo also labels the reporting currency as foreign. A ratio far from
one is a suspicion, not a fact: a stale trailing point produces the same shape,
and converting on that alone would have tripled GULF's revenue.

**Four years, not ten.** Yahoo serves four annual periods per symbol to a free
client, consistently across SET names. That covers the framework's "3–5
consecutive years" rules, and it is why the P/E and P/BV bands say `4y` rather
than implying a decade. The band is rebuilt from the statements rather than
taken from a provider: for each trading day the multiple is `close / EPS` using
the fiscal year *published as of that date* — applying the latest EPS across the
whole window would fold hindsight into the bands and make every stock look
expensive in the past.

**Ten years, and what it is for.** The annual charts in the deep dive — net
profit, revenue, EPS, net margin and D/E — reach back ten fiscal years, because
the screen's own statements stop at four. That history comes from Finnomena's
public market-info API, which republishes the same listed-company data with a
longer tail. It draws the charts *and* judges three of the rules — the growth
ones — because four fiscal years can say whether a business is good but not
whether it is growing: two good years can follow two bad ones, and the average
hides the turn. The valuation still runs on Yahoo's four years and the price
target is untouched by the second source. When the history is missing — an
unlisted ticker, a gap in the file — the charts fall back to the four years and
the growth rules are left unmeasured rather than failed.

**The history is tracked in the repository.** Finnomena's host sits behind a bot
filter that a container's address does not always pass, so the same ten years
are also kept in `data/annual-history.json` and read from disk — the deploy
boots from it the way it boots from the boards and watchlists, and the live
call then only covers the symbols the file does not have. Annual figures change
once a year, so the file stays true for a long time; rebuild it with
`node scripts/refresh-annual-history.mjs`, which writes every symbol the app
knows about (the index, the boards and the lists). `/api/health` reports the
file and the live channel separately under `annualHistory`.

**One bar per fiscal year.** The five statement charts — net profit, revenue,
EPS, net margin and leverage — draw the year's own figure, because the shape
is what a reader scans first and a pile of four quarters in every bar hides it.
The payment chart keeps its quarters, because there the quarters are cash and
cash adds up. The leverage chart counts all liabilities over equity, which is a
wider measure than the interest-bearing D/E the score and the statements table
use — the label says so, rather than the two numbers quietly disagreeing.

**Published, not merely ended.** Yahoo dates a statement by the period it
covers, so FY2024 is stamped `2024-12-31` — a day on which nobody had seen it.
Each year therefore carries a `knownFrom` date of the fiscal year end plus ninety
days, the filing deadline Thai issuers must meet, and the band refuses to use a
year before that date. The median issuer files sooner, but a shorter lag is
clairvoyant for the ones that use the full three months — the exact bias the lag
exists to remove.

**The right-hand edge is today's multiple, not last year's.** The history has to
be annual because that is the only series that exists for every year, but the
current point uses trailing twelve-month EPS and the latest quarter's book value
per share — the same denominators a quote screen uses. A P/E built from the last
fiscal year is stale by up to twelve months, and for a company that has swung to
a loss it is not stale but wrong: BANPU, JAS and EA were all showing a low
multiple from a profitable year that had already ended. When trailing earnings
are negative there is no multiple, so the row shows `—` instead of a flattering
number.

**Multiples above 100× (50× for P/BV) are left out of the statistics.** A
company that earned 0.05 baht a share is not "trading at 300 times earnings" in
any useful sense — the denominator is noise around zero, and one such year drags
the mean far enough that every other year looks cheap. BANPU's band read a mean
of 175× and a −2σ level below zero before this rule; the dialog reports how many
days were excluded rather than dropping them silently.

**The dividend that gets discounted is not always the dividend just paid.** Two
independent estimates exist and both fail, in opposite directions:

- the ex-date record picks up one-off specials — ADVANC's 2026 payment was
  27.41 on top of the usual 8.69, so trailing cash shows a 10.9% yield that
  will not repeat (the price did really gap 404 → 380 on the ex-date)
- the cash-flow statement counts dividends paid to minorities (CPF reads 2.83
  per share against a real 0.66) and can lag a final that is paid after the year
  end (STECON's FY2025 line is 0.004 against 0.55 actually paid)

The basis is the **dividend of the last completed fiscal year**, which is what
`set.or.th` publishes as dividend yield: one fiscal year's interim plus its
final, over today's price. The window is the twelve months centred on the year
end (a December year end pays its final in March–May), and a year is only used
once its final should have been paid — six months after the year end.

A plain trailing-twelve-month sum is a different number, and the gap is not
small: it mixes the *next* year's interim with the current year's final, so
ICHI read 1.00 (0.55 final + 0.45 interim) where the exchange publishes 1.10
(0.55 + 0.55), and every company that moves its interim date drifts by half a
year's growth. The trailing figure is still shown in the detail view as "cash
received, 12m" — it is what a holder was actually paid — but it is not what the
yield, the payout ratio or the valuation use.

The fiscal-year figure is overridden only when it spikes against *both* the
statement and the same window a year earlier; then the smaller figure is used
and the row marks it with `*`. That is what keeps ADVANC's 27.41 special out of
the perpetuity (the exchange reports 10.33% for it; this screen reports the
recurring 3.80%). The same rule follows a genuine step-up: SCGP's dividend rose
from 0.55 to 0.75 without looking like a one-off.

**Payout pairs that dividend with trailing earnings.** The fiscal-year
denominator looked tidy and was wrong twice over: `dividendsPaid` carries the
minority owners' share (PTT read 93% of profit, against roughly two thirds of
trailing earnings actually paid out) and a dividend declared in March is paid
out of the previous year's profit, so numerator and denominator described
different years. The check is the fiscal-year dividend over trailing twelve
months of EPS. The per-year DPS column shows what the exchange actually credited
in that calendar year, falling back to the cash-flow statement only when there is
no ex-date record — the statement is the one that can be wrong in either
direction (PTT 2.94 against 2.20 received, BANPU 0.02 against 0.55).

**Universes.** Two written lists ship with the app — SET100, and a wider set of
large caps that is not an index — plus whatever the user has saved as a board or
a watchlist. SET100 is refreshed from the exchange rather than left to drift:
`set.or.th` serves the member table from `/api/set/index/set100/composition`,
which only answers once the cookies from the page itself are attached, so the
server fetches the page, then the JSON, at most twice a day and in the
background. When that fails the written list stays in use — the index rebalances
twice a year, so a stale copy is a much smaller problem than a screen that will
not start.

**Re-priced while open.** An open screen re-runs itself every minute and stamps
the summary with the time it did, so a table left on a second monitor is not an
hour old. The run reuses the cached statements and only re-fetches quotes, which
is why a warm pass over the SET100 takes about a tenth of a second; the checkbox
next to the button turns the refresh off, and a failed refresh leaves the last
good table in place instead of replacing it with an error.

**Valuation.** Two-stage DDM with `g1 = g2 = 5.00%` and `r = 9%` by default, so
the table, the presets and the calculator all quote the same intrinsic value
before anyone moves a slider. The flat 5% is the assumption a reader can defend
without knowing the company; deriving `g1` from four years of EPS made the
number depend on an estimate that was itself the weakest input. The sliders can
still move either rate independently, and the model refuses to answer when `r`
is at or below `g2` rather than returning infinity.

**Scoring.** Seventeen rules in five groups — quality (40 points), growth (20),
solvency (20), cash conversion (20), shareholder returns (20), 120 in all — so a
high yield on a business that fails the first three can never carry a name into
the results. A rule that cannot be judged is neutral, not a failure: no dividend
means no dividend rules, which should not read as a red flag. The row carries a
`coverage` figure so a score built on half the framework is recognisable as
thin.

**One company in full.** The top bar carries a second door into the same
dialog: *Analyse a stock*. It opens a filter box in front of the screen, so a
ticker or a company name leads to exactly the page a row of the table opens —
the same scorecard, the same dividend model, the same bands and the same
charts. The filter covers the screened universe, the boards and the watchlists,
and asks the exchange for anything else, so a name outside the index is one
keystroke away. A market selector widens the search to nineteen exchanges —
Thailand, the US, Hong Kong, Japan, the UK, Germany, China and the rest — and
the statements come from the same place whatever the exchange, so a foreign
company is analysed on the same framework. What a foreign name does not have is
a peer group: the comparison covers the names that were screened, and the
ten-year history behind the growth rules is Thai, so those rules fall back to
the four years the statements carry.

**Growth, from the ten-year history.** Three rules answer whether the business
is getting bigger: EPS growing 10% a year over three years, revenue growing 5%
a year over five, and profit in at least eight of the last ten years. The
thresholds are read off the SET100 distribution rather than picked out of the
air — EPS growing 10% a year is the top third of the index, revenue growing 5%
is the median — because a rule every name passes is not a rule and one only a
handful passes says nothing but "cyclical". The rates are compound annual
rates over the *calendar* span between the two points, so a history with a
missing year is not quietly treated as a shorter period, and a rate whose base
year lost money is left unmeasured rather than reported as zero. The deep dive
and the table read the same history, so the scorecard and the score agree.

**How good, not just good.** A threshold says a company is good; a percentile
says how good. Every row carries the share of the screened names it is better
than, for ROE, net margin, P/E, dividend yield and leverage — 92 means better
than 92 of every 100 names screened — and the deep dive shows the same figures
against the names in the company's own industry, because ROE of 20% is a
different statement beside a bank than beside a property developer. The
industry comes from the exchange's screener with the rest of the ratios, in one
request for the whole universe. A tie counts as half a place, a measure needs
at least three values to rank on, and an industry with fewer than five names in
it is not a peer group at all: a percentile drawn from three companies is not a
percentile.

Financials are judged on a narrower framework on purpose. A bank funds itself
with deposits, so "interest-bearing debt to equity below 1.0" reads 0.38 for
KBANK where the exchange publishes 5.77; its operating cash flow is the movement
in loans and deposits, not cash earnings; and free cash flow after capex is an
industrial measurement. Those five rules are marked *not applicable* for banks,
insurers and consumer lenders — skipped by the score, and skipped by a preset
that would otherwise make them mandatory. A rule that is merely *unknown* is
still strict: an unevaluated mandatory check disqualifies a row, because "we
could not tell" is not the same as "does not apply".

Ratios use average balances: net income over the average of opening and closing
equity and assets, which is both the standard definition and the one the
exchange publishes. Net margin uses total revenue. D/E is interest-bearing debt
over equity; the exchange publishes the same shape but classifies leases and
other borrowings differently, so the two will not tie out name by name (CPALL
3.20 here against 1.96 there, ADVANC 1.79 against 2.92).

Presets differ in which rules are **mandatory**, not in how the score is
computed, which is why the same company can be strong for one mandate and
disqualified for another.

`data/` holds nothing for the screener: statements are cached in memory for
twelve hours, and a cold run of a hundred names takes a few seconds at five
parallel upstream requests.

The engine is pure and covered by `scripts/verify-screener.mjs` — the DDM
against its closed form, the bands for the no-hindsight and filing-lag
properties, the dividend basis on both failure modes plus an instalment and a
real raise, the per-share definitions (DPS, trailing payout), average-balance
ROE/ROA, currency conversion, and the scoring on a healthy company, a bank, a
non-payer and a broken one.

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
| `GET /api/screener/universe` | screening universes: SET100, SET large caps, watchlists, saved boards |
| `POST /api/screener/run` | `{ universe \| symbols, preset, overrides }` → scored rows |
| `GET /api/screener/stock?symbol=&r=&g1=&g2=` | one company in full, re-valued for the sliders |
| `GET /api/stream?symbols=&intervalMs=` | SSE quote stream |
| `GET/POST/PATCH/DELETE /api/workspaces` | saved boards |
| `GET /api/mcp/tools` · `POST /api/mcp/tools/:name` | MCP passthrough |

---

## Two languages

The UI ships in English and Thai. Everything the desk shows that is *chrome*
rather than market data — buttons, hints, toasts, dialog copy, the status bar —
is translated, and so is the metadata the server sends over: indicator names,
groups, parameter labels, timeframe names and the fundamental-ratio hints.

Market data is left alone on purpose. Prices, tickers, company names, saved
board names and the JSON the MCP returns are not ours to translate, and the
symbol, indicator and ratio abbreviations (`RSI`, `P/E`, `MACD`) are the same
in both languages.

### How it is put together

`public/js/i18n.js` holds the two dictionaries and does the work:

| | |
|---|---|
| `t(key, vars, fallback)` | translate a key, substituting `{name}` placeholders |
| `tp(base, n, vars)` | plural form — `.one` / `.other` (Thai has no plural marker) |
| `setLang(lang)` / `toggleLang()` | persist the choice and reload |
| `applyStatic(root)` | fill every `data-i18n` node in the static markup |
| `localizeCatalog(catalog, groups)` | translate the indicator catalog the server sent |
| `localizeMetrics(metrics)` | translate the fundamental-ratio hints |
| `tfLabel(id, fallback)` | translate a timeframe name |

Two conventions keep the tables honest:

- **Static markup** carries `data-i18n` (plus `-title` / `-placeholder` /
  `-aria` variants). The English text stays in `index.html` as the no-JS
  fallback; `i18n.js` swaps it before the board boots.
- **Server-provided labels** are translated on the client, keyed by the English
  text: a parameter labelled `Std dev multiplier` is looked up as
  `param.std_dev_multiplier`. Only the human-readable fields are swapped —
  every `type`, `id`, range and default stays exactly as the server sent it,
  because those are what the calculation code validates against.

### Adding a string

1. Add the key to **both** tables in `public/js/i18n.js` — English first, then
   Thai, same key.
2. Use it: `t('your.key')`, or `t('your.key', { name: value })` for a
   placeholder.
3. For a count, add `your.key.one` and `your.key.other` and call
   `tp('your.key', n)`.

### Switching

The button in the top bar persists the choice and reloads the page. That is
deliberate: every string in the app is produced at render time, so one reload
is the honest way to bring open dialogs, generated forms and event-driven
chrome back in the new language, rather than maintaining a second "re-render
everything" path per surface.

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
  fin.js                statements, dividends and ratios per symbol
  finnomena.js          ten-year annual history: tracked file first, live API second
  screener.js           scoring rules, DDM, P/E and P/BV bands (pure)
  screener-run.js       runner, presets, universes, deep-dive payload
  quotes.js             Yahoo quote snapshot and sector profile (crumb)
  setindex.js           live SET100 constituents from set.or.th
public/
  index.html
  css/app.css
  js/i18n.js            English/Thai dictionaries, t(), localizeCatalog()
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