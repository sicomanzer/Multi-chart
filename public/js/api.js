/** Thin fetch wrapper. Every backend failure surfaces as an ApiError. */

export class ApiError extends Error {
  constructor(code, message, status) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}

async function request(path, { method = 'GET', body, signal, keepalive = false } = {}) {
  const res = await fetch(path, {
    method,
    signal,
    // `keepalive` lets a save survive the page unloading (beforeunload).
    keepalive,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (res.status === 204) return { ok: true };

  const text = await res.text();
  let payload = null;
  if (text) {
    try { payload = JSON.parse(text); } catch { payload = text; }
  }

  if (!res.ok) {
    const err = payload?.error ?? {};
    const error = new ApiError(err.code ?? `HTTP_${res.status}`, err.message ?? res.statusText, res.status);
    // A revision conflict carries the server's copy so the caller can recover.
    error.current = payload?.current ?? null;
    throw error;
  }
  return payload;
}

const qs = (params) => {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params ?? {})) {
    if (v !== undefined && v !== null && v !== '') search.set(k, String(v));
  }
  const s = search.toString();
  return s ? `?${s}` : '';
};

export const api = {
  meta: () => request('/api/meta'),
  // `deep` adds a real round trip to the MCP so the status pill can show a
  // latency. Left off by default because platform health checks poll this URL
  // every few seconds and must never wait on a Python subprocess.
  health: (deep = false) => request(`/api/health${deep ? '?deep=1' : ''}`),
  indicators: () => request('/api/indicators'),

  candles: (symbol, timeframe, opts = {}) =>
    request(`/api/candles${qs({ symbol, timeframe, ...opts })}`),

  candlesBatch: (symbols, timeframe) =>
    request('/api/candles', { method: 'POST', body: { symbols, timeframe } }),

  quotes: (symbols) => request(`/api/quotes${qs({ symbols: symbols.join(',') })}`),

  fundamentals: (symbols, { metrics, refresh = false } = {}) => request(
    `/api/fundamentals${qs({
      symbols: symbols.join(','),
      metrics: metrics?.length ? metrics.join(',') : undefined,
      refresh: refresh ? '1' : undefined,
    })}`,
  ),
  fundamentalsMeta: () => request('/api/fundamentals/metrics'),
  fundamentalsHistory: (symbol, { from, to, metrics } = {}) => request(
    `/api/fundamentals/history${qs({
      symbol,
      from,
      to,
      metrics: metrics?.length ? metrics.join(',') : undefined,
    })}`,
  ),
  fundamentalsHistorySummary: () => request('/api/fundamentals/history/summary'),
  snapshotHistory: (symbols) => request('/api/fundamentals/history/snapshot', {
    method: 'POST',
    body: { symbols },
  }),

  symbols: (q, country = 'thailand', limit = 25) =>
    request(`/api/symbols${qs({ q, country, limit })}`),

  resolveSymbol: (symbol) => request(`/api/symbol/resolve${qs({ symbol })}`),

  workspaces: () => request('/api/workspaces'),
  workspace: (id) => request(`/api/workspaces/${id}`),
  saveWorkspace: (ws, { keepalive = false } = {}) =>
    request('/api/workspaces', { method: 'POST', body: ws, keepalive }),
  patchWorkspace: (id, patch) => request(`/api/workspaces/${id}`, { method: 'PATCH', body: patch }),
  deleteWorkspace: (id) => request(`/api/workspaces/${id}`, { method: 'DELETE' }),

  // ── Watchlists ────────────────────────────────────────────────────────────
  // Symbol add/remove have their own routes so that ticking one ticker off a
  // long list does not require sending the whole list back and racing whatever
  // else changed it in the meantime.
  watchlists: () => request('/api/watchlists'),
  watchlist: (id) => request(`/api/watchlists/${id}`),
  createWatchlist: (name, symbols) =>
    request('/api/watchlists', { method: 'POST', body: { name, symbols } }),
  watchlistFromSymbols: (symbols, name) =>
    request('/api/watchlists/from-board', { method: 'POST', body: { symbols, name } }),
  renameWatchlist: (id, name) =>
    request(`/api/watchlists/${id}`, { method: 'PATCH', body: { name } }),
  setWatchlist: (id, symbols) =>
    request(`/api/watchlists/${id}`, { method: 'PUT', body: { symbols } }),
  deleteWatchlist: (id) => request(`/api/watchlists/${id}`, { method: 'DELETE' }),
  duplicateWatchlist: (id) =>
    request(`/api/watchlists/${id}/duplicate`, { method: 'POST' }),
  addWatchlistSymbols: (id, symbols) =>
    request(`/api/watchlists/${id}/symbols`, { method: 'POST', body: { symbols } }),
  removeWatchlistSymbols: (id, symbols) =>
    request(`/api/watchlists/${id}/symbols`, { method: 'DELETE', body: { symbols } }),

  mcpTools: () => request('/api/mcp/tools'),
  mcpCall: (name, args, timeoutMs) =>
    request(`/api/mcp/tools/${name}`, { method: 'POST', body: { arguments: args, timeoutMs } }),

  // ── Screener ──────────────────────────────────────────────────────────────
  // The run is one request rather than a job: the server caches statements for
  // twelve hours, so a repeat run is instant and a cold one is a few seconds.
  screenerUniverse: () => request('/api/screener/universe'),
  screenerRun: (body) => request('/api/screener/run', { method: 'POST', body }),
  screenerStock: (symbol, overrides = {}) =>
    request(`/api/screener/stock${qs({ symbol, ...overrides })}`),
};