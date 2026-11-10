import { readFile } from 'node:fs/promises';

const SEED = new URL('../data/set-fundamentals.json', import.meta.url);
const PAGE = 'https://www.set.or.th/th/market/product/stock/quote/PTT/price';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/152.0.0.0 Safari/537.36';
const cache = new Map();
const inflight = new Map();
let seedTask;
let cookieTask;
let retryAfter = 0;

const number = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
const latest = (rows, key) => Array.isArray(rows)
  ? [...rows].filter(row => row?.[key]).sort((a,b) => String(a[key]).localeCompare(String(b[key]))).at(-1)
  : null;

/** SET-published values, without price rebasing or substitution from another provider. */
export function parseSetFundamentals(symbol, tradingRows, financialRows) {
  const trading = latest(tradingRows, 'date');
  const financial = latest(financialRows, 'asOfDate');
  if (!trading || !financial) throw new Error(`Incomplete SET response for ${symbol}`);
  const row = { symbol, source: 'set.or.th', asOf: trading.date.slice(0,10),
    financialAsOf: financial.asOfDate.slice(0,10), price: number(trading.close),
    sector: trading.sector ?? null, accountFormId: String(financial.accountFormId ?? ''), fetchedAt: new Date().toISOString(),
    annualYears: financialRows.filter(r => r.quarter === 'Q9' && Number.isFinite(r.year))
      .map(r => ({ fiscalYear: r.year, asOf: r.asOfDate.slice(0,10), source: 'set.or.th',
        roe: number(r.roe) == null ? null : r.roe / 100,
        roa: number(r.roa) == null ? null : r.roa / 100,
        npm: number(r.netProfitMargin) == null ? null : r.netProfitMargin / 100,
        de: number(r.deRatio) })).sort((a,b) => a.fiscalYear - b.fiscalYear) };
  const fields = { pe: [trading.pe, 'ratio'], pbv: [trading.pbv, 'ratio'],
    dividendYield: [trading.dividendYield, 'percent'], de: [financial.deRatio, 'ratio'],
    roe: [financial.roe, 'percent'], roa: [financial.roa, 'percent'],
    currentRatio: [financial.currentRatio, 'ratio'], quickRatio: [financial.quickRatio, 'ratio'] };
  for (const [key, [value, kind]] of Object.entries(fields)) row[key] = { value: number(value), kind };
  return row;
}

async function seed() {
  seedTask ??= readFile(SEED, 'utf8').then(JSON.parse).then(data => {
    for (const row of data.rows ?? []) cache.set(row.symbol, { row, expires: 0 });
  }).catch(() => {});
  await seedTask;
}
async function json(url, headers) {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(12000) });
  if (!response.ok) throw new Error(`SET responded ${response.status}`);
  return response.json();
}
async function fetchRow(symbol) {
  if (inflight.has(symbol)) return inflight.get(symbol);
  const task = (async () => {
    if (Date.now() < retryAfter) throw new Error('SET refresh temporarily unavailable');
    cookieTask ??= fetch(PAGE, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(12000) })
      .then(response => {
        if (!response.ok) throw new Error(`SET responded ${response.status}`);
        return response.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
      }).catch(error => { cookieTask = null; throw error; });
    const cookie = await cookieTask;
    const headers = { 'User-Agent': UA, Cookie: cookie, Referer: PAGE, Accept: 'application/json' };
    const base = `https://www.set.or.th/api/set/stock/${encodeURIComponent(symbol.slice(4))}/company-highlight/`;
    const trading = await json(`${base}trading-stat?lang=en`, headers);
    const financial = await json(`${base}financial-data?lang=en`, headers);
    const row = parseSetFundamentals(symbol, trading, financial);
    cache.set(symbol, { row, expires: Date.now() + 30 * 60 * 1000 });
    return row;
  })().catch(error => {
    retryAfter = Date.now() + 120000;
    cookieTask = null;
    throw error;
  }).finally(() => inflight.delete(symbol));
  inflight.set(symbol, task);
  return task;
}

export async function getSetFundamentals(symbols, { refresh = false } = {}) {
  await seed();
  const result = { data: {}, cached: [], fetched: [], missing: [], stale: [], source: 'set.or.th' };
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(2, symbols.length) }, async () => {
    while (next < symbols.length) {
      const symbol = symbols[next++];
      const hit = cache.get(symbol);
      if (!refresh && hit && Date.now() < hit.expires) {
        result.data[symbol] = hit.row; result.cached.push(symbol); continue;
      }
      try {
        result.data[symbol] = await fetchRow(symbol); result.fetched.push(symbol);
      } catch (error) {
        result.error = error.message;
        result.retryAfter = retryAfter;
        if (hit) {
          result.data[symbol] = { ...hit.row, stale: true }; result.stale.push(symbol);
        } else result.missing.push(symbol);
      }
    }
  }));
  return result;
}
