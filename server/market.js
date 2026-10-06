/**
 * Market data layer.
 *
 * Two sources, deliberately split by what each is good at:
 *
 *   quotes  -> MCP `stock_prices` (one request carries up to 2000 tickers)
 *             TradingView screener data: price, day OHLC, % change, currency,
 *             exchange, and the company name for free.
 *
 *   candles -> Yahoo Finance chart endpoint (query1.finance.yahoo.com/v8/...).
 *             The MCP has no historical OHLC tool; this is the exact endpoint
 *             the MCP's own yahoo_finance_service uses for quotes, so the
 *             candles and the quote line agree. A small TTL cache plus
 *             single-flight de-duplication keeps a 20-chart grid from
 *             hammering upstream.
 */
import { normalizeSymbol, toYahooSymbol } from './symbols.js';

const YAHOO_CHART = 'https://query1.finance.yahoo.com/v8/finance/chart';
const USER_AGENT = 'Mozilla/5.0 (compatible; multi-chart-trading-desk/1.0)';

/** TradingView timeframe id -> Yahoo interval + a sensible default range. */
export const TIMEFRAMES = {
  '1m': { label: '1 minute', yahoo: '1m', range: '1d', seconds: 60 },
  '5m': { label: '5 minutes', yahoo: '5m', range: '5d', seconds: 300 },
  '15m': { label: '15 minutes', yahoo: '15m', range: '1mo', seconds: 900 },
  '30m': { label: '30 minutes', yahoo: '30m', range: '1mo', seconds: 1800 },
  '1h': { label: '1 hour', yahoo: '60m', range: '3mo', seconds: 3600 },
  '4h': { label: '4 hours', yahoo: '60m', range: '1y', seconds: 14400 },
  '1d': { label: '1 day', yahoo: '1d', range: '2y', seconds: 86400 },
  '1w': { label: '1 week', yahoo: '1wk', range: '5y', seconds: 604800 },
  '1M': { label: '1 month', yahoo: '1mo', range: '10y', seconds: 2592000 },
};

export const DEFAULT_TIMEFRAME = '1d';

// ── Tiny TTL cache with single-flight ────────────────────────────────────────

class TtlCache {
  constructor(ttlMs, maxEntries = 500) {
    this.ttlMs = ttlMs;
    this.maxEntries = maxEntries;
    this.map = new Map();
    this.inflight = new Map();
  }

  get(key) {
    const hit = this.map.get(key);
    if (!hit) return undefined;
    if (Date.now() > hit.expires) {
      this.map.delete(key);
      return undefined;
    }
    return hit.value;
  }

  set(key, value, ttlMs = this.ttlMs) {
    if (this.map.size >= this.maxEntries) {
      const oldest = this.map.keys().next().value;
      this.map.delete(oldest);
    }
    this.map.set(key, { value, expires: Date.now() + ttlMs });
    return value;
  }

  /** Coalesce concurrent misses for the same key into one upstream request. */
  async fetch(key, producer, ttlMs = this.ttlMs) {
    const cached = this.get(key);
    if (cached !== undefined) return cached;

    const pending = this.inflight.get(key);
    if (pending) return pending;

    const p = (async () => producer())()
      .then((value) => this.set(key, value, ttlMs))
      .finally(() => this.inflight.delete(key));

    this.inflight.set(key, p);
    return p;
  }

  clear() {
    this.map.clear();
    this.inflight.clear();
  }
}

// Intraday candles change constantly; daily+ bars are effectively immutable
// within a session. Two caches, so a 20-chart daily grid stays cache-friendly.
const intradayCache = new TtlCache(20_000);
const dailyCache = new TtlCache(60_000);

/** Seconds-per-bar for each timeframe (used to align 4h from 60m bars). */
const TIMEFRAME_SECONDS = Object.fromEntries(
  Object.entries(TIMEFRAMES).map(([k, v]) => [k, v.seconds]),
);

function isIntraday(tf) {
  return (TIMEFRAME_SECONDS[tf] ?? 86400) < 86400;
}

function cacheFor(tf) {
  return isIntraday(tf) ? intradayCache : dailyCache;
}

// ── Yahoo candles ────────────────────────────────────────────────────────────

async function fetchYahooJson(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20_000);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    });
    if (!res.ok) {
      const e = new Error(`Yahoo responded ${res.status} for ${url.split('/').pop()}`);
      e.code = res.status === 404 ? 'NO_DATA' : 'UPSTREAM_HTTP';
      e.status = res.status === 404 ? 404 : 502;
      throw e;
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/** Yahoo returns `null` entries inside timestamp-aligned arrays. Drop them. */
function zipOhlc(result) {
  const ts = result.timestamp ?? [];
  const q = result.indicators?.quote?.[0] ?? {};
  const adj = result.indicators?.adjclose?.[0]?.adjclose;
  const bars = [];

  for (let i = 0; i < ts.length; i += 1) {
    const o = q.open?.[i];
    const h = q.high?.[i];
    const l = q.low?.[i];
    const c = q.close?.[i];
    if (o == null || h == null || l == null || c == null) continue;
    bars.push({
      time: ts[i],
      open: o,
      high: h,
      low: l,
      close: c,
      volume: Number.isFinite(q.volume?.[i]) ? q.volume[i] : 0,
      adjClose: Number.isFinite(adj?.[i]) ? adj[i] : c,
    });
  }
  return bars;
}

/**
 * Roll hourly bars into 4-hour candles. Buckets are aligned to the exchange
 * session rather than to the wall clock, so labels stay stable intraday.
 */
function aggregate(bars, bucketSeconds, tz) {
  const out = [];
  const offset = tzOffsetSeconds(tz);
  for (const bar of bars) {
    const local = bar.time + offset;
    const bucket = Math.floor(local / bucketSeconds) * bucketSeconds - offset;
    const last = out[out.length - 1];
    if (last && last.time === bucket) {
      last.high = Math.max(last.high, bar.high);
      last.low = Math.min(last.low, bar.low);
      last.close = bar.close;
      last.volume += bar.volume;
    } else {
      out.push({ ...bar, time: bucket });
    }
  }
  return out;
}

/** Standard-time UTC offset for a zone, without pulling in a tz library. */
function tzOffsetSeconds(tz, at = Date.UTC(2024, 0, 15)) {
  try {
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    const parts = Object.fromEntries(
      dtf.formatToParts(new Date(at)).map((p) => [p.type, p.value]),
    );
    const asUtc = Date.UTC(
      Number(parts.year), Number(parts.month) - 1, Number(parts.day),
      Number(parts.hour) % 24, Number(parts.minute), Number(parts.second),
    );
    return (asUtc - at) / 1000;
  } catch {
    return 0;
  }
}

function normalizeTimeframe(tf) {
  return TIMEFRAMES[tf] ? tf : DEFAULT_TIMEFRAME;
}

/**
 * Historical OHLCV for one symbol.
 * @returns {Promise<{symbol:string, yahooSymbol:string, exchange:string,
 *   timeframe:string, bars:Array, meta:object, fetchedAt:number}>}
 */
export async function getCandles(rawSymbol, tfInput = DEFAULT_TIMEFRAME, { range } = {}) {
  const symbol = normalizeSymbol(rawSymbol);
  if (!symbol) throw new Error('symbol is required');

  const tf = normalizeTimeframe(tfInput);
  const spec = TIMEFRAMES[tf];
  const yahooSymbol = toYahooSymbol(symbol);
  if (!yahooSymbol) throw new Error(`cannot map ${symbol} to a Yahoo symbol`);

  const want4h = tf === '4h';
  const interval = want4h ? '60m' : spec.yahoo;
  const rangeParam = range ?? (want4h ? '1y' : spec.range);
  const key = `${yahooSymbol}|${interval}|${rangeParam}`;

  const payload = await cacheFor(tf).fetch(key, async () => {
    const url = `${YAHOO_CHART}/${encodeURIComponent(yahooSymbol)}` +
      `?interval=${interval}&range=${rangeParam}&includePrePost=false`;
    const json = await fetchYahooJson(url);

    const err = json?.chart?.error;
    if (err) {
      // Yahoo answers with a 200 and an error envelope for unknown symbols, so
      // the status has to be inferred from the upstream code.
      const message = err.description || err.code || 'Yahoo chart error';
      const e = new Error(message);
      e.code = 'UPSTREAM_SYMBOL';
      e.yahooCode = err.code;
      e.status = /not found|no data|invalid/i.test(message) ? 404 : 502;
      throw e;
    }
    const result = json?.chart?.result?.[0];
    if (!result) {
      const e = new Error(`no data for ${yahooSymbol}`);
      e.code = 'NO_DATA';
      e.status = 404;
      throw e;
    }

    let bars = zipOhlc(result);
    if (want4h) bars = aggregate(bars, TIMEFRAME_SECONDS['4h'], result.meta?.exchangeTimezoneName);

    const meta = result.meta ?? {};
    return {
      symbol,
      yahooSymbol,
      exchange: String(symbol.split(':')[0]),
      timeframe: tf,
      bars,
      meta: {
        name: meta.longName || meta.shortName || symbol.split(':')[1],
        currency: meta.currency ?? null,
        exchangeName: meta.exchangeName ?? null,
        timezone: meta.exchangeTimezoneName ?? 'UTC',
        instrumentType: meta.instrumentType ?? null,
        regularMarketPrice: meta.regularMarketPrice ?? null,
        previousClose: meta.chartPreviousClose ?? meta.previousClose ?? null,
        fiftyTwoWeekHigh: meta.fiftyTwoWeekHigh ?? null,
        fiftyTwoWeekLow: meta.fiftyTwoWeekLow ?? null,
        priceHint: meta.priceHint ?? null,
        bars: bars.length,
        interval,
        range: rangeParam,
      },
      fetchedAt: Date.now(),
    };
  });

  // Defensive copy: callers (and the WebSocket fan-out) mutate nothing, but the
  // cache is shared so handing out the same array invites subtle bugs.
  return { ...payload, bars: payload.bars.map((b) => ({ ...b })) };
}

/** Many symbols at once. Rejections are reported per symbol, not thrown. */
export async function getCandlesBatch(symbols, timeframe) {
  const results = await Promise.allSettled(
    symbols.map((s) => getCandles(s, timeframe)),
  );
  const out = {};
  symbols.forEach((s, i) => {
    const norm = normalizeSymbol(s);
    const r = results[i];
    out[norm] = r.status === 'fulfilled'
      ? r.value
      : { symbol: norm, error: r.reason?.message ?? 'failed', bars: [] };
  });
  return out;
}

// ── MCP quotes ───────────────────────────────────────────────────────────────

/**
 * Current quotes via MCP `stock_prices`.
 *
 * The screener's ticker lookup is exchange-scoped, so we pass canonical
 * `EXCHANGE:SYMBOL` pairs and ask for as many as the grid has open. Symbols the
 * screener doesn't carry (some indices, most crypto pairs) come back in
 * `not_found`; for those we quietly fall back to the Yahoo chart meta so a
 * chart header is never blank.
 */
export async function getQuotes(mcp, rawSymbols) {
  const symbols = [...new Set(rawSymbols.map(normalizeSymbol).filter(Boolean))];
  if (symbols.length === 0) return { quotes: {}, errors: [] };

  const quotes = {};
  const errors = [];

  const CHUNK = 400;
  for (let i = 0; i < symbols.length; i += CHUNK) {
    const chunk = symbols.slice(i, i + CHUNK);
    try {
      const res = await mcp.callTool('stock_prices', { tickers: chunk.join(', ') });
      for (const row of res?.rows ?? []) {
        const sym = normalizeSymbol(row.ticker ?? `${row.exchange}:${row.symbol}`);
        if (!sym) continue;
        const prevClose = row.previous_close ?? null;
        quotes[sym] = {
          symbol: sym,
          display: row.symbol,
          name: row.description ?? null,
          exchange: row.exchange ?? null,
          price: row.price ?? null,
          open: row.open ?? null,
          high: row.high ?? null,
          low: row.low ?? null,
          prevClose,
          change: prevClose != null && row.price != null ? row.price - prevClose : null,
          changePercent: row.change_percent ?? null,
          currency: row.currency ?? null,
          source: 'mcp:stock_prices',
          updatedAt: Date.now(),
        };
      }
      for (const missing of res?.not_found ?? []) {
        const sym = normalizeSymbol(missing);
        if (sym) errors.push({ symbol: sym, message: 'screener did not recognise this ticker' });
      }
    } catch (err) {
      for (const sym of chunk) errors.push({ symbol: sym, message: err.message, code: err.code });
    }
  }

  const unresolved = symbols.filter((s) => !quotes[s]);
  if (unresolved.length) {
    const fallback = await Promise.allSettled(
      unresolved.map((s) => getCandles(s, '1d', { range: '5d' })),
    );
    fallback.forEach((r, i) => {
      if (r.status !== 'fulfilled') return;
      const d = r.value;
      const price = d.meta.regularMarketPrice;
      if (price == null) return;
      const prev = d.meta.previousClose ?? d.bars.at(-2)?.close ?? null;
      quotes[unresolved[i]] = {
        symbol: unresolved[i],
        display: unresolved[i].split(':')[1],
        name: d.meta.name,
        exchange: d.exchange,
        price,
        open: d.bars.at(-1)?.open ?? null,
        high: d.meta.fiftyTwoWeekHigh != null ? d.bars.at(-1)?.high : null,
        low: null,
        prevClose: prev,
        change: prev != null ? price - prev : null,
        changePercent: prev ? ((price - prev) / prev) * 100 : null,
        currency: d.meta.currency,
        source: 'fallback:yahoo',
        updatedAt: Date.now(),
      };
    });
  }

  return { quotes, errors };
}

// ── Symbol search ────────────────────────────────────────────────────────────

const COUNTRY_TO_EXCHANGE = {
  thailand: 'SET',
  turkey: 'BIST',
  türkiye: 'BIST',
  egypt: 'EGX',
  'south korea': 'KRX',
  korea: 'KRX',
  japan: 'TSE',
  'hong kong': 'HKEX',
  china: 'SSE',
  taiwan: 'TWSE',
  india: 'NSE',
  malaysia: 'MYX',
  indonesia: 'IDX',
  vietnam: 'HOSE',
  philippines: 'PSE',
  singapore: 'SGX',
  australia: 'ASX',
  canada: 'TSX',
  'united states': 'NASDAQ',
  usa: 'NASDAQ',
  'united kingdom': 'LSE',
  germany: 'XETR',
  france: 'EURONEXT',
  brazil: 'BVMF',
  'south africa': 'JSE',
};

/** Screener tool for a given country, plus the exchange prefix it returns. */
const COUNTRY_TOOL = {
  thailand: 'stock_screener',
  turkey: 'stock_screener',
  egypt: 'egx_stock_screener',
};

export async function searchSymbols(mcp, query, { country = 'thailand', limit = 25 } = {}) {
  const tool = COUNTRY_TOOL[country] ?? 'stock_screener';
  const args = tool === 'egx_stock_screener'
    ? { limit }
    : { country, stock_type: 'common', limit: Math.max(limit, 50), compact: false };

  const res = await mcp.callTool(tool, args);
  const rows = Array.isArray(res) ? res : (res?.rows ?? []);

  const q = String(query ?? '').trim().toUpperCase();
  const matches = rows
    .map((r) => ({
      symbol: normalizeSymbol(r.ticker ?? `${r.exchange}:${r.symbol}`),
      display: r.symbol,
      name: r.description ?? '',
      exchange: r.exchange ?? COUNTRY_TO_EXCHANGE[country] ?? null,
      price: r.price ?? null,
      changePercent: r.change_percent ?? null,
      currency: r.currency ?? null,
    }))
    .filter((r) => r.symbol)
    .filter((r) => !q || r.display.includes(q) || r.name.toUpperCase().includes(q));

  return {
    country,
    exchange: COUNTRY_TO_EXCHANGE[country] ?? null,
    total: res?.total_matches ?? rows.length,
    results: matches.slice(0, limit),
  };
}

export function availableCountries() {
  return Object.keys(COUNTRY_TO_EXCHANGE);
}

export function clearCaches() {
  intradayCache.clear();
  dailyCache.clear();
}