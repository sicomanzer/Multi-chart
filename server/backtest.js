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
import { scoreQuality, presetById } from './screener.js';
import { loadFinancials } from './fin.js';
import { annualHistory } from './finnomena.js';

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
export function backtestCompany({ history, dividends = [], closes = [], rebalances, holdYears }) {
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
    const quality = scoreQuality({
      years: rows,
      dividends: dividends.filter((d) => d.date <= date),
      price,
      asOf: new Date(`${date}T00:00:00Z`),
      // The most recent published earnings stand in for the trailing twelve
      // months: the quarterly series of that year is not in the history, and
      // using a later figure would be looking forward.
      ttmEps: rows.at(-1).eps,
      history: { years: rows },
    });

    out.push({
      date,
      fiscalYear: rows.at(-1).fiscalYear,
      score: quality.score,
      coverage: quality.coverage,
      checks: quality.checks,
      forward: exit / price - 1,
    });
  }
  return out;
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
  const rules = new Map();
  for (const o of flat) {
    for (const c of o.checks) {
      if (c.pass === null) continue;
      const entry = rules.get(c.id) ?? { id: c.id, passed: 0, failed: 0, passSum: 0, failSum: 0 };
      if (c.pass === true) {
        entry.passed += 1;
        entry.passSum += o.forward;
      } else {
        entry.failed += 1;
        entry.failSum += o.forward;
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
      if (required.length === 0) return o.score >= preset.minScore;
      return required.every((id) => o.checks.find((c) => c.id === id)?.pass === true);
    });
    const average = (list) => (list.length ? list.reduce((s, o) => s + o.forward, 0) / list.length : null);
    return {
      date,
      names: at.length,
      picked: picked.length,
      portfolio: average(picked),
      universe: average(at),
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
 * Run the back test over a universe.
 *
 * The statements and the daily closes come from the server's own cache, so a
 * second run costs nothing; the first one fetches them.
 */
export async function runBacktest({ symbols, preset = 'quality', holdYears = 3, concurrency = 5 }) {
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
        loaded.push({ fin, history: history?.years ?? [] });
      } catch {
        // A name the sources cannot answer is simply not in the test.
      }
    }
  });
  await Promise.all(runners);

  const years = loaded.flatMap((x) => x.history.map((y) => y.fiscalYear));
  const rebalances = rebalanceDates(years, holdYears);
  const observations = loaded.flatMap(({ fin, history }) => backtestCompany({
    history,
    dividends: fin.dividends,
    closes: fin.closes,
    rebalances,
    holdYears,
  }));

  return {
    ...summariseBacktest(observations, preset),
    holdYears,
    rebalances,
  };
}
