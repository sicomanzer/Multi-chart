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
import { profile } from './quotes.js';
// The test a gross margin has to pass before it is one. It lives with the long
// history because that is where the rule was written — the short reading
// omits the cost-of-sales line for the same names it leaves out.
import { grossMargin } from './finnomena.js';

const TIMESERIES = 'https://query1.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries';
const CHART = 'https://query1.finance.yahoo.com/v8/finance/chart';
const USER_AGENT = 'Mozilla/5.0 (compatible; multi-chart-trading-desk/1.0)';

/** Annual statement lines we ask for. Missing ones come back absent, not null. */
const ANNUAL_TYPES = [
  'annualTotalRevenue',
  'annualGrossProfit',
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
  // Quarterly income lines used to build a true trailing-twelve-months EPS
  // from the last four discrete quarters. Yahoo's own trailing figure is
  // occasionally stale or computed on a different basis, and the quarterly
  // sum is the number the exchange's P/E is closest to.
  'quarterlyNetIncome',
  'quarterlyNetIncomeCommonStockholders',
];

/**
 * How long after a fiscal year end the numbers are treated as public.
 *
 * Yahoo dates a statement by the period it covers, not by the day it was
 * filed. Using that date as the "known at" date would let the band chart use
 * FY2024 earnings on 1 January 2025 — three months before anyone could read
 * them. Thai listed companies must file within three months of the year end,
 * and the stragglers use all of it, so the lag is the deadline, not the median:
 * ninety days is the first date on which every issuer has published. A shorter
 * lag makes the band history quietly clairvoyant for the companies that file
 * late, which is precisely the bias the lag exists to remove.
 */
const FILING_LAG_DAYS = 90;

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

/** All points of a non-annual series, sorted by as-of date. */
function seriesPoints(payload, type) {
  const result = (payload?.timeseries?.result ?? []).find((r) => r?.meta?.type?.[0] === type);
  return (result?.[type] ?? [])
    .filter((p) => p?.asOfDate && typeof p?.reportedValue?.raw === 'number' && Number.isFinite(p.reportedValue.raw))
    .map((p) => ({ asOf: p.asOfDate, value: p.reportedValue.raw }))
    .sort((a, b) => a.asOf.localeCompare(b.asOf));
}

function daysBetween(a, b) {
  return Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000;
}

/**
 * Build a trailing-twelve-months EPS from the last four discrete quarterly
 * net-income points, divided by the latest quarterly share count.
 *
 * Returns null when the series is incomplete, gappy or stale, so the caller
 * can fall back to Yahoo's own trailing figure. `basis` is 'attributable'
 * when the attributable (common-stockholders) line was used and 'total'
 * when only the total net-income line was available.
 */
function ttmEpsFromQuarters(payload) {
  const candidates = [
    { series: seriesPoints(payload, 'quarterlyNetIncomeCommonStockholders'), basis: 'attributable' },
    { series: seriesPoints(payload, 'quarterlyNetIncome'), basis: 'total' },
  ];
  for (const { series, basis } of candidates) {
    if (series.length < 4) continue;
    // Find the last run of four consecutive quarters (no gaps).
    let last4 = null;
    for (let i = series.length - 1; i >= 3; i -= 1) {
      const a = series[i - 3], b = series[i - 2], c = series[i - 1], d = series[i];
      const gaps = [daysBetween(b.asOf, a.asOf), daysBetween(c.asOf, b.asOf), daysBetween(d.asOf, c.asOf)];
      if (gaps.every((g) => g >= 75 && g <= 105)) { last4 = [a, b, c, d]; break; }
    }
    if (!last4) continue;
    // Freshness: the last quarter must be recent.
    if (Date.now() - Date.parse(`${last4[3].asOf}T00:00:00Z`) > 200 * 86_400_000) continue;
    const sum = last4.reduce((s, p) => s + p.value, 0);
    // Latest quarterly share count, falling back to the annual line.
    let shares = null;
    const sharePoints = seriesPoints(payload, 'quarterlyOrdinarySharesNumber');
    if (sharePoints.length) {
      const lp = sharePoints[sharePoints.length - 1];
      if (Date.now() - Date.parse(`${lp.asOf}T00:00:00Z`) < 400 * 86_400_000) shares = lp.value;
    }
    if (!shares) {
      const annualShares = seriesPoints(payload, 'annualOrdinarySharesNumber');
      if (annualShares.length) shares = annualShares[annualShares.length - 1].value;
    }
    if (!Number.isFinite(shares) || shares <= 0) continue;
    return { eps: sum / shares, asOf: last4[3].asOf, basis };
  }
  return null;
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
 * `fx` converts statement amounts into the trading currency. It is 1 for the
 * baht reporters that make up all but a couple of the SET100; for a company
 * that files in dollars it is the dollar rate, so that a baht price and a
 * dollar EPS never meet in the same multiple.
 *
 * Exported because it is the one pure step between Yahoo's raw rows and every
 * number the screen publishes, which makes it the right place to pin down the
 * per-share definitions in the verification script.
 */
export function deriveYears(byDate, dividends, { fx = 1 } = {}) {
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
      const money = (v) => (typeof v === 'number' && Number.isFinite(v) ? v * fx : null);
      return {
        fiscalYear,
        asOf: date,
        // The first day these numbers could have been on a screen.
        knownFrom: new Date(Date.parse(`${date}T00:00:00Z`) + FILING_LAG_DAYS * 86_400_000)
          .toISOString()
          .slice(0, 10),
        revenue: money(row.totalRevenue),
        grossProfit: money(row.grossProfit),
        netIncome: money(row.netIncome),
        equity: money(row.stockholdersEquity),
        assets: money(row.totalAssets),
        totalDebt: money(row.totalDebt),
        ebit: money(row.eBIT ?? row.ebit),
        interestExpense: typeof row.interestExpense === 'number'
          ? Math.abs(row.interestExpense) * fx
          : null,
        operatingCashFlow: money(row.operatingCashFlow),
        freeCashFlow: money(row.freeCashFlow),
        eps: money(row.dilutedEPS ?? row.basicEPS),
        shares: row.ordinarySharesNumber ?? null,
        dividendsPaid: money(dividendsPaid),
        // Calendar-year cash actually received, which is what a holder earns.
        // Paid in the trading currency, so it is never converted.
        dpsPaid: dps[fiscalYear] ?? null,
      };
    });

  for (let i = 0; i < years.length; i += 1) {
    const y = years[i];
    const prev = years[i - 1];
    // A ratio against the closing balance flatters a company that is shrinking
    // and punishes one that is growing, and it is not what the exchange
    // publishes either. The average of the opening and closing balance is the
    // standard denominator; the first year of a truncated history has no
    // opening balance, so it falls back to its own closing one.
    const average = (opening, closing) => (
      typeof opening === 'number' && Number.isFinite(opening) && typeof closing === 'number'
        ? (opening + closing) / 2
        : closing
    );
    y.roe = ratio(y.netIncome, average(prev?.equity, y.equity));
    y.roa = ratio(y.netIncome, average(prev?.assets, y.assets));
    y.npm = ratio(y.netIncome, y.revenue);
    // Gross margin, from the statement's own gross-profit line. This is the one
    // margin the short reading carries that the long one carries too, so the
    // chart can fill a year the long history is missing — held to the same test,
    // because a missing cost line reads as a margin of a hundred percent.
    y.gpm = grossMargin(y.grossProfit, y.revenue);
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

/**
 * The statement figures, converted to the currency the shares trade in, plus
 * the one judgement the statements cannot make on their own.
 *
 * Yahoo publishes statements in the reporting currency and prices in the
 * trading currency. For a company that files in dollars — BANPU in the SET100 —
 * a baht price over a dollar EPS is not a P/E, and the error is the exchange
 * rate, roughly 33x. The quote snapshot carries the same trailing EPS already
 * converted, so the ratio between the two is the conversion factor for the
 * whole history.
 *
 * A ratio far from one is only a *suspicion*: a stale trailing EPS produces the
 * same shape, and GULF's trailing point was a year old and read 3x below the
 * quote. The label settles it — the ratio is applied only when Yahoo also says
 * the reporting currency differs from the trading one. When in doubt nothing is
 * converted, because a wrong factor is worse than a missing one.
 */
/**
 * How far the price's unit and the earnings' unit are apart.
 *
 * A line quoted in pence against earnings in pounds is out by a hundred, and
 * the quote's own trailing multiple is the only figure that knows the units —
 * it is the price over the earnings as Yahoo pairs them. So when our multiple
 * and theirs disagree by a round factor, that is the unit gap.
 *
 * A disagreement that is *not* round is the difference between earnings
 * attributable to the owners and earnings in total, which is a fact about the
 * company and not a mistake, and it is left alone. Only a factor of a hundred
 * or a thousand is treated as a unit: a price and earnings in the same
 * currency cannot be that far apart.
 */
export function unitGap(price, eps, theirPe) {
  if (!(price > 0) || !(eps > 0) || !(theirPe > 0)) return 1;
  const gap = (price / eps) / theirPe;
  if (!Number.isFinite(gap) || gap <= 0) return 1;
  if (gap >= 60 && gap <= 160) return 100;
  if (gap >= 600 && gap <= 1600) return 1000;
  return 1;
}

async function convert(base, quote) {
  const statementEps = base.ttm.eps;
  const quoteEps = quote?.epsTtm ?? null;
  // Two corrections, and they are different in kind.
  //
  // `fx` is the exchange rate between the currency the statements are in and
  // the currency the line trades in. `unit` is the gap between that currency's
  // major unit and the unit the *price* is quoted in: Shell's London line is
  // priced in pence and its earnings are in pounds, so a multiple built from
  // one and the other is out by a hundred.
  let fx = 1;
  let unit = 1;
  if (
    quoteEps != null
    && statementEps != null
    && Math.abs(statementEps) > 1e-9
    && Number.isFinite(quoteEps / statementEps)
  ) {
    const ratio = quoteEps / statementEps;
    if (ratio > 2 || ratio < 0.5) {
      // A ratio far from one is only a suspicion: a stale trailing EPS produces
      // the same shape, and GULF's trailing point was a year old and read 3x
      // below the quote. The label settles it — the ratio is applied only when
      // Yahoo also says the reporting currency differs from the trading one.
      const p = await profile(base.yahoo);
      if (p?.financialCurrency && p.financialCurrency !== (quote.currency ?? base.currency ?? 'THB')) {
        fx = ratio;
      }
    } else {
      // The rate is close to one, so the currencies cannot be far apart — but
      // the price and the earnings can still be in different units. The
      // quote's own trailing multiple is the only figure that knows the
      // units: it is the price over the earnings as Yahoo pairs them. A
      // disagreement by a round factor is a unit gap; a disagreement that is
      // not round is the difference between earnings attributable to the
      // owners and earnings in total, which is a fact about the company.
      const theirPe = quote?.trailingPe;
      if (theirPe > 0 && base.price > 0) {
        const factor = unitGap(base.price, statementEps, theirPe);
        if (factor !== 1) {
          const p = await profile(base.yahoo);
          const trading = quote.currency ?? base.currency ?? null;
          if (p?.financialCurrency && trading && p.financialCurrency !== trading) {
            fx = ratio;
            unit = factor;
          }
        }
      }
    }
  }

  // Yahoo's quote carries a trailing EPS too, but it is not always the same
  // figure as its own quarterly series: GPSC's quote read 3.55 while the
  // series — and the exchange — said 2.40. Prefer the quarterly series when
  // it is current, and keep the quote for the cases it exists to solve: a
  // series that has gone stale (GULF's last point was a year old) and the
  // currency mismatch below.
  const fresh = base.ttm.eps != null
    && base.ttm.epsAsOf != null
    && Date.now() - Date.parse(base.ttm.epsAsOf) < 270 * 86_400_000;
  const eps = fresh ? base.ttm.eps : (quoteEps ?? base.ttm.eps);
  const scale = fx * unit;
  // The statement figure is in the reporting currency and needs both
  // corrections; the quote's figure is already in the currency the line trades
  // in, so it only needs the unit.
  const epsScaled = eps == null ? null : eps * (fresh ? scale : unit);

  if (scale === 1) {
    return {
      ...base,
      ttm: {
        ...base.ttm,
        eps: epsScaled,
        bvps: quote?.bookValue ?? base.ttm.bvps,
      },
      fx: 1,
    };
  }

  const years = base.years.map((y) => ({
    ...y,
    revenue: y.revenue == null ? null : y.revenue * scale,
    netIncome: y.netIncome == null ? null : y.netIncome * scale,
    equity: y.equity == null ? null : y.equity * scale,
    assets: y.assets == null ? null : y.assets * scale,
    totalDebt: y.totalDebt == null ? null : y.totalDebt * scale,
    ebit: y.ebit == null ? null : y.ebit * scale,
    interestExpense: y.interestExpense == null ? null : y.interestExpense * scale,
    operatingCashFlow: y.operatingCashFlow == null ? null : y.operatingCashFlow * scale,
    freeCashFlow: y.freeCashFlow == null ? null : y.freeCashFlow * scale,
    eps: y.eps == null ? null : y.eps * scale,
    dividendsPaid: y.dividendsPaid == null ? null : y.dividendsPaid * scale,
    dpsStatement: y.dpsStatement == null ? null : y.dpsStatement * scale,
    bvps: y.bvps == null ? null : y.bvps * scale,
  }));

  return {
    ...base,
    years,
    ttm: {
      ...base.ttm,
      eps: epsScaled,
      bvps: quote?.bookValue != null
        ? quote.bookValue * unit
        : (base.ttm.bvps == null ? null : base.ttm.bvps * scale),
    },
    fx: scale,
  };
}

/**
 * Whether the industrial rules apply at all.
 *
 * A bank funds itself with deposits and an insurer with reserves; "debt to
 * equity below 1.0", "cash flow from operations is positive" and "free cash
 * flow covers the dividend" are statements about a manufacturer, not about a
 * balance-sheet business. Yahoo supplies no EBIT for these names, which is the
 * first signal; the sector label decides, because a utility can also report no
 * EBIT and it still has to meet the industrial tests.
 */
async function isFinancial(base) {
  const last3 = base.years.slice(-3);
  if (last3.length === 0 || last3.some((y) => y.ebit != null)) return false;
  const p = await profile(base.yahoo);
  return /financial/i.test(p?.sector ?? '');
}

/** Load one symbol's statements, dividend record and daily closes. */
export async function loadFinancials(tvSymbol, { quote = null } = {}) {
  const symbol = normalizeSymbol(tvSymbol);
  if (!symbol) {
    const err = new Error('symbol required');
    err.status = 400;
    throw err;
  }
  const yahoo = toYahooSymbol(symbol);

  const base = await cached(statements, symbol, STATEMENT_TTL_MS, async () => {
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
    // A fiscal year with no revenue, no profit and no EPS is a partial record,
    // not a year of results — GULF's FY2025 row carries a balance sheet and
    // nothing else. Keeping it would make the latest year's leverage the one
    // number the score reads while every income rule looked at an older year.
    const years = deriveYears(parseTimeseries(timeSeries), dividends).filter(
      (y) => y.revenue != null || y.netIncome != null || y.eps != null,
    );
    const closes = parsePriceSeries(chartResult);
    const lastClose = closes.length ? closes[closes.length - 1].close : null;

    // Trailing EPS is the market's denominator; the quarterly balance sheet is
    // the book value a buyer is actually paying a multiple of today.
    const trailingEps = latestPoint(timeSeries, 'trailingDilutedEPS')
      ?? latestPoint(timeSeries, 'trailingBasicEPS');
    const quarterlyTtm = ttmEpsFromQuarters(timeSeries);
    // Guard: if the quarterly sum diverges wildly from the market's own
    // trailing EPS, something is off (a one-off gain sitting just outside the
    // window, a restatement, a missing quarter) and the market figure is the
    // safer denominator. Keep the quarterly figure only when it agrees with
    // the quote within 40%; otherwise fall back to the trailing/quote path.
    const quoteEpsForGuard = quote?.epsTtm ?? null;
    let chosenQuarterly = quarterlyTtm;
    if (chosenQuarterly && quoteEpsForGuard != null) {
      const rel = Math.abs(chosenQuarterly.eps - quoteEpsForGuard)
        / Math.max(Math.abs(quoteEpsForGuard), 1e-9);
      if (rel > 0.40) chosenQuarterly = null;
    }
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
        eps: chosenQuarterly?.eps ?? trailingEps?.value ?? null,
        epsAsOf: chosenQuarterly?.asOf ?? trailingEps?.asOf ?? null,
        epsBasis: chosenQuarterly?.basis ?? 'trailing',
        bvps: quarterBvps,
        bvpsAsOf: quarterEquity?.asOf ?? null,
      },
    };
  });

  const converted = await convert(base, quote);
  return { ...converted, isFinancial: await isFinancial(converted) };
}

export function clearFinancialCache() {
  statements.clear();
  inflight.clear();
}

export function financialCacheStats() {
  return { symbols: statements.size, inflight: inflight.size };
}
