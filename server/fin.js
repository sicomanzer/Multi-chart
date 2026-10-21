/**
 * Per-symbol financial statements for the screener.
 *
 * The fundamentals sidecar (`fundamentals.py`) deliberately only exposes
 * scale-free *current* ratios: the TradingView scanner mangles absolute
 * currency columns, so it cannot tell us last year's net income. A quality
 * screen needs exactly that — "has ROE held above 15% for five years" is not a
 * question a snapshot can answer.
 *
 * So this module reads Yahoo's fundamentals-timeseries endpoint, which serves
 * four fiscal years of real statements per symbol:
 *
 *   /ws/fundamentals-timeseries/v1/finance/timeseries/PTT.BK?type=annualNetIncome,…
 *
 * Four years is what the endpoint gives a free client, consistently across SET
 * names. That covers the "3-5 consecutive years" rules; it is not enough for a
 * ten-year P/E band, and `bands()` in the screener says so rather than
 * pretending otherwise.
 *
 * Dividends come from the chart endpoint instead (`events=div`), which carries
 * ten to fifteen years of ex-dates and amounts — so the dividend track record
 * *is* long enough, and a suspension (MINT paid nothing from 2020 to 2022) is
 * visible instead of averaged away.
 */
import { toYahooSymbol, normalizeSymbol, bareSymbol } from './symbols.js';

const TIMESERIES = 'https://query1.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries';
const CHART = 'https://query1.finance.yahoo.com/v8/finance/chart';
const USER_AGENT = 'Mozilla/5.0 (compatible; multi-chart-trading-desk/1.0)';

/** Annual statement lines we ask for. Missing ones come back absent, not null. */
const ANNUAL_TYPES = [
  'annualTotalRevenue',
  'annualNetIncome',
  'annualStockholdersEquity',
  'annualTotalAssets',
  'annualTotalDebt',
  'annualEBIT',
  'annualInterestExpense',
  'annualOperatingCashFlow',
  'annualFreeCashFlow',
  'annualDilutedEPS',
  'annualBasicEPS',
  'annualOrdinarySharesNumber',
  'annualCashDividendsPaid',
];

/**
 * Current-period figures the screen needs but the annual rows cannot give.
 *
 * The trailing EPS is what the market actually prices — a P/E built from the
 * last fiscal year is stale by up to twelve months, and for a cyclical it is
 * simply the wrong number. The quarterly balance sheet does the same job for
 * book value: a company that pays a large special dividend halves its equity
 * in the middle of the year, and a P/BV taken from the old annual figure is
 * then out by a factor of two.
 */
const CURRENT_TYPES = [
  'trailingDilutedEPS',
  'trailingBasicEPS',
  'quarterlyStockholdersEquity',
  'quarterlyOrdinarySharesNumber',
];

/**
 * How long after a fiscal year end the numbers are treated as public.
 *
 * Yahoo dates a statement by the period it covers, not by the day it was
 * filed. Using that date as the "known at" date would let the band chart use
 * FY2024 earnings on 1 January 2025 — six weeks before anyone could read them.
 * Thai listed companies file within three months; two is the common case for
 * large caps, so this errs late rather than early.
 */
const FILING_LAG_DAYS = 60;

/** Statements barely move, so a long TTL costs nothing and saves a lot upstream. */
const STATEMENT_TTL_MS = 12 * 60 * 60 * 1000;

const statements = new Map();
const inflight = new Map();

function cached(map, key, ttlMs, producer) {
  const hit = map.get(key);
  if (hit && Date.now() < hit.expires) return Promise.resolve(hit.value);
  const pending = inflight.get(key);
  if (pending) return pending;
  const p = producer()
    .then((value) => {
      map.set(key, { value, expires: Date.now() + ttlMs });
      return value;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

async function getJson(url, { timeoutMs = 20_000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    });
    if (res.status === 404) {
      const err = new Error('no data');
      err.code = 'NO_DATA';
      throw err;
    }
    if (!res.ok) {
      const err = new Error(`Yahoo responded ${res.status}`);
      err.code = 'UPSTREAM_HTTP';
      throw err;
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Yahoo returns one result object per requested type, each holding its own
 * sparse array of `{ asOfDate, reportedValue: { raw } }`. Flatten that into
 * `{ '2024-12-31': { netIncome: 90072026202, … } }`.
 *
 * Only annual types are folded in: a trailing or quarterly point carries a
 * quarter-end date, and letting one through would invent a fiscal year that
 * never existed.
 */
function parseTimeseries(payload) {
  const byDate = {};
  for (const result of payload?.timeseries?.result ?? []) {
    const type = result?.meta?.type?.[0];
    if (!type || !type.startsWith('annual')) continue;
    const key = type.replace(/^annual/, '');
    const field = key.charAt(0).toLowerCase() + key.slice(1);
    for (const point of result[type] ?? []) {
      if (!point?.asOfDate) continue;
      const raw = point.reportedValue?.raw;
      if (typeof raw !== 'number' || !Number.isFinite(raw)) continue;
      (byDate[point.asOfDate] ??= {})[field] = raw;
    }
  }
  return byDate;
}

/** Latest value of one non-annual series, or null when Yahoo has none. */
function latestPoint(payload, type) {
  const result = (payload?.timeseries?.result ?? []).find((r) => r?.meta?.type?.[0] === type);
  const points = (result?.[type] ?? []).filter((p) => typeof p?.reportedValue?.raw === 'number');
  const last = points.at(-1);
  return last ? { value: last.reportedValue.raw, asOf: last.asOfDate } : null;
}

/** Dividend events keyed by ex-date timestamp. */
function parseDividends(chartResult) {
  const events = chartResult?.events?.dividends ?? {};
  return Object.values(events)
    .filter((d) => typeof d?.amount === 'number' && Number.isFinite(d.amount))
    .map((d) => ({ date: new Date(d.date * 1000), amount: d.amount }))
    .sort((a, b) => a.date - b.date);
}

function parsePriceSeries(chartResult) {
  const stamps = chartResult?.timestamp ?? [];
  const closes = chartResult?.indicators?.quote?.[0]?.close ?? [];
  const out = [];
  for (let i = 0; i < stamps.length; i += 1) {
    const close = closes[i];
    if (typeof close !== 'number' || !Number.isFinite(close)) continue;
    out.push({ date: new Date(stamps[i] * 1000).toISOString().slice(0, 10), close });
  }
  return out;
}

/**
 * Dividends per fiscal year.
 *
 * Yahoo's ex-dates land in the calendar year the cash arrived, not the fiscal
 * year the profit came from, so DPS is grouped by calendar year. That is close
 * enough for a payout ratio and is what the "paid every year since" test wants.
 */
function dpsByYear(dividends) {
  const out = {};
  for (const d of dividends) {
    const y = d.date.getUTCFullYear();
    out[y] = (out[y] ?? 0) + d.amount;
  }
  return out;
}

function ratio(numerator, denominator) {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) return null;
  return numerator / denominator;
}

/**
 * Turn raw fiscal-year rows into the ratios the screen reasons about.
 *
 * Absolute amounts stay in the object because the deep-dive view needs them,
 * but every *published* number the screen compares is a ratio or a growth rate
 * — the same discipline the fundamentals sidecar follows, and for the same
 * reason: it keeps the screen honest about units.
 *
 * Exported because it is the one pure step between Yahoo's raw rows and every
 * number the screen publishes, which makes it the right place to pin down the
 * per-share definitions in the verification script.
 */
export function deriveYears(byDate, dividends) {
  const dps = dpsByYear(dividends);
  const years = Object.entries(byDate)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, row]) => {
      const fiscalYear = Number(date.slice(0, 4));
      const { cashDividendsPaid } = row;
      // `cashDividendsPaid` is reported as a negative cash outflow.
      const dividendsPaid = typeof cashDividendsPaid === 'number'
        ? Math.abs(cashDividendsPaid)
        : null;
      return {
        fiscalYear,
        asOf: date,
        // The first day these numbers could have been on a screen.
        knownFrom: new Date(Date.parse(`${date}T00:00:00Z`) + FILING_LAG_DAYS * 86_400_000)
          .toISOString()
          .slice(0, 10),
        revenue: row.totalRevenue ?? null,
        netIncome: row.netIncome ?? null,
        equity: row.stockholdersEquity ?? null,
        assets: row.totalAssets ?? null,
        totalDebt: row.totalDebt ?? null,
        ebit: row.eBIT ?? row.ebit ?? null,
        interestExpense: typeof row.interestExpense === 'number'
          ? Math.abs(row.interestExpense)
          : null,
        operatingCashFlow: row.operatingCashFlow ?? null,
        freeCashFlow: row.freeCashFlow ?? null,
        eps: row.dilutedEPS ?? row.basicEPS ?? null,
        shares: row.ordinarySharesNumber ?? null,
        dividendsPaid,
        // Calendar-year cash actually received, which is what a holder earns.
        dpsPaid: dps[fiscalYear] ?? null,
      };
    });

  for (const y of years) {
    y.roe = ratio(y.netIncome, y.equity);
    y.roa = ratio(y.netIncome, y.assets);
    y.npm = ratio(y.netIncome, y.revenue);
    y.de = ratio(y.totalDebt, y.equity);
    y.interestCoverage = y.interestExpense ? ratio(y.ebit, y.interestExpense) : null;
    y.payoutRatio = y.dividendsPaid != null && y.netIncome
      ? ratio(y.dividendsPaid, y.netIncome)
      : null;
    y.bvps = ratio(y.equity, y.shares);
    y.cfoToNetIncome = ratio(y.operatingCashFlow, y.netIncome);
    // Cash actually distributed per share, straight from the cash-flow
    // statement. Unlike the ex-date record this cannot be inflated by a special
    // dividend that has not yet been reported in an annual statement.
    y.dpsStatement = ratio(y.dividendsPaid, y.shares);
    // What a holder was actually paid for that year.
    //
    // `dpsStatement` counts every dividend leaving the group, including the
    // share that went to minority owners of subsidiaries — PTT reads 2.94
    // against 2.20 received, CPF 2.83 against 1.55. The ex-date record is the
    // only line that is true by construction: it is what the exchange paid per
    // share. The statement is used only when there is no ex-date record at all.
    // (Taking the lower of the two looked safer but is not: BANPU reads 0.02
    // against 0.55 received, because its cash-flow line is the one that is
    // incomplete.)
    y.dps = y.dpsPaid ?? y.dpsStatement;
  }
  return years;
}

/** Load one symbol's statements, dividend record and daily closes. */
export async function loadFinancials(tvSymbol) {
  const symbol = normalizeSymbol(tvSymbol);
  if (!symbol) {
    const err = new Error('symbol required');
    err.status = 400;
    throw err;
  }
  const yahoo = toYahooSymbol(symbol);

  return cached(statements, symbol, STATEMENT_TTL_MS, async () => {
    const now = Math.floor(Date.now() / 1000);
    // 2000-01-01 onward: the endpoint returns every year it has either way,
    // and asking from the epoch just makes older listings complete.
    const from = 946_684_800;

    const [timeSeries, chart] = await Promise.all([
      getJson(
        `${TIMESERIES}/${encodeURIComponent(yahoo)}?symbol=${encodeURIComponent(yahoo)}` +
        `&type=${[...ANNUAL_TYPES, ...CURRENT_TYPES].join(',')}&period1=${from}&period2=${now}`,
      ),
      getJson(
        `${CHART}/${encodeURIComponent(yahoo)}?range=15y&interval=1d&events=div`,
      ).catch(() => null), // prices are optional; statements alone still screen
    ]);

    const chartResult = chart?.chart?.result?.[0] ?? null;
    const dividends = parseDividends(chartResult);
    const years = deriveYears(parseTimeseries(timeSeries), dividends);
    const closes = parsePriceSeries(chartResult);
    const lastClose = closes.length ? closes[closes.length - 1].close : null;

    // Trailing EPS is the market's denominator; the quarterly balance sheet is
    // the book value a buyer is actually paying a multiple of today.
    const trailingEps = latestPoint(timeSeries, 'trailingDilutedEPS')
      ?? latestPoint(timeSeries, 'trailingBasicEPS');
    const quarterEquity = latestPoint(timeSeries, 'quarterlyStockholdersEquity');
    const quarterShares = latestPoint(timeSeries, 'quarterlyOrdinarySharesNumber');
    const quarterBvps = quarterEquity && quarterShares && quarterShares.value > 0
      ? quarterEquity.value / quarterShares.value
      : null;

    if (years.length === 0 && !lastClose) {
      const err = new Error(`no financial data for ${yahoo}`);
      err.code = 'NO_DATA';
      err.status = 404;
      throw err;
    }

    return {
      symbol,
      yahoo,
      bare: bareSymbol(symbol),
      name: chartResult?.meta?.longName ?? chartResult?.meta?.shortName ?? null,
      currency: chartResult?.meta?.currency ?? 'THB',
      price: lastClose,
      priceDate: closes.length ? closes[closes.length - 1].date : null,
      closes,
      dividends: dividends.map((d) => ({
        date: d.date.toISOString().slice(0, 10),
        amount: d.amount,
      })),
      years,
      ttm: {
        eps: trailingEps?.value ?? null,
        epsAsOf: trailingEps?.asOf ?? null,
        bvps: quarterBvps,
        bvpsAsOf: quarterEquity?.asOf ?? null,
      },
    };
  });
}

export function clearFinancialCache() {
  statements.clear();
  inflight.clear();
}

export function financialCacheStats() {
  return { symbols: statements.size, inflight: inflight.size };
}
