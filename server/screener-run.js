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
  applyFilters,
  applyPreset,
  computeBands,
  ddm,
  DEFAULTS,
  grahamNumber,
  marginOfSafety,
  peerPercentiles,
  presetById,
  scoreQuality,
  sustainableDividend,
} from './screener.js';
import { normalizeSymbol, toYahooSymbol, uniqueSymbols } from './symbols.js';
import { quoteBatch } from './quotes.js';
import { annualHistory } from './finnomena.js';
import { cachedRuleEdges, cachedPresetRanks, ensureRuleEdges } from './backtest.js';

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
export { DEFAULTS };

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
/**
 * The years both sources agree on, with the leverage read the way the exchange
 * reads it.
 *
 * Yahoo's statements and the long history are two independent readings of the
 * same filings, and they agree closely on every name that has not had a figure
 * mangled. When they do not — one source says a profit of a hundred billion
 * where the other says a loss — one of them is wrong and the screen cannot tell
 * which, so the year is left out. A rule that reads a mangled number is
 * reading rubbish, and a missing year shows up in the coverage.
 *
 * The leverage comes from the same history, because Yahoo's "total debt" leaves
 * out the lease liabilities a hospital or an airport runs on: BH looks
 * debt-free at 0.00 when the exchange publishes 0.17, and a rule that counts
 * debt below 1.0 has to count the same debt the reader sees.
 */
export function reconcileYears(years, history) {
  const byYear = new Map((history ?? []).map((h) => [h.fiscalYear, h]));
  return years
    .map((year) => {
      const other = byYear.get(year.fiscalYear);
      if (!other) return year;
      const de = other.de;
      return de == null ? year : { ...year, de };
    })
    .filter((year) => {
      const other = byYear.get(year.fiscalYear);
      if (!other) return true;
      const a = year.netIncome;
      const b = other.netIncome;
      if (typeof a !== 'number' || typeof b !== 'number') return true;
      if (a === 0 && b === 0) return true;
      // A figure of zero in one source is missing information, not a
      // contradiction: the year is judged on the source that has it.
      if (b === 0) return true;
      // A sign that disagrees is a mangled figure, whatever the size.
      if (a !== 0 && Math.sign(a) !== Math.sign(b)) return false;
      const ratio = Math.abs(a / b);
      return ratio >= 0.4 && ratio <= 2.5;
    });
}

/**
 * The long history, with only the reconciled Yahoo years allowed to supply EPS.
 *
 * The tracked file is the only source old enough for a five-year revenue CAGR
 * and an eight-year profit record, but its EPS column mixes definitions on some
 * names (a reported loss with a positive core EPS). Revenue and net income are
 * reported consistently, so those come from the file; the per-share series is
 * taken from the same four Yahoo years the rest of the score uses.
 */
function buildGrowthHistory(trusted, history) {
  const source = history?.years ?? [];
  if (!source.length) return null;
  const latest = trusted.at(-1)?.fiscalYear;
  if (!Number.isFinite(latest)) return null;
  const trustedByYear = new Map(trusted.map((y) => [y.fiscalYear, y]));
  const byYear = new Map();
  for (const y of source) {
    if (Number.isFinite(y?.fiscalYear) && y.fiscalYear <= latest) byYear.set(y.fiscalYear, y);
  }
  for (const y of trusted) {
    byYear.set(y.fiscalYear, { ...(byYear.get(y.fiscalYear) ?? {}), ...y });
  }
  return [...byYear.values()]
    .sort((a, b) => a.fiscalYear - b.fiscalYear)
    .map((y) => {
      const t = trustedByYear.get(y.fiscalYear);
      return { ...y, eps: t?.eps ?? null, shares: t?.shares ?? null };
    });
}

/**
 * A row that is deliberately not scored.
 *
 * Used when the data itself is the problem — the reporting currency could not
 * be converted without a sign flip, or the chart stopped before the quote
 * because the shares were suspended or replaced. A zero would look like a
 * failed company; `null` and `unknown:data` say what actually happened.
 */
function unknownRow(fin, reason) {
  return {
    symbol: fin.symbol,
    bare: fin.bare,
    name: fin.name,
    currency: fin.currency,
    price: fin.price,
    priceDate: fin.priceDate,
    priceSource: fin.priceSource ?? null,
    pe: null,
    pbv: null,
    ttmEps: null,
    ttmEpsBasis: null,
    ttmBvps: null,
    score: null,
    coverage: 0,
    passed: 0,
    failed: 0,
    checks: [],
    roe3: null,
    roa3: null,
    npm3: null,
    epsCagr3: null,
    de: null,
    icr: null,
    dividendYield: null,
    payout: null,
    streak: 0,
    ttmDps: null,
    dps: null,
    annualDps: null,
    dividendFy: null,
    hasSpecialDividend: false,
    ddm: { ok: false, reason, intrinsic: null, mos: null, g1: null, g2: null, r: null, years: null, d0: null },
    ddmScenario: null,
    ddmScenarioFlat: null,
    graham: { ok: false, reason, value: null, mos: null, eps: null, bvps: null },
    bands: { basis: null, pe: null, pbv: null },
    yearCount: 0,
    dataIssue: reason,
    failReason: 'unknown:data',
  };
}

export function buildRow(fin, { overrides = {}, asOf = new Date(), history = null } = {}) {
  if (fin.dataIssue) return unknownRow(fin, fin.dataIssue);
  const ttmEps = fin.ttm?.eps ?? null;
  const trusted = reconcileYears(fin.years, history?.years ?? []);
  // Growth needs a longer run than the four annual statement rows Yahoo keeps.
  // The tracked history supplies the older revenue and profit, but its EPS is
  // not trustworthy for every name: several rows mix core earnings with the
  // reported net income (TU 2023: a reported loss and a positive "EPS"). So the
  // long history is used for revenue and profit, and only the four reconciled
  // Yahoo years are allowed to supply the per-share series.
  const growthYears = buildGrowthHistory(trusted, history);
  const quality = scoreQuality({
    years: trusted,
    dividends: fin.dividends,
    price: fin.price,
    asOf,
    ttmEps,
    isFinancial: fin.isFinancial === true,
    history: growthYears ? { years: growthYears } : null,
  });

  // What each rule has actually done, attached to the rule it belongs to.
  //
  // A score says a company is good; the back test says whether picking the
  // good companies was worth anything. The edges are measured over the index
  // and kept for a day, so the run happens in the background and the answer
  // arrives on the next refresh.
  const edges = cachedRuleEdges();
  for (const check of quality.checks) {
    const edge = edges.get(check.id);
    if (edge && Number.isFinite(edge.edge)) check.edge = edge.edge;
  }

  const dividend = sustainableDividend({ years: trusted, dividends: fin.dividends, asOf, ttmEps });
  const d0 = dividend.d0;
  const g1 = clampInput(overrides.g1, DEFAULTS.g1, { min: 0, max: 0.30 });
  const r = clampInput(overrides.r, DEFAULTS.r, { min: 0.04, max: 0.25 });
  const g2 = clampInput(overrides.g2, DEFAULTS.g2, { min: 0, max: 0.20 });
  const years = clampInput(overrides.years, DEFAULTS.years, { min: 1, max: 15 });

  // The payout is not an input to the arithmetic; it is a test of whether the
  // arithmetic is meaningful. A dividend that is all of (or more than) the
  // profit cannot fund the growth the model assumes.
  const valuation = ddm({
    d0, g1, g2, r, years, payout: quality.payout, yieldRate: quality.dividendYield,
  });
  const mos = valuation.ok ? marginOfSafety(valuation.intrinsic, fin.price) : null;

  // When the only blocker is an unfunded payout, stock detail can show a
  // clearly labelled scenario. It is never used by the screener, presets or
  // backtest; it exists so the reader can compare assumptions instead of
  // being handed a blank box.
  const scenarioFor = (value) => (value?.ok
    ? {
      ok: true,
      intrinsic: value.intrinsic,
      mos: marginOfSafety(value.intrinsic, fin.price),
      g1: value.inputs.g1,
      g2: value.inputs.g2,
      r: value.inputs.r,
      years: value.inputs.years,
      d0,
      scenario: true,
    }
    : null);
  const unfundedScenario = !valuation.ok && valuation.reason === 'payout-not-funded'
    ? scenarioFor(ddm({
      d0, g1, g2, r, years, payout: quality.payout, yieldRate: quality.dividendYield,
      allowUnfunded: true,
    }))
    : null;
  const flatScenario = !valuation.ok && valuation.reason === 'payout-not-funded'
    ? scenarioFor(ddm({
      d0, g1: 0.05, g2: 0.05, r, years, payout: quality.payout,
      yieldRate: quality.dividendYield, allowUnfunded: true,
    }))
    : null;

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

  const bands = computeBands(fin.closes, trusted, { peCurrent, pbvCurrent });

  return {
    symbol: fin.symbol,
    bare: fin.bare,
    name: fin.name,
    currency: fin.currency,
    price: fin.price,
    priceDate: fin.priceDate,
    priceSource: fin.priceSource ?? null,
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
    // The three-year earnings growth rate, lifted out of the checks so the peer
    // comparison can rank it like any other measure.
    epsCagr3: quality.growth?.eps3?.value ?? null,
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
    ddmScenario: unfundedScenario,
    ddmScenarioFlat: flatScenario,
    // A second, much blunter opinion. It uses today's EPS and book value and
    // no growth forecast; it is a cross-check, not a replacement for the DDM.
    graham: (() => {
      const g = grahamNumber(fin.ttm?.eps, fin.ttm?.bvps);
      return {
        ok: g.ok,
        reason: g.reason ?? null,
        value: g.value ?? null,
        mos: g.ok ? marginOfSafety(g.value, fin.price) : null,
        eps: fin.ttm?.eps ?? null,
        bvps: fin.ttm?.bvps ?? null,
      };
    })(),
    bands: {
      basis: bands.basis,
      pe: bands.pe
        ? { current: bands.pe.current, mean: bands.pe.mean, sd: bands.pe.sd, z: bands.pe.z, levels: bands.pe.levels, median: bands.pe.median, min: bands.pe.min, max: bands.pe.max, skipped: bands.pe.skipped, cap: bands.pe.cap }
        : null,
      pbv: bands.pbv
        ? { current: bands.pbv.current, mean: bands.pbv.mean, sd: bands.pbv.sd, z: bands.pbv.z, levels: bands.pbv.levels, median: bands.pbv.median, min: bands.pbv.min, max: bands.pbv.max, skipped: bands.pbv.skipped, cap: bands.pbv.cap }
        : null,
    },
    yearCount: trusted.length,
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
  // The long annual history is a second source and an optional one: it runs in
  // parallel with the quote and its failure only costs the charts, never the
  // screen.
  const [quotes, history] = await Promise.all([
    quoteBatch([yahoo]),
    annualHistory(symbol),
  ]);
  const fin = await loadFinancials(symbol, { quote: quotes.get(yahoo) ?? null });
  // The same history the charts draw also judges the growth rules, so the
  // scorecard in the deep dive and the score in the table agree.
  const row = buildRow(fin, { ...options, history });
  // Where the name sits against its peers, from the last screen — a percentile
  // needs the other names, and screening the universe again for one company
  // would cost a minute.
  const peers = peerCache.get(fin.symbol);
  if (peers) row.peers = peers;
  const { peCurrent, pbvCurrent } = currentMultiples(fin);
  const trusted = reconcileYears(fin.years, history?.years ?? []);
  const bands = computeBands(fin.closes, trusted, { peCurrent, pbvCurrent });

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
    years: trusted,
    ttm: fin.ttm,
    yearCount: trusted.length,
    dividends: fin.dividends.slice(-80),
    pePoints: bands.pe?.points ?? [],
    peLevels: bands.pe?.levels ?? null,
    pbvPoints: bands.pbv?.points ?? [],
    pbvLevels: bands.pbv?.levels ?? null,
    dpsQuarterly,
    history: history ?? null,
    // The rules that only a balance-sheet business is judged on are left out
    // for a bank, an insurer or a lender. The charts read it too: gross margin
    // is measured against a different denominator for a financial, so the chart
    // says what it is measuring rather than looking like a number to compare.
    isFinancial: fin.isFinancial === true,
    asOf: new Date().toISOString(),
  };
}

/**
 * Screen a list of symbols.
 *
 * @returns {{ rows: object[], errors: object[], meta: object }}
 */
/**
 * The measures the peer comparison ranks, and which way is better.
 *
 * A P/E of 12 is cheap against a market of 20 and expensive against a market of
 * 8, so the comparison is only meaningful once the group is named. These are
 * the measures a reader already looks at in the table.
 */
const PEER_SPECS = [
  { key: 'roe', better: 'high', get: (row) => row.roe3 },
  { key: 'npm', better: 'high', get: (row) => row.npm3 },
  { key: 'pe', better: 'low', get: (row) => row.pe },
  { key: 'yield', better: 'high', get: (row) => row.dividendYield },
  { key: 'de', better: 'low', get: (row) => row.de },
  { key: 'epsGrowth', better: 'high', get: (row) => row.epsCagr3 },
];

/**
 * The last screen's peer comparison.
 *
 * The deep dive shows one company, and a percentile needs the others beside
 * it, so the run leaves its comparison behind for the detail to read. A name
 * that was never screened has no comparison, and says so.
 */
const peerCache = new Map();

export async function runScreen(rawSymbols, { preset = 'all', overrides = {}, asOf = new Date(), sectors = null, filters = null } = {}) {
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
      // The long history comes from the tracked file, so this costs a lookup
      // and not a request: a screen over a hundred names must not become a
      // hundred calls to an upstream that may not answer.
      const [fin, history] = await Promise.all([
        loadFinancials(symbol, { quote: quotes.get(toYahooSymbol(symbol)) ?? null }),
        annualHistory(symbol, { live: false }),
      ]);
      return { ok: true, row: buildRow(fin, { overrides, asOf, history }) };
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

  // Peer comparison: where each name sits inside the set that was screened,
  // and inside its own sector. A threshold says a company is good; a
  // percentile says how good, against the names it is actually competing with.
  for (const row of rows) row.sector = sectors?.get(row.symbol) ?? null;
  const sectorSizes = new Map();
  for (const row of rows) {
    if (row.sector) sectorSizes.set(row.sector, (sectorSizes.get(row.sector) ?? 0) + 1);
  }
  const universe = peerPercentiles(rows, PEER_SPECS);
  const bySector = peerPercentiles(rows, PEER_SPECS, { groupBy: (row) => row.sector, minGroup: 5 });
  for (const row of rows) {
    row.peers = {
      universe: { size: rows.length, values: universe.get(row) ?? {} },
      sector: {
        name: row.sector ?? null,
        size: row.sector ? sectorSizes.get(row.sector) ?? 0 : 0,
        values: bySector.get(row) ?? {},
      },
    };
    peerCache.set(row.symbol, row.peers);
  }

  // What each rule has actually done, attached to the rule it belongs to.
  //
  // A score says a company is good; the back test says whether picking the
  // good companies was worth anything. The edges are measured over the index
  // and kept for a day, so the run happens in the background and the answer
  // arrives on the next refresh.
  const edges = cachedRuleEdges();
  for (const row of rows) {
    for (const check of row.checks) {
      const edge = edges.get(check.id);
      if (edge && Number.isFinite(edge.edge)) check.edge = edge.edge;
    }
  }
  ensureRuleEdges(SET100);

  // The edge run is started here rather than on the first detail, so the answer
  // is waiting by the time the reader opens a company.
  ensureRuleEdges(SET100);
  const presetDef = presetById(preset);
  // The reader's own conditions narrow the universe first; the preset then
  // applies on top, so a name has to clear both.
  const conditions = applyFilters(rows, filters);
  const evaluated = rows.map((row) => {
    const verdict = applyPreset(row, presetDef);
    const mine = conditions.find((c) => c.row === row);
    const pass = verdict.pass && mine?.pass !== false;
    return {
      ...row,
      pass,
      failReason: verdict.pass
        ? (mine?.pass === false ? (mine.reason ?? 'filter') : null)
        : verdict.reason,
    };
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
    // How the themes have done, so the reader can see which of them the
    // evidence puts in front. The same run that measured the rules.
    presetRanks: cachedPresetRanks(),
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
