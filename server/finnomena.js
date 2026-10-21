/**
 * Long annual fundamentals, from Finnomena's public market-info API.
 *
 * Yahoo's statements reach back four fiscal years and the exchange's own
 * highlight endpoint the same, which is fine for a screen but not for a
 * ten-year profit chart. Finnomena republishes the same listed-company data
 * with a longer history, so it is used here for the annual charts only.
 *
 * The API is two steps: `/stock/list` maps a ticker to a `security_id`, then
 * `/stock/summary/{id}` returns every period. The annual row is the one whose
 * `quarter` is 9; the other quarters are the three-month figures and would
 * double-count if they were summed with it.
 *
 * Everything is best-effort. The list and each summary are cached for a day and
 * any failure — offline, blocked, a symbol Finnomena does not carry — resolves
 * to null, and the charts fall back to the four Yahoo years instead of
 * breaking the detail view.
 */
import { normalizeSymbol, bareSymbol } from './symbols.js';

const BASE = 'https://www.finnomena.com/market-info/api/public';
const LIST_URL = `${BASE}/stock/list?exchange=TH`;
const USER_AGENT = 'Mozilla/5.0 (compatible; multi-chart-trading-desk/1.0)';

const TIMEOUT_MS = 15_000;
const LIST_TTL_MS = 24 * 60 * 60 * 1000;
const SUMMARY_TTL_MS = 24 * 60 * 60 * 1000;

/** The number of fiscal years the annual charts show. */
export const HISTORY_YEARS = 10;

const num = (v) => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
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

let listState = { at: 0, map: null };
let listInFlight = null;
const summaryCache = new Map(); // security_id -> { at, rows }
const summaryInFlight = new Map();

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
      // Finnomena reports margins as a percentage and leverage as a ratio;
      // the screen's own years carry both as fractions, so convert to match.
      npm: num(row.npm) == null ? null : num(row.npm) / 100,
      de: num(row.debt_to_equity),
    });
  }
  return [...byYear.values()].sort((a, b) => a.fiscalYear - b.fiscalYear);
}

/**
 * The last `HISTORY_YEARS` fiscal years for one symbol, or null.
 *
 * Returns null rather than throwing so a caller can fall back without a
 * try/catch at every call site.
 */
export async function annualHistory(tvSymbol) {
  const bare = bareSymbol(normalizeSymbol(tvSymbol));
  if (!bare) return null;
  try {
    const map = await symbolMap();
    const id = map.get(bare);
    if (!id) return null;
    const rows = await summaryRows(id);
    const years = aggregateAnnual(rows);
    if (years.length === 0) return null;
    return years.slice(-HISTORY_YEARS);
  } catch {
    return null;
  }
}

export function clearFinnomenaCache() {
  listState = { at: 0, map: null };
  summaryCache.clear();
  summaryInFlight.clear();
}
