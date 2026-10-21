/**
 * Long annual fundamentals, from Finnomena's public market-info API.
 *
 * Yahoo's statements reach back four fiscal years and the exchange's own
 * highlight endpoint the same, which is fine for a screen but not for a
 * ten-year profit chart. Finnomena republishes the same listed-company data
 * with a longer history, so it is used here for the annual charts only.
 *
 * The API is two steps: `/stock/list` maps a ticker to a `security_id`, then
 * `/stock/summary/{id}` returns every period. The periods come with a quarter
 * number: 1 to 4 are the three months, and 9 is the fiscal year as a whole —
 * the two must not be mixed, or the year double-counts.
 *
 * Two ways in, and the tracked file comes first. The container's own address
 * is refused by the upstream's bot filter more often than not, so the same
 * history is kept in `data/annual-history.json` and read from disk; the live
 * call then only covers the symbols that file does not have. Rebuild the file
 * with `scripts/refresh-annual-history.mjs`.
 *
 * Everything is best-effort. Any failure — offline, blocked, a symbol
 * Finnomena does not carry — resolves to null, and the charts fall back to the
 * four Yahoo years instead of breaking the detail view.
 */
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeSymbol, bareSymbol } from './symbols.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_DATA = resolve(HERE, '..', 'data');

/** Where the tracked history may live: an explicit path, the data dir, the repo. */
function datasetPaths() {
  return [
    process.env.ANNUAL_HISTORY_FILE ? resolve(process.env.ANNUAL_HISTORY_FILE) : null,
    process.env.DATA_DIR ? join(process.env.DATA_DIR, 'annual-history.json') : null,
    join(REPO_DATA, 'annual-history.json'),
  ].filter(Boolean);
}

const BASE = 'https://www.finnomena.com/market-info/api/public';
const LIST_URL = `${BASE}/stock/list?exchange=TH`;
const USER_AGENT = 'Mozilla/5.0 (compatible; multi-chart-trading-desk/1.0)';

const TIMEOUT_MS = 10_000;
const LIST_TTL_MS = 24 * 60 * 60 * 1000;
const SUMMARY_TTL_MS = 24 * 60 * 60 * 1000;

/** How long a failed live call keeps the app from trying again. */
const LIVE_BACKOFF_MS = 30 * 60 * 1000;

/** The number of fiscal years the annual charts show. */
export const HISTORY_YEARS = 10;

const num = (v) => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Finnomena reports a margin as a percentage; the screen carries fractions. */
const fraction = (v) => {
  const n = num(v);
  return n == null ? null : n / 100;
};

async function getJson(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`Finnomena responded ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/* ── the tracked file ─────────────────────────────────────────────────────── */

let dataset = null;
let datasetPath = null;
let datasetInFlight = null;

/** `years` rows are [fiscalYear, netIncome, revenue, eps, npm, de]. */
function yearFromFile(row) {
  return {
    fiscalYear: num(row?.[0]),
    netIncome: num(row?.[1]),
    revenue: num(row?.[2]),
    eps: num(row?.[3]),
    npm: num(row?.[4]),
    de: num(row?.[5]),
  };
}

/** `quarters` rows are [fiscalYear, quarter, netIncome, revenue, eps, npm, de]. */
function quarterFromFile(row) {
  return {
    fiscalYear: num(row?.[0]),
    quarter: num(row?.[1]),
    netIncome: num(row?.[2]),
    revenue: num(row?.[3]),
    eps: num(row?.[4]),
    npm: num(row?.[5]),
    de: num(row?.[6]),
  };
}

async function loadDataset() {
  if (dataset) return dataset;
  if (datasetInFlight) return datasetInFlight;
  datasetInFlight = (async () => {
    for (const path of datasetPaths()) {
      try {
        const raw = JSON.parse(await readFile(path, 'utf8'));
        const map = new Map();
        for (const [symbol, entry] of Object.entries(raw?.symbols ?? {})) {
          const years = (entry?.years ?? [])
            .map(yearFromFile)
            .filter((r) => Number.isFinite(r.fiscalYear));
          const quarters = (entry?.quarters ?? [])
            .map(quarterFromFile)
            .filter((r) => Number.isFinite(r.fiscalYear) && Number.isFinite(r.quarter));
          if (years.length || quarters.length) {
            map.set(String(symbol).toUpperCase(), { years, quarters });
          }
        }
        dataset = map;
        datasetPath = path;
        return dataset;
      } catch {
        // Try the next candidate.
      }
    }
    dataset = new Map();
    return dataset;
  })().finally(() => { datasetInFlight = null; });
  return datasetInFlight;
}

/* ── the live API ─────────────────────────────────────────────────────────── */

let listState = { at: 0, map: null };
let listInFlight = null;
const summaryCache = new Map(); // security_id -> { at, rows }
const summaryInFlight = new Map();

const live = { ok: null, error: null, blockedUntil: 0, attempts: 0, symbols: 0 };

async function symbolMap() {
  if (listState.map && Date.now() - listState.at < LIST_TTL_MS) return listState.map;
  if (listInFlight) return listInFlight;
  listInFlight = (async () => {
    try {
      const payload = await getJson(LIST_URL);
      const items = Array.isArray(payload) ? payload : payload?.data;
      const map = new Map();
      for (const item of items ?? []) {
        const sym = String(item?.name ?? '').trim().toUpperCase();
        if (sym && item?.security_id) map.set(sym, item.security_id);
      }
      if (map.size < 100) throw new Error(`only ${map.size} tickers returned`);
      listState = { at: Date.now(), map };
      live.ok = true;
      live.error = null;
      return map;
    } finally {
      listInFlight = null;
    }
  })();
  return listInFlight;
}

async function summaryRows(securityId) {
  const hit = summaryCache.get(securityId);
  if (hit && Date.now() - hit.at < SUMMARY_TTL_MS) return hit.rows;
  const pending = summaryInFlight.get(securityId);
  if (pending) return pending;
  const p = (async () => {
    try {
      const payload = await getJson(`${BASE}/stock/summary/${securityId}`);
      const rows = (Array.isArray(payload) ? payload : payload?.data) ?? [];
      summaryCache.set(securityId, { at: Date.now(), rows });
      return rows;
    } finally {
      summaryInFlight.delete(securityId);
    }
  })();
  summaryInFlight.set(securityId, p);
  return p;
}

/**
 * Fold the period rows into one record per fiscal year.
 *
 * Kept separate from the network so it can be tested directly, and so a
 * truncated or reordered payload is handled in one place.
 */
export function aggregateAnnual(rows) {
  const byYear = new Map();
  for (const row of rows ?? []) {
    if (row?.quarter !== 9) continue; // 9 = the full fiscal year
    const fiscalYear = Number(row.fiscal);
    if (!Number.isFinite(fiscalYear)) continue;
    byYear.set(fiscalYear, {
      fiscalYear,
      asOf: row.end_of_year_date ? String(row.end_of_year_date).slice(0, 10) : null,
      netIncome: num(row.net_profit),
      revenue: num(row.revenue),
      eps: num(row.earning_per_share),
      npm: fraction(row.npm),
      de: num(row.debt_to_equity),
    });
  }
  return [...byYear.values()].sort((a, b) => a.fiscalYear - b.fiscalYear);
}

/**
 * The same rows, kept per quarter.
 *
 * A year can be missing a quarter — a company that reports late, or a feed
 * that skipped one — and the chart then draws the three it has rather than
 * pretending the year had four.
 */
export function aggregateQuarterly(rows) {
  const byYear = new Map();
  for (const row of rows ?? []) {
    const quarter = Number(row?.quarter);
    if (!Number.isFinite(quarter) || quarter < 1 || quarter > 4) continue;
    const fiscalYear = Number(row.fiscal);
    if (!Number.isFinite(fiscalYear)) continue;
    const list = byYear.get(fiscalYear) ?? [];
    list.push({
      fiscalYear,
      quarter,
      netIncome: num(row.net_profit),
      revenue: num(row.revenue),
      eps: num(row.earning_per_share),
      npm: fraction(row.npm),
      de: num(row.debt_to_equity),
    });
    byYear.set(fiscalYear, list);
  }
  return [...byYear.entries()]
    .sort(([a], [b]) => a - b)
    .map(([fiscalYear, list]) => ({
      fiscalYear,
      quarters: list.sort((a, b) => a.quarter - b.quarter),
    }));
}

/* ── the answer ───────────────────────────────────────────────────────────── */

/** Group flat quarter rows into one group per fiscal year. */
function groupQuarters(rows) {
  const byYear = new Map();
  for (const row of rows ?? []) {
    const list = byYear.get(row.fiscalYear) ?? [];
    list.push(row);
    byYear.set(row.fiscalYear, list);
  }
  return [...byYear.entries()]
    .sort(([a], [b]) => a - b)
    .map(([fiscalYear, quarters]) => ({
      fiscalYear,
      quarters: quarters.sort((a, b) => a.quarter - b.quarter),
    }));
}

/**
 * Ask the upstream for one symbol, ignoring the tracked file.
 *
 * The refresh script needs this: rebuilding the file must not read the file.
 */
export async function liveAnnualHistory(tvSymbol) {
  const bare = bareSymbol(normalizeSymbol(tvSymbol));
  if (!bare) return null;
  if (live.blockedUntil > Date.now()) return null;
  live.attempts += 1;
  try {
    const map = await symbolMap();
    const id = map.get(bare);
    if (!id) return null;
    const rows = await summaryRows(id);
    const years = aggregateAnnual(rows).slice(-HISTORY_YEARS);
    const quarters = aggregateQuarterly(rows).slice(-HISTORY_YEARS);
    if (years.length === 0 && quarters.length === 0) return null;
    live.symbols += 1;
    return { years, quarters };
  } catch (err) {
    live.ok = false;
    live.error = String(err?.message ?? err).slice(0, 160);
    live.blockedUntil = Date.now() + LIVE_BACKOFF_MS;
    return null;
  }
}

/**
 * The last `HISTORY_YEARS` fiscal years for one symbol, or null.
 *
 * Returns the years and their quarters, because a chart that stacks the
 * quarters needs both. Returns null rather than throwing so a caller can fall
 * back without a try/catch at every call site.
 */
export async function annualHistory(tvSymbol) {
  const bare = bareSymbol(normalizeSymbol(tvSymbol));
  if (!bare) return null;

  // The tracked file answers first: it is local, it always works, and it is
  // what the deploy boots from.
  const file = await loadDataset().catch(() => null);
  const fromFile = file?.get(bare);
  if (fromFile && (fromFile.years.length || fromFile.quarters.length)) {
    const years = fromFile.years.slice(-HISTORY_YEARS);
    const keep = new Set(years.map((r) => r.fiscalYear));
    return {
      years,
      quarters: groupQuarters(fromFile.quarters.filter((q) => keep.has(q.fiscalYear))),
    };
  }

  // Not in the file: ask the upstream, unless it has just refused.
  return liveAnnualHistory(bare);
}

/** What the health endpoint reports about the annual history. */
export function finnomenaStatus() {
  return {
    dataset: {
      path: datasetPath,
      symbols: dataset?.size ?? 0,
      loaded: dataset != null,
      searched: datasetPaths(),
    },
    live: {
      ok: live.ok,
      error: live.error,
      attempts: live.attempts,
      symbols: live.symbols,
      blockedUntil: live.blockedUntil ? new Date(live.blockedUntil).toISOString() : null,
    },
  };
}

/**
 * Read the tracked file at startup.
 *
 * The file is small and local, and reading it once means the health endpoint
 * can say whether the deploy really has the history rather than reporting
 * "not loaded" until somebody opens a stock.
 */
export async function initAnnualHistory() {
  await loadDataset().catch(() => null);
  return dataset?.size ?? 0;
}

export function clearFinnomenaCache() {
  listState = { at: 0, map: null };
  summaryCache.clear();
  summaryInFlight.clear();
  dataset = null;
  datasetPath = null;
  live.ok = null;
  live.error = null;
  live.blockedUntil = 0;
  live.attempts = 0;
  live.symbols = 0;
}
