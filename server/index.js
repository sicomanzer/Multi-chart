/**
 * HTTP + SSE surface.
 *
 *   GET  /                     static single-page app
 *   GET  /api/health           liveness + MCP connection state
 *   GET  /api/meta             timeframes, exchanges, defaults (one round trip)
 *   GET  /api/indicators       indicator catalog (params + UI schema)
 *   GET  /api/symbols?q=       screener-backed symbol search
 *   GET  /api/candles?symbol=&timeframe=   OHLCV history
 *   POST /api/candles          { symbols[], timeframe } -> batch
 *   GET  /api/quotes?symbols=  MCP quotes
 *   GET  /api/stream           SSE: register symbols, receive quote pushes
 *   GET/POST/DELETE /api/workspaces        saved boards
 *   POST /api/mcp/tools/:name  generic MCP tool passthrough (screener, TA,
 *                              backtest, news, sentiment, ...)
 *
 * MCP stays in-process: the browser never spawns Python, and one shared client
 * means the whole board shares a single screener connection.
 */
import { fileURLToPath } from 'node:url';
import { dirname, join, normalize, resolve } from 'node:path';
import { randomUUID, timingSafeEqual } from 'node:crypto';

import express from 'express';

import { McpClient, McpError, detectPython } from './mcp-client.js';
import { RealtimeHub } from './realtime.js';
import { FundamentalsClient, METRIC_CATALOG, DEFAULT_METRICS, TRACKED_METRICS } from './fundamentals.js';
import { FundamentalsHistory } from './history.js';
import { WorkspaceStore, DEFAULT_SETTINGS } from './workspace-store.js';
import { INDICATORS, INDICATOR_GROUPS, defaultParams, sanitizeParams } from './indicator-catalog.js';
import {
  TIMEFRAMES, DEFAULT_TIMEFRAME, getCandles, getCandlesBatch,
  getQuotes, searchSymbols, availableCountries, clearCaches,
} from './market.js';
import {
  DEFAULT_EXCHANGES, normalizeSymbol, toYahooSymbol, bareSymbol, uniqueSymbols,
} from './symbols.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

const PORT = Number(process.env.PORT ?? 8787);
// PaaS platforms (Render, Railway, Fly) hand us PORT and expect the socket on
// every interface; the local default stays on loopback so a stray `npm start`
// is not reachable from the network.
const HOST = process.env.HOST ?? (process.env.PORT ? '0.0.0.0' : '127.0.0.1');
// Boards are persisted here. Containers and PaaS mounts are writable but
// ephemeral, so point DATA_DIR at a mounted volume to keep them across deploys.
const DATA_DIR = process.env.DATA_DIR ?? join(ROOT, 'data');
/** Fallback quote-push interval when a client does not ask for one. */
const DEFAULT_POLL_MS = 20_000;

const app = express();
app.disable('x-powered-by');
// Behind Render/Railway the socket is terminated by a proxy, so the client IP
// arrives in X-Forwarded-For. Nothing here is cookie-bound, but rate limiting
// and logging read req.ip, so let Express trust the hop.
app.set('trust proxy', true);
app.use(express.json({ limit: '2mb' }));

// ── Optional password ────────────────────────────────────────────────────────
//
// Off unless DECK_PASSWORD is set, which keeps `npm start` on a laptop exactly
// as open as it was. It exists because this app is otherwise unauthenticated:
// the MCP console can call any of the 37 upstream tools, and boards can be
// written and deleted. Deploying it to a public URL without a password hands all
// of that to anyone who loads the page.
//
// It has to sit above the first route: Express runs middleware in registration
// order and a route that answers never calls next(), so anything registered
// after /api/meta would never see a request for it.

const DECK_PASSWORD = process.env.DECK_PASSWORD ?? '';
const DECK_USER = process.env.DECK_USER ?? 'deck';

if (DECK_PASSWORD) {
  const expected = Buffer.from(`${DECK_USER}:${DECK_PASSWORD}`);
  app.use((req, res, next) => {
    // The platform health check cannot send credentials.
    if (req.path === '/api/health') return next();
    const given = Buffer.from(req.headers.authorization?.replace(/^Basic /i, '') ?? '', 'base64');
    // timingSafeEqual throws on a length mismatch, hence the guard.
    if (given.length === expected.length && timingSafeEqual(given, expected)) return next();
    res.setHeader('WWW-Authenticate', 'Basic realm="Trading Desk", charset="UTF-8"');
    res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'password required' } });
  });
  console.log('[auth] DECK_PASSWORD is set — every route except /api/health needs credentials');
} else {
  console.log('[auth] no DECK_PASSWORD set — listening without authentication');
}

// ── Wiring ───────────────────────────────────────────────────────────────────

const mcp = new McpClient({ command: detectPython() });
mcp.on('status', (s) => {
  const flag = s.connected ? 'connected' : 'offline';
  console.log(`[mcp] ${flag}${s.pid ? ` pid=${s.pid}` : ''}${s.lastError ? ` (${s.lastError})` : ''}`);
});

const store = new WorkspaceStore(join(DATA_DIR, 'workspaces.json'));
await store.load();

// Fundamentals (P/E, P/BV, D/E, dividend yield) are not exposed by any MCP
// tool, so they come from a small local sidecar that drives the same
// tradingview-screener package the MCP itself uses.
const fundamentals = new FundamentalsClient({ command: detectPython() });

// Daily record of the same ratios, because a screener only ever reports the
// current value and the trend features need the series. Recording starts the day
// this ships; it cannot be back-filled later.
const history = new FundamentalsHistory(join(DATA_DIR, 'fundamentals-history.jsonl'));
await history.load();

/**
 * Snapshot these symbols' ratios into the history file.
 *
 * Deliberately fire-and-forget: the board must not wait on a write, and a failed
 * write is a missing day rather than a broken page. `refresh` forces an upstream
 * fetch so the manual button picks up a freshly reported quarter instead of the
 * half-hour cache.
 */
async function snapshot(symbols, { refresh = false, force = false } = {}) {
  if (!symbols?.length) return null;
  try {
    const result = await fundamentals.get(symbols, {
      metrics: TRACKED_METRICS,
      refresh,
    });
    if (result.error) return { written: 0, error: result.error };
    const { written, skipped, error } = await history.record(result.data, {
      metrics: TRACKED_METRICS,
      force,
    });
    return { written, skipped, error };
  } catch (err) {
    console.warn(`[history] snapshot failed: ${err.message}`);
    return null;
  }
}

const hub = new RealtimeHub({
  mcp,
  fetchQuotes: (symbols) => getQuotes(mcp, symbols),
  onError: (err) => console.warn(`[realtime] ${err.message}`),
});
// The hub keeps the last price of every watched symbol; the board applies it to
// the forming candle, so nothing else needs to be notified here.
hub.on('tick', ({ quotes, errors }) => {
  if (errors?.length) {
    console.warn(`[realtime] ${Object.keys(quotes).length} quotes, ${errors.length} unresolved`);
  }
});

const asyncRoute = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res)).catch(next);

// ── Meta / health ────────────────────────────────────────────────────────────

/**
 * Liveness. Deliberately does *not* touch the MCP: a platform health check
 * polls this every few seconds and would either block on a Python subprocess or
 * kill the process during a slow boot. `?deep=1` adds the round trip for the
 * status pill, which asks for it once.
 */
app.get('/api/health', asyncRoute(async (req, res) => {
  const deep = req.query.deep === '1' || req.query.deep === 'true';
  res.json({
    status: 'ok',
    uptimeSeconds: Math.round(process.uptime()),
    // "ready" means the socket is up and the app can serve the board. The MCP
    // may still be starting; candles load without it, quotes do not.
    ready: true,
    mcp: deep ? { ...mcp.status(), ping: await mcp.ping() } : mcp.status(),
    fundamentals: fundamentals.status(),
    history: history.summary(),
    realtime: hub.status(),
    caches: { cleared: false },
  });
}));

app.post('/api/health/ping', asyncRoute(async (_req, res) => {
  const ping = await mcp.ping();
  res.json(ping);
}));

app.post('/api/cache/clear', (_req, res) => {
  clearCaches();
  res.json({ ok: true });
});

app.get('/api/meta', (_req, res) => {
  res.json({
    timeframes: Object.entries(TIMEFRAMES).map(([id, v]) => ({ id, ...v })),
    defaultTimeframe: DEFAULT_TIMEFRAME,
    exchanges: DEFAULT_EXCHANGES,
    countries: availableCountries(),
    defaultSettings: DEFAULT_SETTINGS,
    maxCharts: 60,
  });
});

// ── Indicators ───────────────────────────────────────────────────────────────

app.get('/api/indicators', (_req, res) => {
  res.json({
    indicators: INDICATORS.map((i) => ({
      type: i.type,
      name: i.name,
      short: i.short,
      group: i.group,
      placement: i.placement,
      defaultPaneHeight: i.defaultPaneHeight ?? null,
      params: i.params,
    })),
    groups: INDICATOR_GROUPS,
  });
});

app.post('/api/indicators/resolve', (req, res) => {
  const { type, params } = req.body ?? {};
  const def = INDICATORS.find((i) => i.type === type);
  if (!def) return res.status(400).json({ error: { code: 'UNKNOWN_INDICATOR', message: `no indicator "${type}"` } });
  res.json({
    type: def.type,
    placement: def.placement,
    params: params ? sanitizeParams(def.type, params) : defaultParams(def.type),
  });
});

// ── Symbols ──────────────────────────────────────────────────────────────────

function parseSymbolList(raw) {
  if (Array.isArray(raw)) return uniqueSymbols(raw);
  return uniqueSymbols(String(raw ?? '').split(/[,;\s]+/));
}

app.get('/api/symbols', asyncRoute(async (req, res) => {
  const { q, country = 'thailand', limit = '25' } = req.query;
  const result = await searchSymbols(mcp, q, {
    country: String(country),
    limit: Math.min(100, Math.max(1, Number(limit) || 25)),
  });
  res.json(result);
}));

app.get('/api/symbol/resolve', (req, res) => {
  const symbol = normalizeSymbol(req.query.symbol);
  res.json({
    input: String(req.query.symbol ?? ''),
    symbol,
    yahooSymbol: toYahooSymbol(symbol ?? ''),
    exchange: symbol?.split(':')[0] ?? null,
    display: symbol ? bareSymbol(symbol) : null,
  });
});

// ── Market data ──────────────────────────────────────────────────────────────

app.get('/api/candles', asyncRoute(async (req, res) => {
  const symbol = normalizeSymbol(req.query.symbol);
  if (!symbol) {
    return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'symbol is required' } });
  }
  const timeframe = String(req.query.timeframe ?? DEFAULT_TIMEFRAME);
  if (!TIMEFRAMES[timeframe]) {
    return res.status(400).json({ error: { code: 'BAD_REQUEST', message: `unknown timeframe "${timeframe}"` } });
  }
  const range = req.query.range ? String(req.query.range) : undefined;
  const data = await getCandles(symbol, timeframe, { range });
  res.json(data);
}));

app.post('/api/candles', asyncRoute(async (req, res) => {
  const symbols = parseSymbolList(req.body?.symbols);
  const timeframe = String(req.body?.timeframe ?? DEFAULT_TIMEFRAME);
  if (!TIMEFRAMES[timeframe]) {
    return res.status(400).json({ error: { code: 'BAD_REQUEST', message: `unknown timeframe "${timeframe}"` } });
  }
  if (symbols.length === 0) {
    return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'symbols is required' } });
  }
  res.json(await getCandlesBatch(symbols, timeframe));
}));

app.get('/api/quotes', asyncRoute(async (req, res) => {
  const symbols = parseSymbolList(req.query.symbols);
  if (symbols.length === 0) {
    return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'symbols is required' } });
  }
  res.json(await getQuotes(mcp, symbols));
}));

// ── Fundamentals ────────────────────────────────────────────────────────────

app.get('/api/fundamentals', asyncRoute(async (req, res) => {
  const symbols = parseSymbolList(req.query.symbols);
  if (symbols.length === 0) {
    return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'symbols is required' } });
  }
  if (symbols.length > 200) {
    return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'max 200 symbols per request' } });
  }

  const requested = String(req.query.metrics ?? '')
    .split(',').map((m) => m.trim()).filter(Boolean);
  const metrics = requested.filter((m) => METRIC_CATALOG.some((c) => c.key === m));
  const refresh = req.query.refresh === '1' || req.query.refresh === 'true';

  const result = await fundamentals.get(symbols, {
    metrics: metrics.length ? metrics : DEFAULT_METRICS,
    refresh,
  });
  // Keep the trend series going on every board load. It runs on the tracked set
  // regardless of which metrics the footer asked for, otherwise the recorded
  // shape would depend on who looked at the board.
  snapshot(symbols).catch(() => {});
  res.json({ ...result, metrics: metrics.length ? metrics : DEFAULT_METRICS });
}));

app.get('/api/fundamentals/metrics', (_req, res) => {
  res.json({
    metrics: METRIC_CATALOG,
    defaults: DEFAULT_METRICS,
    tracked: TRACKED_METRICS,
    status: fundamentals.status(),
  });
});

/**
 * The recorded series, and the shape of what has been recorded so far.
 *
 * `from`/`to` are YYYY-MM-DD. A symbol with no history returns an empty list
 * rather than an error — a name added to the board today has no past yet, which
 * is the normal case for the first weeks.
 */
app.get('/api/fundamentals/history', (req, res) => {
  const symbol = normalizeSymbol(req.query.symbol);
  if (!symbol) {
    return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'symbol is required' } });
  }
  const metrics = String(req.query.metrics ?? '')
    .split(',').map((m) => m.trim())
    .filter((m) => METRIC_CATALOG.some((c) => c.key === m));

  return res.json({
    symbol,
    tracked: TRACKED_METRICS,
    points: history.series(symbol, {
      from: req.query.from ? String(req.query.from) : undefined,
      to: req.query.to ? String(req.query.to) : undefined,
      metrics: metrics.length ? metrics : undefined,
    }),
    summary: history.summary(),
  });
});

app.get('/api/fundamentals/history/summary', (_req, res) => {
  res.json({ ...history.summary(), tracked: TRACKED_METRICS });
});

app.post('/api/fundamentals/history/snapshot', asyncRoute(async (req, res) => {
  const symbols = parseSymbolList(req.body?.symbols);
  if (symbols.length === 0) {
    return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'symbols is required' } });
  }
  // force + refresh: the user asked for it now, so take today's numbers even if
  // today's row exists — a company may have reported since the board loaded.
  const result = await snapshot(symbols.slice(0, 200), { refresh: true, force: true });
  // `tracked` lives on the module, not on the store, so add it here or the UI
  // renders "× 0 ratios".
  res.json({ ...result, summary: { ...history.summary(), tracked: TRACKED_METRICS } });
}));

app.post('/api/fundamentals/cache/clear', (_req, res) => {
  fundamentals.clearCache();
  res.json({ ok: true });
});

// ── Workspaces ───────────────────────────────────────────────────────────────

app.get('/api/workspaces', (_req, res) => res.json({ workspaces: store.list() }));

app.get('/api/workspaces/:id', (req, res) => {
  const ws = store.get(req.params.id);
  if (!ws) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'no such workspace' } });
  res.json(ws);
});

/** Shared write path for POST / PUT / PATCH on a board. */
function saveWorkspace(req, res, { id } = {}) {
  const body = req.body ?? {};
  const known = id ? store.get(id) : null;
  if (id && !known) {
    return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'no such workspace' } });
  }

  const result = store.save({ ...body, id: known?.id }, {
    id: known?.id,
    baseRevision: body.baseRevision,
  });

  if (result?.conflict) {
    console.warn(`[workspace] save rejected: "${known?.name}" moved to revision ${result.current.revision}, client had ${body.baseRevision}`);
    // Someone else (another tab, the CLI) saved since this client loaded.
    return res.status(409).json({
      error: {
        code: 'REVISION_CONFLICT',
        message: 'this board was changed elsewhere since you loaded it',
      },
      current: result.current,
    });
  }

  console.log(`[workspace] "${result.name}" saved: revision ${result.revision}, ${result.charts.length} charts`);
  return res.status(200).json(result);
}

app.post('/api/workspaces', (req, res) => {
  const body = req.body ?? {};
  // An unknown id means the board was deleted on the server (or on another
  // machine) while this client still had it open. Minting a fresh id stops a
  // stale client from resurrecting a deleted board; the response carries the
  // new id so the client can adopt it.
  const known = body.id ? store.get(String(body.id)) : null;
  return saveWorkspace(req, res, { id: known?.id });
});

app.put('/api/workspaces/:id', (req, res) => saveWorkspace(req, res, { id: req.params.id }));

app.patch('/api/workspaces/:id', (req, res) => saveWorkspace(req, res, { id: req.params.id }));

app.post('/api/workspaces/:id/duplicate', (req, res) => {
  const ws = store.duplicate(req.params.id);
  if (!ws) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'no such workspace' } });
  res.status(201).json(ws);
});

app.delete('/api/workspaces/:id', (req, res) => {
  // Idempotent: deleting a board that is already gone is a no-op, not an error
  // (two tabs can easily race here).
  const removed = store.remove(req.params.id);
  res.status(204).json({ ok: true, removed });
});

// ── Generic MCP passthrough ──────────────────────────────────────────────────

app.get('/api/mcp/tools', asyncRoute(async (_req, res) => {
  res.json({ tools: await mcp.listTools() });
}));

const TOOL_ALLOWLIST = new Set([
  'top_gainers', 'top_losers', 'bollinger_scan', 'rating_filter', 'coin_analysis',
  'consecutive_candles_scan', 'advanced_candle_pattern', 'volume_breakout_scanner',
  'volume_confirmation_analysis', 'smart_volume_scanner', 'multi_agent_analysis',
  'egx_market_overview', 'egx_sector_scan', 'egx_sector_scanner', 'egx_index_analysis',
  'egx_stock_screener', 'egx_trade_plan', 'egx_fibonacci_retracement',
  'multi_timeframe_analysis', 'market_sentiment', 'financial_news', 'combined_analysis',
  'backtest_strategy', 'compare_strategies', 'walk_forward_backtest_strategy',
  'yahoo_price', 'market_snapshot', 'bitcoin_market_pulse', 'stock_extended_hours',
  'stock_options_chain', 'stock_options_unusual_activity', 'futures_market_overview',
  'futures_top_movers', 'futures_category_snapshot', 'futures_watchlist',
  'stock_screener', 'stock_prices', 'exchanges_list',
]);

/**
 * Tools whose `symbol` / `tickers` argument is a Yahoo Finance ticker, not a
 * TradingView `EXCHANGE:SYMBOL`. The board speaks TradingView, so the
 * passthrough translates before calling — otherwise `yahoo_price SET:CPF`
 * fails upstream with an unhelpful "symbol not found".
 */
const YAHOO_SYMBOL_TOOLS = new Set([
  'yahoo_price', 'stock_extended_hours', 'stock_options_chain',
  'stock_options_unusual_activity', 'backtest_strategy', 'compare_strategies',
  'walk_forward_backtest_strategy', 'market_sentiment', 'financial_news',
  'bitcoin_market_pulse',
]);

function adaptToolArgs(name, args) {
  if (!YAHOO_SYMBOL_TOOLS.has(name)) return args;
  const out = { ...args };
  if (typeof out.symbol === 'string') out.symbol = toYahooSymbol(out.symbol) ?? out.symbol;
  if (typeof out.tickers === 'string') {
    out.tickers = out.tickers
      .split(',')
      .map((t) => toYahooSymbol(t.trim()) ?? t.trim())
      .join(',');
  }
  return out;
}

app.post('/api/mcp/tools/:name', asyncRoute(async (req, res) => {
  const { name } = req.params;
  if (!TOOL_ALLOWLIST.has(name)) {
    return res.status(404).json({ error: { code: 'UNKNOWN_TOOL', message: `"${name}" is not exposed` } });
  }
  const args = adaptToolArgs(name, req.body?.arguments ?? {});
  const timeoutMs = Number(req.body?.timeoutMs) || undefined;
  const data = await mcp.callTool(name, args, { timeoutMs });
  res.json({ tool: name, arguments: args, data });
}));

app.get('/api/mcp/resources/exchanges', asyncRoute(async (_req, res) => {
  // `exchanges://list` is a FastMCP resource, not a tool.
  await mcp.ensureStarted();
  const result = await mcp.callTool('exchanges_list', {});
  res.json({ exchanges: typeof result === 'string' ? result : result });
}));

// ── Realtime stream (SSE) ────────────────────────────────────────────────────

app.get('/api/stream', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  const clientId = String(req.query.clientId || randomUUID());
  res.write(`retry: 3000\n\n`);
  res.write(`event: hello\ndata: ${JSON.stringify({
    clientId,
    mcp: mcp.status(),
    realtime: hub.status(),
  })}\n\n`);

  const onQuotes = (_id, payload) => {
    if (payload.quotes && Object.keys(payload.quotes).length === 0 && !payload.errors?.length) return;
    res.write(`event: quotes\ndata: ${JSON.stringify(payload)}\n\n`);
  };
  const onStatus = (status) => {
    res.write(`event: status\ndata: ${JSON.stringify(status)}\n\n`);
  };

  hub.on('quotes', onQuotes);
  mcp.on('status', onStatus);

  const parseSubscribe = () => {
    let symbols = [];
    let intervalMs = DEFAULT_POLL_MS;
    try {
      symbols = JSON.parse(String(req.query.symbols ?? '[]'));
    } catch { /* ignore malformed */ }
    intervalMs = Number(req.query.intervalMs) || DEFAULT_POLL_MS;
    return { symbols: Array.isArray(symbols) ? symbols : [], intervalMs };
  };

  hub.register(clientId, {
    ...parseSubscribe(),
    meta: { userAgent: req.headers['user-agent'] ?? null },
  });

  // Keep-alive: proxies and browsers drop idle SSE connections after ~30s.
  const ping = setInterval(() => res.write(': ping\n\n'), 20_000);
  ping.unref?.();

  const cleanup = () => {
    clearInterval(ping);
    hub.off('quotes', onQuotes);
    mcp.off('status', onStatus);
    hub.unregister(clientId);
    res.end();
  };
  req.on('close', cleanup);
  req.on('error', cleanup);
});

app.post('/api/stream/:clientId/subscribe', (req, res) => {
  const status = hub.update(req.params.clientId, {
    symbols: parseSymbolList(req.body?.symbols ?? []),
    intervalMs: Number(req.body?.intervalMs) || undefined,
  });
  res.json({ ok: true, ...status });
});

// ── Static app ───────────────────────────────────────────────────────────────

const VENDOR = join(ROOT, 'node_modules', 'lightweight-charts', 'dist');

// Serve the charting library from node_modules rather than a CDN: the desk is
// meant to run offline on a trading-floor machine with no internet egress.
app.use('/vendor/lightweight-charts.js', (_req, res) => {
  res.sendFile(join(VENDOR, 'lightweight-charts.standalone.production.js'), {
    headers: { 'Cache-Control': 'public, max-age=86400' },
  });
});
app.use('/vendor/lightweight-charts.d.ts', (_req, res) => {
  res.sendFile(join(VENDOR, 'typings.d.ts'));
});

app.use(express.static(join(ROOT, 'public'), {
  extensions: ['html'],
  setHeaders: (res, path) => {
    if (path.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
  },
}));

// SPA fallback (normalize before join so `..` can't escape /public).
app.get(/.*/, (req, res, next) => {
  if (req.path.startsWith('/api/') || req.path.startsWith('/vendor/')) return next();
  res.sendFile(join(ROOT, 'public', normalize(req.path).replace(/^(\.\.[/\\])+/, '')));
});

// ── Error handling ───────────────────────────────────────────────────────────
// Registered after every route so Express actually routes into it.

app.use((err, req, res, _next) => {
  if (err instanceof McpError) {
    const status = err.code === 'TIMEOUT' ? 504
      : err.code === 'NOT_CONNECTED' || err.code === 'SPAWN_FAILED' ? 503
      : err.code === 'TOOL_ERROR' || err.code === 'RPC_ERROR' ? 502
      : 500;
    return res.status(status).json({ error: { code: err.code, message: err.message } });
  }
  const status = Number(err.status ?? (err.code === 'ENOENT' ? 404 : 500));
  if (status >= 500) console.error('[api]', err);
  res.status(status).json({
    error: {
      code: err.code ?? 'INTERNAL',
      message: err.message ?? 'unexpected error',
      ...(err.yahooCode ? { upstream: err.yahooCode } : {}),
    },
  });
});

// ── Boot ─────────────────────────────────────────────────────────────────────

const server = app.listen(PORT, HOST, () => {
  // 0.0.0.0 is not an address you can visit; show the loopback form instead.
  const shown = HOST === '0.0.0.0' ? '127.0.0.1' : HOST;
  console.log(`\n  Multi-chart trading desk  ->  http://${shown}:${PORT}\n`);
  console.log(`  MCP command: ${mcp.config.command} ${mcp.config.args.join(' ')}`);
  console.log(`  Workspaces: ${store.filePath}`);
  console.log(`  Data dir:   ${DATA_DIR}${process.env.DATA_DIR ? ' (DATA_DIR)' : ''}\n`);
  mcp.ensureStarted().catch((err) => console.warn(`[mcp] initial start failed: ${err.message}`));
});

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n[${signal}] shutting down…`);
  hub.stop();
  server.close();
  await store.flush().catch(() => {});
  await Promise.allSettled([mcp.stop(), fundamentals.stop()]);
  process.exit(0);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', (err) => console.warn('[unhandled]', err?.message ?? err));