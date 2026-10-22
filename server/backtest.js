/**
 * The framework, judged on what it would have earned.
 *
 * A score is a claim about the future dressed as a number about the past. The
 * only way to know whether a rule earns its place is to hold the names it
 * would have picked and see what happened — and to do it without looking
 * forward while doing it.
 *
 * Two rules of the game:
 *
 *   1. Nothing is known before it was published. A fiscal year is usable from
 *      its end plus the filing lag, the same ninety days the bands use, so a
 *      company is judged on statements a reader could actually have read.
 *   2. The benchmark is the universe itself, equally weighted, because there
 *      is no index of what the screen would have picked.
 *
 * The ten-year history is the source: it carries the balance sheet and the cash
 * flow as well as the profit, so a company is judged on the same rules it is
 * judged on today. Three of them cannot be judged from it — the interest
 * cover needs the interest expense, the free cash flow needs the capital
 * spending, and the leverage rule counts a wider debt than the screen's
 * interest-bearing one — and they are left out rather than guessed.
 */
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  scoreQuality, presetById, sustainableDividend, ddm, marginOfSafety, DEFAULTS,
} from './screener.js';
import { loadFinancials } from './fin.js';
import { annualHistory } from './finnomena.js';
import { simulatePeriod } from './portfolio.js';

const DAY = 86_400_000;
const FILING_LAG_DAYS = 90;

const addDays = (iso, days) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);

const addYears = (iso, years) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCFullYear(d.getUTCFullYear() + years);
  return d.toISOString().slice(0, 10);
};

/** The last close at or before a date. */
function closeAt(closes, date) {
  let best = null;
  for (const c of closes ?? []) {
    if (c.date <= date) best = c.close;
    else break;
  }
  return best;
}

/** The day a fiscal year's statements could first have been read. */
export function publishedOn(year) {
  const end = year.asOf ?? `${year.fiscalYear}-12-31`;
  return addDays(end, FILING_LAG_DAYS);
}

/**
 * One year in the shape the scoring engine reads.
 *
 * The ratios are computed here the way `deriveYears` computes them — over the
 * average of the opening and closing balance — so a company judged in 2019 is
 * judged by the same definition as one judged today.
 */
function engineYear(row, prev, dps) {
  const average = (opening, closing) => (
    typeof opening === 'number' && Number.isFinite(opening)
      && typeof closing === 'number' && Number.isFinite(closing)
      ? (opening + closing) / 2
      : closing
  );
  const ratio = (top, bottom) => (
    typeof top === 'number' && Number.isFinite(top)
      && typeof bottom === 'number' && Number.isFinite(bottom) && bottom !== 0
      ? top / bottom
      : null
  );
  return {
    fiscalYear: row.fiscalYear,
    asOf: row.asOf ?? null,
    knownFrom: publishedOn(row),
    netIncome: row.netIncome,
    revenue: row.revenue,
    equity: row.equity ?? null,
    assets: row.assets ?? null,
    totalDebt: row.totalDebt ?? null,
    ebit: null,
    interestExpense: null,
    operatingCashFlow: row.operatingCashFlow ?? null,
    freeCashFlow: null,
    eps: row.eps ?? null,
    shares: null,
    dividendsPaid: null,
    dpsPaid: dps,
    dps,
    roe: ratio(row.netIncome, average(prev?.equity, row.equity)),
    roa: ratio(row.netIncome, average(prev?.assets, row.assets)),
    npm: row.npm ?? ratio(row.netIncome, row.revenue),
    de: row.de ?? ratio(row.totalDebt, row.equity),
    interestCoverage: null,
    bvps: null,
  };
}

/**
 * The rebalance dates: the end of the first quarter, when the last fiscal
 * year's statements are out.
 *
 * Every company is judged on the same calendar date, and each contributes only
 * the years that had been published by then — a company with a February year
 * end has not reported when the March rebalance happens, so its last year is
 * simply not there.
 */
export function rebalanceDates(fiscalYears, holdYears) {
  const years = (fiscalYears ?? []).map(Number).filter((y) => Number.isFinite(y));
  if (!years.length) return [];
  const first = Math.min(...years);
  const last = Math.max(...years);
  const out = [];
  for (let y = first + 3; y <= last - holdYears; y += 1) out.push(`${y}-03-31`);
  return out;
}

/**
 * One company's record: what the rules said at each date, and what the shares
 * did afterwards.
 */
export function backtestCompany({
  history, dividends = [], closes = [], rebalances, holdYears, symbol = null, name = null,
}) {
  const dpsByYear = new Map();
  for (const d of dividends) {
    const y = Number(String(d.date).slice(0, 4));
    if (!Number.isFinite(y)) continue;
    dpsByYear.set(y, (dpsByYear.get(y) ?? 0) + d.amount);
  }

  const out = [];
  for (const date of rebalances) {
    // Nothing is known before it was published.
    const known = history.filter((y) => publishedOn(y) <= date);
    if (known.length < 3) continue;
    const price = closeAt(closes, date);
    const exit = closeAt(closes, addYears(date, holdYears));
    if (!(price > 0) || !(exit > 0)) continue;

    const rows = known.map((y, i) => engineYear(y, known[i - 1] ?? null, dpsByYear.get(y.fiscalYear) ?? null));
    const knownDividends = dividends.filter((d) => d.date <= date);
    const quality = scoreQuality({
      years: rows,
      dividends: knownDividends,
      price,
      asOf: new Date(`${date}T00:00:00Z`),
      // The most recent published earnings stand in for the trailing twelve
      // months: the quarterly series of that year is not in the history, and
      // using a later figure would be looking forward.
      ttmEps: rows.at(-1).eps,
      history: { years: rows },
    });

    // What the screen would have shown that day.
    //
    // The value the framework put on the company is computed from the same
    // figures the screen had that day, with the same assumptions, so "the
    // price worth paying" in 2019 is the price worth paying in 2019 and not
    // the one the model quotes today.
    const dividend = sustainableDividend({
      years: rows,
      dividends: knownDividends,
      asOf: new Date(`${date}T00:00:00Z`),
      ttmEps: rows.at(-1).eps,
    });
    const valuation = ddm({ d0: dividend.d0, ...DEFAULTS });
    const intrinsic = valuation.ok ? valuation.intrinsic : null;

    // The dividends that arrived while the money was at work.
    //
    // A screen that judges an income mandate on the price alone is judging the
    // wrong thing: the cash that arrives twice a year is the reason the name
    // was on the list. The cash is counted here, and the benchmark counts it
    // the same way, so the two answers can be read against each other.
    const exitDate = addYears(date, holdYears);
    const dividendCash = dividends
      .filter((d) => d.date > date && d.date <= exitDate)
      .reduce((sum, d) => sum + d.amount, 0);

    out.push({
      date,
      symbol,
      name,
      fiscalYear: rows.at(-1).fiscalYear,
      score: quality.score,
      coverage: quality.coverage,
      checks: quality.checks,
      forward: exit / price - 1,
      // The whole return: the price move and the cash that arrived.
      forwardTotal: (exit + dividendCash) / price - 1,
      dividendCash,
      price,
      exitPrice: exit,
      yield: quality.dividendYield ?? null,
      intrinsic,
      mos: intrinsic != null ? marginOfSafety(intrinsic, price) : null,
    });
  }
  return out;
}

/**
 * How the table is ordered.
 *
 * The presets sort by different things — the score for most, the yield for the
 * income one, the margin of safety for the value one — and the shortlist has
 * to follow, because "the first five" is a sentence about the table the reader
 * was looking at.
 */
function bySort(sortKey) {
  if (sortKey === 'yield') return (a, b) => (b.yield ?? -Infinity) - (a.yield ?? -Infinity);
  if (sortKey === 'mos') return (a, b) => (b.mos ?? -Infinity) - (a.mos ?? -Infinity);
  return (a, b) => (b.score ?? -Infinity) - (a.score ?? -Infinity);
}

/**
 * What the rules are worth.
 *
 * For each rule: the average forward return of the names that cleared it and
 * of the names that did not. The difference is the rule's edge — a rule whose
 * two groups earned the same did nothing.
 *
 * The portfolio is the names a preset would have picked, with the rules the
 * history could not judge left out, and the benchmark is every name in the
 * universe at the same dates.
 */
export function summariseBacktest(observations, presetId = 'quality') {
  const preset = presetById(presetId);
  const flat = observations.flat();
  const periods = [...new Set(flat.map((o) => o.date))].sort();

  // Per rule: the two groups.
  //
  // The whole return, dividends included: a rule about the dividend yield
  // judged on the price alone would be measured against the wrong thing.
  const rules = new Map();
  for (const o of flat) {
    for (const c of o.checks) {
      if (c.pass === null) continue;
      const entry = rules.get(c.id) ?? { id: c.id, passed: 0, failed: 0, passSum: 0, failSum: 0 };
      if (c.pass === true) {
        entry.passed += 1;
        entry.passSum += o.forwardTotal;
      } else {
        entry.failed += 1;
        entry.failSum += o.forwardTotal;
      }
      rules.set(c.id, entry);
    }
  }

  const ruleRows = [...rules.values()].map((r) => {
    const passReturn = r.passed ? r.passSum / r.passed : null;
    const failReturn = r.failed ? r.failSum / r.failed : null;
    return {
      id: r.id,
      passed: r.passed,
      failed: r.failed,
      passReturn,
      failReturn,
      edge: passReturn != null && failReturn != null ? passReturn - failReturn : null,
    };
  }).sort((a, b) => (b.edge ?? -1) - (a.edge ?? -1));

  // The portfolio, period by period.
  const perPeriod = periods.map((date) => {
    const at = flat.filter((o) => o.date === date);
    const picked = at.filter((o) => {
      // The preset's mandatory rules, minus the ones the history cannot judge.
      const required = preset.requires.filter((id) => {
        const check = o.checks.find((c) => c.id === id);
        return check && check.pass !== null;
      });
      if (required.length > 0 && !required.every((id) => o.checks.find((c) => c.id === id)?.pass === true)) {
        return false;
      }
      // A value screen is a margin of safety, not a score: a name the model
      // cannot value has no margin of safety, and a name with a negative one
      // is a forecast rather than a value case.
      if (typeof preset.minMos === 'number') {
        if (o.mos == null || o.mos < preset.minMos) return false;
      }
      if (required.length === 0 && typeof preset.minMos !== 'number') {
        return o.score >= preset.minScore;
      }
      return o.score >= preset.minScore;
    });

    // The screen's own order, so that "the first five" means what the reader
    // saw in the table and not an order invented here.
    const sorted = [...picked].sort(bySort(preset.sort));

    const average = (list) => (list.length ? list.reduce((s, o) => s + o.forwardTotal, 0) / list.length : null);
    return {
      date,
      names: at.length,
      picked: picked.length,
      portfolio: average(picked),
      universe: average(at),
      // The shortlist, in the order the table would have shown it. Wide
      // enough to answer "what if I had held twenty names instead of five",
      // which is the question the concentration of a small shortlist raises.
      shortlist: sorted.slice(0, 24).map((o) => ({
        symbol: o.symbol,
        name: o.name,
        score: o.score,
        yield: o.yield,
        mos: o.mos,
        price: o.price,
        intrinsic: o.intrinsic,
        forward: o.forwardTotal,
      })),
    };
  });

  const compound = (values) => {
    const usable = values.filter((v) => typeof v === 'number' && Number.isFinite(v));
    if (!usable.length) return null;
    return usable.reduce((acc, v) => acc * (1 + v), 1) - 1;
  };

  return {
    preset: preset.id,
    periods: perPeriod,
    rules: ruleRows,
    totals: {
      periods: perPeriod.length,
      names: flat.length,
      portfolio: compound(perPeriod.map((p) => p.portfolio)),
      universe: compound(perPeriod.map((p) => p.universe)),
    },
  };
}

/**
 * How each rule has done, and the run that produced the answer.
 *
 * The back test is the only honest answer to "does this rule earn its place",
 * and running it on every screen would cost a minute. It is run once over the
 * index and kept for a day, and the edge is attached to the rule it belongs to.
 */
let edgeCache = { at: 0, rules: new Map(), running: false };
let edgePath = null;

/**
 * Read the saved edges at startup.
 *
 * The run costs a hundred charts, and a container that sleeps and wakes would
 * pay it again every time; the file is what makes the answer survive the
 * restart.
 */
export async function initRuleEdges(filePath) {
  edgePath = filePath;
  try {
    const raw = JSON.parse(await readFile(edgePath, 'utf8'));
    const rules = new Map((raw.rules ?? []).map((r) => [r.id, r]));
    if (rules.size) {
      edgeCache = {
        at: Number(raw.at) || Date.now(),
        rules,
        presets: raw.presets ?? {},
        running: false,
      };
      console.log(`[backtest] loaded ${rules.size} rule edges from ${edgePath}`);
    }
  } catch {
    // No file yet: the first screen run will make one.
  }
  return edgeCache.rules.size;
}

async function saveRuleEdges(rules, presets = {}) {
  if (!edgePath) return;
  try {
    await mkdir(dirname(edgePath), { recursive: true });
    await writeFile(edgePath, `${JSON.stringify({
      at: Date.now(),
      rules: [...rules.values()].map((r) => ({
        id: r.id, passed: r.passed, failed: r.failed,
        passReturn: r.passReturn, failReturn: r.failReturn, edge: r.edge,
      })),
      presets,
    }, null, 2)}\n`, 'utf8');
  } catch (err) {
    console.warn(`[backtest] could not save the edges: ${err.message}`);
  }
}

export async function ruleEdges(symbols, { maxAgeMs = 24 * 60 * 60 * 1000 } = {}) {
  const fresh = edgeCache.rules.size
    && Object.keys(edgeCache.presets ?? {}).length
    && Date.now() - edgeCache.at < maxAgeMs;
  if (fresh) return edgeCache.rules;
  const result = await runBacktest({
    symbols,
    preset: 'quality',
    holdYears: 3,
    presets: ['moat', 'quality', 'dividend', 'value'],
  });
  edgeCache = {
    at: Date.now(),
    rules: new Map(result.rules.map((r) => [r.id, r])),
    presets: result.byPreset ?? {},
    running: false,
  };
  await saveRuleEdges(edgeCache.rules, edgeCache.presets);
  return edgeCache.rules;
}

/** The edges already known, without running anything. */
export function cachedRuleEdges() {
  return edgeCache.rules;
}

/**
 * How each theme has done, and the order they stand in.
 *
 * The ranking comes from the same run that measured the rules, so the medals
 * on the theme buttons and the evidence beside each rule are the same
 * measurement and not two different ones.
 */
export function cachedPresetRanks() {
  if (!edgeCache.presets || !Object.keys(edgeCache.presets).length) return {};
  return presetRanks(edgeCache.presets);
}

/**
 * Start the back test if it has not been run, without waiting for it.
 *
 * The screen must not hang on a test, so the edges arrive on the next refresh
 * rather than the current one — the run is minutes of history, and the reader
 * has a screen to read in the meantime.
 */
export function ensureRuleEdges(symbols) {
  const have = edgeCache.rules.size && Object.keys(edgeCache.presets ?? {}).length;
  if (have || edgeCache.running) return;
  edgeCache.running = true;
  ruleEdges(symbols)
    .catch((err) => console.warn(`[backtest] edge run failed: ${err.message}`))
    .finally(() => { edgeCache.running = false; });
}

/**
 * Run the back test over a universe.
 *
 * The statements and the daily closes come from the server's own cache, so a
 * second run costs nothing; the first one fetches them.
 *
 * `presets` asks for a summary of each theme as well: the observations are the
 * same, and only the ranking of the names differs, so the whole set costs
 * almost nothing beside the run itself.
 */
export async function runBacktest({
  symbols, preset = 'quality', holdYears = 3, concurrency = 5, simulation = null, presets = null,
}) {
  let next = 0;
  const loaded = [];
  const runners = Array.from({ length: Math.min(concurrency, symbols.length) }, async () => {
    while (next < symbols.length) {
      const symbol = symbols[next];
      next += 1;
      try {
        const [fin, history] = await Promise.all([
          loadFinancials(symbol),
          annualHistory(symbol, { live: false }),
        ]);
        loaded.push({ symbol, fin, history: history?.years ?? [] });
      } catch {
        // A name the sources cannot answer is simply not in the test.
      }
    }
  });
  await Promise.all(runners);

  const years = loaded.flatMap((x) => x.history.map((y) => y.fiscalYear));
  const rebalances = rebalanceDates(years, holdYears);
  const observations = loaded.flatMap(({ symbol, fin, history }) => backtestCompany({
    history,
    dividends: fin.dividends,
    closes: fin.closes,
    rebalances,
    holdYears,
    symbol,
    name: fin.name,
  }));

  const summary = summariseBacktest(observations, preset);

  // The same run, read through each theme's own rules.
  const byPreset = {};
  for (const id of presets ?? []) {
    const s = summariseBacktest(observations, id);
    byPreset[id] = {
      portfolio: s.totals.portfolio,
      universe: s.totals.universe,
      periods: s.periods.length,
      picked: s.periods.reduce((sum, p) => sum + p.picked, 0),
    };
  }

  return {
    ...summary,
    holdYears,
    rebalances,
    byPreset,
    simulation: simulation
      ? simulatePortfolioRun({ summary, loaded, holdYears, ...simulation })
      : null,
  };
}

/**
 * The themes in the order of how they have done.
 *
 * The measure is the same one the back test reports: the names a theme would
 * have picked, held over the same years, against every name in the universe.
 * The first three are the ones worth marking; the fourth is not a failure,
 * it is simply fourth.
 */
export function presetRanks(byPreset) {
  const entries = Object.entries(byPreset ?? {})
    .map(([id, v]) => ({ id, portfolio: v?.portfolio }))
    .filter((e) => Number.isFinite(e.portfolio));
  entries.sort((a, b) => b.portfolio - a.portfolio);
  const ranks = {};
  entries.forEach((entry, index) => { ranks[entry.id] = index + 1; });
  return ranks;
}

/**
 * The money.
 *
 * Five million baht into the names the screen would have shown first, held for
 * the same years the back test holds them, under the three ways a reader
 * might have put the money in.
 */
function simulatePortfolioRun({
  summary, loaded, holdYears, capital = 5_000_000, monthly = 25_000, topN = 5,
  waitMode = 'value', waitDrop = 0.1,
}) {
  const closesBySymbol = {};
  const dividendsBySymbol = {};
  for (const { symbol, fin } of loaded) {
    closesBySymbol[symbol] = fin.closes ?? [];
    dividendsBySymbol[symbol] = fin.dividends ?? [];
  }

  const mean = (values) => {
    const usable = values.filter((v) => typeof v === 'number' && Number.isFinite(v));
    return usable.length ? usable.reduce((s, v) => s + v, 0) / usable.length : null;
  };

  // The shortlists to answer for: the one asked for, and any others the
  // caller wants beside it. The prices are already in memory, so each one is
  // a moment's work.
  const sizes = [...new Set([].concat(topN).map((n) => Math.max(1, Number(n) || 5)))];

  const byTopN = sizes.map((size) => {
    const periods = (summary.periods ?? []).map((period) => {
      const picks = (period.shortlist ?? []).slice(0, size);
      const from = period.date;
      const to = addYears(from, holdYears);
      if (!picks.length) {
        return { date: from, to, picks: [], result: null, universe: period.universe };
      }
      // The level a reader would call right.
      //
      // Two ways to say it, and the difference matters: the value the
      // framework put on the company that day, or a set fall below the price
      // the screen saw. The first is a judgement about the company; the second
      // is a discipline about the entry. A name the screen picked *because* it
      // was below its value is already below its value, so the first rule
      // never makes such a name wait — and a name the screen picked for its
      // growth may never be below its value at all, so the money would sit in
      // cash for the whole period. Both are true answers to a question that
      // asked it; the reader chooses which question to ask.
      const thresholds = {};
      for (const pick of picks) {
        const fall = pick.price * (1 - waitDrop);
        thresholds[pick.symbol] = waitMode === 'drop'
          ? fall
          : (pick.intrinsic ?? fall);
      }
      const result = simulatePeriod({
        picks, closesBySymbol, dividendsBySymbol, from, to, capital, monthly, thresholds,
      });
      return {
        date: from,
        to,
        picks: picks.map((p) => ({
          symbol: p.symbol,
          name: p.name,
          price: p.price,
          intrinsic: p.intrinsic,
          mos: p.mos,
          yield: p.yield,
          score: p.score,
        })),
        result,
        universe: period.universe,
      };
    });

    const averages = {};
    for (const key of ['lump', 'dca', 'wait']) {
      averages[key] = mean(periods.map((p) => p.result?.[key]?.return));
    }
    return {
      topN: size,
      periods,
      averages,
      universe: mean(periods.map((p) => p.universe)),
    };
  });

  const primary = byTopN.find((b) => b.topN === sizes[0]) ?? byTopN[0];
  return {
    capital,
    monthly,
    topN: primary.topN,
    holdYears,
    waitMode,
    waitDrop,
    periods: primary.periods,
    averages: primary.averages,
    universe: primary.universe,
    byTopN,
    // What the money would have done parked in the index instead.
    indexValue: primary.universe != null ? capital * (1 + primary.universe) : null,
  };
}
