/**
 * Runs the screen: fetch, score, value, rank.
 *
 * Kept separate from `screener.js` so the maths stays pure. This file is the
 * only place that knows about I/O, concurrency and failure — and its policy on
 * failure is to *report* it. A symbol that Yahoo has no statements for comes
 * back in `errors` with a reason instead of vanishing, because "this name was
 * skipped" and "this name scored 0" mean very different things to someone
 * deciding what to buy.
 */
import { loadFinancials } from './fin.js';
import {
  applyPreset,
  computeBands,
  ddm,
  marginOfSafety,
  presetById,
  scoreQuality,
  sustainableDividend,
} from './screener.js';
import { normalizeSymbol, toYahooSymbol, uniqueSymbols } from './symbols.js';
import { quoteBatch } from './quotes.js';

/** Yahoo tolerates a handful of parallel requests; more earns a 429. */
const CONCURRENCY = 5;

/**
 * Valuation defaults, overridable per request.
 *
 * Both growth rates are 5%: the flat assumption is the one a reader can defend
 * without knowing anything about the company, and using it everywhere means the
 * table, the presets and the calculator quote the same intrinsic value. The
 * model is still two-stage — the sliders can move either rate independently —
 * but the number on screen no longer depends on a growth estimate derived from
 * four years of EPS.
 */
export const DEFAULTS = {
  r: 0.09,
  g1: 0.05,
  g2: 0.05,
  years: 5,
};

async function mapLimit(items, limit, worker) {
  const out = new Array(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      out[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return out;
}

function clampInput(value, fallback, { min, max }) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

/**
 * The two multiples a buyer pays today.
 *
 * Trailing EPS is the market's denominator and the latest quarter's equity over
 * the latest share count is the book value; both fall back to the last fiscal
 * year only when the current figures are missing altogether. A *negative*
 * trailing figure is not a reason to fall back — it means the multiple does not
 * exist, and saying so is the whole point.
 */
export function currentMultiples(fin) {
  const last = fin.years.at(-1);
  const ttmEps = fin.ttm?.eps ?? null;
  const ttmBvps = fin.ttm?.bvps ?? null;
  const multiple = (price, perShare) => (price > 0 && perShare > 0 ? price / perShare : null);
  return {
    peCurrent: ttmEps != null ? multiple(fin.price, ttmEps) : multiple(fin.price, last?.eps),
    pbvCurrent: ttmBvps != null ? multiple(fin.price, ttmBvps) : multiple(fin.price, last?.bvps),
  };
}

/**
 * Build one row.
 *
 * `overrides` is what the deep-dive sliders send. When a caller changes the
 * discount rate, the row's margin of safety must change too — otherwise the
 * table and the calculator would disagree about the same company, which is
 * exactly the kind of mismatch that makes a screen untrustworthy.
 */
export function buildRow(fin, { overrides = {}, asOf = new Date() } = {}) {
  const ttmEps = fin.ttm?.eps ?? null;
  const quality = scoreQuality({
    years: fin.years,
    dividends: fin.dividends,
    price: fin.price,
    asOf,
    ttmEps,
    isFinancial: fin.isFinancial === true,
  });

  const dividend = sustainableDividend({ years: fin.years, dividends: fin.dividends, asOf, ttmEps });
  const d0 = dividend.d0;
  const g1 = clampInput(overrides.g1, DEFAULTS.g1, { min: 0, max: 0.30 });
  const r = clampInput(overrides.r, DEFAULTS.r, { min: 0.04, max: 0.25 });
  const g2 = clampInput(overrides.g2, DEFAULTS.g2, { min: 0, max: 0.20 });
  const years = clampInput(overrides.years, DEFAULTS.years, { min: 1, max: 15 });

  const valuation = ddm({ d0, g1, g2, r, years });
  const mos = valuation.ok ? marginOfSafety(valuation.intrinsic, fin.price) : null;

  // Today's multiples, on today's denominators.
  //
  // The band history has to be annual — that is the only series that exists for
  // every year — but the right-hand edge must not be. A P/E built from the last
  // fiscal year is stale by up to twelve months, and for a company that has
  // just swung to a loss it is not stale but wrong: BANPU, JAS and EA were all
  // still showing a low multiple from a profitable year that had already ended.
  // When trailing earnings are negative the multiple does not exist, so the
  // row reports null and the table prints a dash rather than a flattering
  // number.
  const { peCurrent, pbvCurrent } = currentMultiples(fin);

  const bands = computeBands(fin.closes, fin.years, { peCurrent, pbvCurrent });

  return {
    symbol: fin.symbol,
    bare: fin.bare,
    name: fin.name,
    currency: fin.currency,
    price: fin.price,
    priceDate: fin.priceDate,
    pe: peCurrent,
    pbv: pbvCurrent,
    ttmEps,
    ttmEpsBasis: fin.ttm?.epsBasis ?? null,
    ttmBvps: fin.ttm?.bvps ?? null,
    score: quality.score,
    coverage: quality.coverage,
    passed: quality.passed,
    failed: quality.failed,
    checks: quality.checks,
    roe3: quality.roe3,
    roa3: quality.roa3,
    npm3: quality.npm3,
    de: quality.de,
    icr: quality.icr,
    dividendYield: quality.dividendYield,
    payout: quality.payout,
    streak: quality.streak,
    ttmDps: dividend.ttm,
    dps: d0,
    // The year's full payout, specials included — what the exchange's own yield
    // is built from, shown next to the recurring rate when they differ.
    annualDps: dividend.annual,
    dividendFy: dividend.fiscalYear,
    hasSpecialDividend: dividend.hasSpecial,
    ddm: {
      ok: valuation.ok,
      reason: valuation.reason ?? null,
      intrinsic: valuation.intrinsic ?? null,
      mos,
      g1,
      g2,
      r,
      years,
      d0,
    },
    bands: {
      basis: bands.basis,
      pe: bands.pe
        ? { current: bands.pe.current, mean: bands.pe.mean, sd: bands.pe.sd, z: bands.pe.z, levels: bands.pe.levels, median: bands.pe.median, min: bands.pe.min, max: bands.pe.max, skipped: bands.pe.skipped, cap: bands.pe.cap }
        : null,
      pbv: bands.pbv
        ? { current: bands.pbv.current, mean: bands.pbv.mean, sd: bands.pbv.sd, z: bands.pbv.z, levels: bands.pbv.levels, median: bands.pbv.median, min: bands.pbv.min, max: bands.pbv.max, skipped: bands.pbv.skipped, cap: bands.pbv.cap }
        : null,
    },
    yearCount: fin.years.length,
  };
}

/** Full detail for the deep dive, including the series the chart draws. */
export async function loadDetail(tvSymbol, options = {}) {
  const symbol = normalizeSymbol(tvSymbol);
  if (!symbol) {
    const err = new Error('symbol required');
    err.status = 400;
    throw err;
  }
  const yahoo = toYahooSymbol(symbol);
  const quotes = await quoteBatch([yahoo]);
  const fin = await loadFinancials(symbol, { quote: quotes.get(yahoo) ?? null });
  const row = buildRow(fin, options);
  const { peCurrent, pbvCurrent } = currentMultiples(fin);
  const bands = computeBands(fin.closes, fin.years, { peCurrent, pbvCurrent });

  // Year-end close lookup so the trend can show what a holder actually paid
  // at the time, not today's price.
  const closesSorted = [...(fin.closes ?? [])].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const closeAt = (date) => {
    let best = null;
    for (const c of closesSorted) {
      if (c.date <= date) best = c.close; else break;
    }
    return best;
  };
  const trend = {
    years: fin.years.map((y) => y.fiscalYear),
    roe: fin.years.map((y) => (typeof y.roe === 'number' && Number.isFinite(y.roe) ? y.roe : null)),
    yield: fin.years.map((y) => {
      const c = closeAt(y.asOf);
      return (typeof y.dps === 'number' && Number.isFinite(y.dps) && typeof c === 'number' && c > 0)
        ? y.dps / c
        : null;
    }),
  };

  // DPS split by the quarter the cash actually landed in, from the ex-date
  // record rather than the fiscal-year statements: the ex-dates reach back
  // further and are what a holder was paid. Used by the payment chart.
  const dpsQuarterlyMap = new Map();
  for (const d of fin.dividends ?? []) {
    const y = Number(String(d.date).slice(0, 4));
    const m = Number(String(d.date).slice(5, 7));
    if (!Number.isFinite(y) || !Number.isFinite(m)) continue;
    const q = Math.min(4, Math.max(1, Math.ceil(m / 3)));
    const row = dpsQuarterlyMap.get(y) ?? { year: y, q1: 0, q2: 0, q3: 0, q4: 0 };
    row[`q${q}`] += d.amount;
    dpsQuarterlyMap.set(y, row);
  }
  const dpsQuarterly = [...dpsQuarterlyMap.values()]
    .sort((a, b) => a.year - b.year)
    .map((r) => ({ ...r, total: r.q1 + r.q2 + r.q3 + r.q4 }));

  return {
    ...row,
    years: fin.years,
    ttm: fin.ttm,
    yearCount: fin.years.length,
    dividends: fin.dividends.slice(-80),
    pePoints: bands.pe?.points ?? [],
    peLevels: bands.pe?.levels ?? null,
    pbvPoints: bands.pbv?.points ?? [],
    pbvLevels: bands.pbv?.levels ?? null,
    trend,
    dpsQuarterly,
    asOf: new Date().toISOString(),
  };
}

/**
 * Screen a list of symbols.
 *
 * @returns {{ rows: object[], errors: object[], meta: object }}
 */
export async function runScreen(rawSymbols, { preset = 'all', overrides = {}, asOf = new Date() } = {}) {
  const symbols = uniqueSymbols(rawSymbols);
  if (symbols.length === 0) {
    const err = new Error('no symbols to screen');
    err.status = 400;
    throw err;
  }

  const started = Date.now();
  const rows = [];
  const errors = [];

  // One batched quote call for the whole universe. It is what keeps a baht
  // price from being divided by a dollar EPS, and it costs two requests for a
  // hundred names rather than one per name.
  const quotes = await quoteBatch(symbols.map(toYahooSymbol));

  const settled = await mapLimit(symbols, CONCURRENCY, async (symbol) => {
    try {
      const fin = await loadFinancials(symbol, { quote: quotes.get(toYahooSymbol(symbol)) ?? null });
      return { ok: true, row: buildRow(fin, { overrides, asOf }) };
    } catch (err) {
      return {
        ok: false,
        error: {
          symbol,
          bare: normalizeSymbol(symbol)?.split(':')[1] ?? symbol,
          code: err.code ?? 'ERROR',
          message: err.message,
        },
      };
    }
  });

  for (const item of settled) {
    if (item.ok) rows.push(item.row);
    else errors.push(item.error);
  }

  const presetDef = presetById(preset);
  const evaluated = rows.map((row) => {
    const verdict = applyPreset(row, presetDef);
    return { ...row, pass: verdict.pass, failReason: verdict.reason };
  });

  const kept = evaluated.filter((row) => row.pass);

  const sortKey = presetDef.sort;
  const numeric = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : -Infinity);
  kept.sort((a, b) => {
    if (sortKey === 'yield') return numeric(b.dividendYield) - numeric(a.dividendYield);
    if (sortKey === 'mos') return numeric(b.ddm.mos) - numeric(a.ddm.mos);
    return numeric(b.score) - numeric(a.score);
  });

  // The rejected names still matter — "why is CPF not in the list" is a real
  // question — so they are returned behind the kept rows, not discarded. They
  // keep their own ranking rather than the universe's fetch order, so the next
  // name to look at is at the top of the second group as well.
  const rejected = evaluated
    .filter((row) => !row.pass)
    .sort((a, b) => numeric(b.score) - numeric(a.score));

  return {
    rows: [...kept, ...rejected],
    matched: kept.length,
    errors,
    meta: {
      preset,
      presetLabel: presetDef.id,
      requested: symbols.length,
      screened: rows.length,
      failed: errors.length,
      tookMs: Date.now() - started,
      asOf: asOf.toISOString(),
      overrides: {
        r: clampInput(overrides.r, DEFAULTS.r, { min: 0.04, max: 0.25 }),
        g1: clampInput(overrides.g1, DEFAULTS.g1, { min: 0, max: 0.30 }),
        g2: clampInput(overrides.g2, DEFAULTS.g2, { min: 0, max: 0.20 }),
      },
    },
  };
}

/**
 * Curated starting universe.
 *
 * The TradingView scanner this app already talks to can take an explicit ticker
 * list but cannot enumerate a market, so "the SET50" has to be a list someone
 * wrote down. This one is large-cap SET names, ordered roughly by size; it is
 * deliberately described as large caps rather than as an index, because
 * membership changes every half-year and a stale claim would be worse than a
 * vague one. The board and the watchlists supply the other universes, and the
 * dialog accepts a pasted list for anything else.
 *
 * Delisted names are removed rather than left to fail: BPP was absorbed into
 * BANPU and INTUCH into GULF during 2026, and a universe that lists them would
 * report two "no data" errors on every run — noise that looks like a bug in the
 * screen rather than a fact about the market.
 */
export const SET_LARGE_CAPS = [
  'ADVANC', 'AOT', 'AWC', 'BAM', 'BANPU', 'BBL', 'BCP', 'BDMS', 'BEM', 'BGRIM',
  'BH', 'BJC', 'BTS', 'CBG', 'CENTEL', 'CHG', 'COM7', 'CPALL', 'CPF',
  'CPN', 'CRC', 'DELTA', 'DOHOME', 'EA', 'EGCO', 'ERW', 'GLOBAL', 'GPSC', 'GULF',
  'GUNKUL', 'HANA', 'HMPRO', 'ICHI', 'IRPC', 'IVL', 'JAS', 'JMT', 'KBANK',
  'KCE', 'KKP', 'KTB', 'KTC', 'LH', 'MINT', 'MTC', 'OR', 'OSP', 'PLANB',
  'PTT', 'PTTEP', 'PTTGC', 'QH', 'RATCH', 'SAWAD', 'SCB', 'SCC', 'SCGP', 'SIRI',
  'SPALI', 'STA', 'TIDLOR', 'TISCO', 'TLI', 'TOP', 'TRUE', 'TU', 'TVO', 'WHA',
  'MC', 'MEGA', 'TACC', 'BKIH', 'HTC', 'TTW', 'KAMART',
];

/**
 * SET100, as published by the exchange.
 *
 * A written copy of the constituents, used as the seed and as the fallback for
 * the live refresh in `setindex.js`: SET reviews the index twice a year, so the
 * server asks set.or.th for the current list and keeps this one for when the
 * exchange cannot be reached. `live` on the universe entry is what opts into
 * that refresh — the large-cap list below is curated, not an index, so it is
 * never fetched.
 */
export const SET100 = [
  'AAV', 'ADVANC', 'AEONTS', 'AMATA', 'AOT', 'AP', 'AURA', 'AWC', 'BA', 'BAM',
  'BANPU', 'BBL', 'BCH', 'BCP', 'BCPG', 'BDMS', 'BEM', 'BGRIM', 'BH', 'BJC',
  'BLA', 'BTG', 'BTS', 'CBG', 'CCET', 'CENTEL', 'CHG', 'CK', 'COM7', 'CPALL',
  'CPF', 'CPN', 'CRC', 'DELTA', 'DOHOME', 'EA', 'EGCO', 'ERW', 'GFPT', 'GLOBAL',
  'GPSC', 'GST', 'GULF', 'GUNKUL', 'HANA', 'HMPRO', 'ICHI', 'IRPC', 'IVL', 'JMART',
  'JMT', 'KBANK', 'KCE', 'KKP', 'KTB', 'KTC', 'LH', 'M', 'MEGA', 'MINT',
  'MOSHI', 'MRDIYT', 'MTC', 'OR', 'OSP', 'PLANB', 'PR9', 'PRM', 'PTG', 'PTT',
  'PTTEP', 'PTTGC', 'QH', 'RATCH', 'RCL', 'SAWAD', 'SCB', 'SCC', 'SCGP', 'SIRI',
  'SPALI', 'SPRC', 'STA', 'STECON', 'STGT', 'TASCO', 'TCAP', 'TFG', 'THAI', 'TIDLOR',
  'TISCO', 'TLI', 'TOA', 'TOP', 'TRUE', 'TTB', 'TU', 'VGI', 'WHA', 'WHAUP',
];

/** The static universes, in the order the dialog shows them. */
export const UNIVERSES = [
  { id: 'set100', label: 'SET100', symbols: SET100, live: 'set100' },
  { id: 'set-large', label: 'SET large caps', symbols: SET_LARGE_CAPS },
];
