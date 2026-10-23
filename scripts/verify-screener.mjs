/**
 * Verifies the screener.
 *
 * Two halves, deliberately:
 *
 *   the engine   pure functions, no network. `ddm`, `computeBands`,
 *                `scoreQuality`, `sustainableDividend` and `applyPreset` are
 *                checked against hand-computed answers and against the
 *                properties that make the screen trustworthy — no hindsight in
 *                the bands, no silent failure for a bank, no capitalising a
 *                one-off dividend.
 *
 *   the routes   shape only, and only the two that cannot touch the network:
 *                the universe list and the validation errors. Actually running
 *                a screen would hit Yahoo, and a test suite that depends on an
 *                upstream service fails for reasons that have nothing to do
 *                with this code.
 *
 * Exits non-zero on any failure.
 */
import {
  applyFilters,
  applyPreset,
  computeBands,
  ddm,
  fiscalYearDividend,
  marginOfSafety,
  peerPercentiles,
  presetById,
  scoreQuality,
  sustainableDividend,
  trailingDividend,
} from '../server/screener.js';
import { DEFAULTS, SET_LARGE_CAPS, SET100, buildRow, reconcileYears } from '../server/screener-run.js';
import { clearConstituentCache, constituents, parseComposition, refresh } from '../server/setindex.js';
import { deriveYears, unitGap } from '../server/fin.js';
import { backtestCompany, publishedOn, rebalanceDates, summariseBacktest } from '../server/backtest.js';
import { simulatePeriod } from '../server/portfolio.js';
import { TrackedStore } from '../server/tracked-store.js';
import { aggregateAnnual, aggregateQuarterly, annualHistory, clearFinnomenaCache, finnomenaStatus, HISTORY_YEARS } from '../server/finnomena.js';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = process.env.API ?? 'http://127.0.0.1:8787';

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '  PASS' : '  FAIL'}  ${name}${ok ? '' : `  <- ${detail}`}`);
  if (!ok) failures += 1;
};
const near = (a, b, tolerance = 1e-9) => Math.abs(a - b) <= tolerance;

// ── DDM ─────────────────────────────────────────────────────────────────────

console.log('\n── Two-stage DDM ──');

// Hand-computed from the closed form with d0=1, g1=5%, g2=3%, r=9%, n=5:
//   sum   = Σ (1.05/1.09)^t
//   term  = 1.05^5 * 1.03 / (0.06 * 1.09^5)
const base = ddm({ d0: 1, g1: 0.05, g2: 0.03, r: 0.09, years: 5 });
check('intrinsic value matches the closed form', near(base.intrinsic, 18.715416372560988, 1e-9), base.intrinsic);
check('present value of stage one', near(base.presentValue, 4.475744562905609, 1e-9), base.presentValue);
check('terminal value', near(base.terminalValue, 14.239671809655379, 1e-9), base.terminalValue);
check('the two stages add up',
  near(base.presentValue + base.terminalValue, base.intrinsic, 1e-12), base.intrinsic);

const mos = marginOfSafety(base.intrinsic, 15);
check('margin of safety is (V - P) / V', near(mos, 19.85217052401905, 1e-9), mos);
check('margin of safety is negative above intrinsic value',
  marginOfSafety(10, 12) < 0, marginOfSafety(10, 12));
check('margin of safety of an exact-price buy is zero', near(marginOfSafety(10, 10), 0));
check('margin of safety needs a positive intrinsic value', marginOfSafety(0, 10) === null);

check('a higher stage-one growth rate raises the value',
  ddm({ d0: 1, g1: 0.08, g2: 0.03, r: 0.09 }).intrinsic >
  ddm({ d0: 1, g1: 0.04, g2: 0.03, r: 0.09 }).intrinsic);
check('a higher discount rate lowers the value',
  ddm({ d0: 1, g1: 0.05, g2: 0.03, r: 0.12 }).intrinsic <
  ddm({ d0: 1, g1: 0.05, g2: 0.03, r: 0.08 }).intrinsic);

check('no dividend is reported, not valued at zero',
  ddm({ d0: 0, g1: 0.05 }).ok === false && ddm({ d0: 0, g1: 0.05 }).reason === 'no-dividend');
check('r at or below g2 is refused rather than returning infinity',
  ddm({ d0: 1, g1: 0.05, g2: 0.05, r: 0.05 }).reason === 'r-not-above-g2');
check('the growth window is clamped',
  ddm({ d0: 1, g1: 0.05, g2: 0.03, r: 0.09, years: 500 }).inputs.years === 20);

// The shipped default is the flat pair, and at g1 = g2 the two-stage model
// collapses to Gordon growth: V = D0(1+g)/(r-g). That identity is what makes
// the default defensible — it is one assumption, not two.
check('the default valuation is g1 = g2 = 5%',
  DEFAULTS.g1 === 0.05 && DEFAULTS.g2 === 0.05, `${DEFAULTS.g1}/${DEFAULTS.g2}`);
check('flat growth collapses to D0(1+g)/(r-g)',
  near(ddm({ d0: 1, g1: 0.05, g2: 0.05, r: 0.09 }).intrinsic, 26.25, 1e-9),
  ddm({ d0: 1, g1: 0.05, g2: 0.05, r: 0.09 }).intrinsic);

// ── Bands ───────────────────────────────────────────────────────────────────

console.log('\n── Valuation bands ──');

const months = [];
for (let i = 0; i < 48; i += 1) {
  const d = new Date(Date.UTC(2021, i, 28));
  months.push({ date: d.toISOString().slice(0, 10), close: 100 + i });
}
const fiscal = [
  { asOf: '2020-12-31', eps: 10, bvps: 50 },
  { asOf: '2022-12-31', eps: 20, bvps: 60 },
];
const bands = computeBands(months, fiscal);
check('a band is produced when there is enough history', Boolean(bands.pe && bands.pbv));
check('the basis reports how many fiscal years it spans', bands.basis === 2, bands.basis);
check('mean, sd and the five levels are consistent',
  near(bands.pe.levels.plus1, bands.pe.mean + bands.pe.sd, 1e-12) &&
  near(bands.pe.levels.minus2, bands.pe.mean - 2 * bands.pe.sd, 1e-12));
check('the current multiple is the last point',
  near(bands.pe.current, bands.pe.points.at(-1).value, 1e-12));

// The point of rebuilding the series ourselves: a day in 2021 must be priced
// against the FY2020 earnings that had been reported, not the FY2022 figure.
const january = months.find((m) => m.date.startsWith('2021-01'));
const expected = january.close / 10;
check('no hindsight: a 2021 close uses the 2020 EPS',
  near(bands.pe.points.find((p) => p.date === january.date)?.value ?? -1, expected, 1e-12),
  `${bands.pe.points.find((p) => p.date === january.date)?.value} vs ${expected}`);

// A fiscal year end is not the day the numbers were published. `knownFrom`
// carries the filing date, and a close before it must not see that year yet.
const lagged = [
  { asOf: '2020-12-31', knownFrom: '2021-03-01', eps: 10, bvps: 50 },
  { asOf: '2022-12-31', knownFrom: '2023-03-01', eps: 20, bvps: 60 },
];
const lagBands = computeBands(months, lagged);
check('a close before the filing date is not priced on unpublished earnings',
  lagBands.pe.points.every((p) => p.date >= '2021-03-01'), lagBands.pe.points[0]?.date);
check('the first close after filing uses that fiscal year',
  near(lagBands.pe.points[0].value, months.find((m) => m.date === '2021-03-28').close / 10, 1e-12),
  lagBands.pe.points[0]?.value);

// The right-hand edge is today's multiple, not the last fiscal year's.
const overridden = computeBands(months, fiscal, { peCurrent: 5, pbvCurrent: 2 });
check('the current multiple can be overridden with trailing figures',
  near(overridden.pe.current, 5) && near(overridden.pbv.current, 2),
  `${overridden.pe.current} / ${overridden.pbv.current}`);
check('the override lands on the last date instead of adding a point',
  overridden.pe.points.length === bands.pe.points.length &&
  overridden.pe.points.at(-1).date === months.at(-1).date);
const noMultiple = computeBands(months, fiscal, { peCurrent: null });
check('negative trailing earnings report no multiple',
  noMultiple.pe.current === null && noMultiple.pe.z === null,
  `${noMultiple.pe.current} / ${noMultiple.pe.z}`);
check('the history is still shown when today has no multiple',
  noMultiple.pe.points.length > 0 && noMultiple.pe.mean > 0);

const tooShort = computeBands(months.slice(0, 5), fiscal);
check('a short history yields no band instead of a meaningless one', tooShort.pe === null);
check('no closes yields no band', computeBands([], fiscal).pe === null);
check('no positive EPS yields no band', computeBands(months, [{ asOf: '2020-12-31', eps: -1 }]).pe === null);

// A year that barely earned anything must not become a 2000x multiple and drag
// the whole band with it.
const trough = [
  { asOf: '2020-12-31', eps: 10, bvps: 50 },
  { asOf: '2022-12-31', eps: 0.05, bvps: 60 },
];
const capped = computeBands(months, trough);
check('a near-zero EPS year is skipped rather than plotted at 2000x',
  capped.pe.skipped > 0 && capped.pe.max <= 100, `${capped.pe.skipped} skipped, max ${capped.pe.max}`);
check('the skipped points are reported so the UI can say so',
  typeof capped.pe.skipped === 'number' && capped.pe.points.every((p) => p.value <= 100));

// ── Dividend basis ──────────────────────────────────────────────────────────

console.log('\n── Recurring dividend ──');

const asOf = new Date('2026-10-01T00:00:00Z');

// The exchange's yield is the dividend of the last completed fiscal year, not
// the last twelve months of cash: ICHI's 2026 interim is 0.45 against 0.55 a
// year earlier, so a rolling sum reads 1.00 while the exchange publishes 1.10.
const fyDividend = fiscalYearDividend(
  [{ fiscalYear: 2025, asOf: '2025-12-31' }],
  [
    { date: '2025-08-27', amount: 0.55 }, // interim for FY2025
    { date: '2026-03-13', amount: 0.55 }, // final for FY2025
    { date: '2026-08-26', amount: 0.45 }, // FY2026 interim, not this year
  ],
  new Date('2026-10-21T00:00:00Z'),
);
check('the fiscal-year dividend is the interim plus its final',
  near(fyDividend.amount, 1.1, 1e-9), fyDividend.amount);
check('the next year\'s interim is not mixed in', fyDividend.fiscalYear === 2025, fyDividend.fiscalYear);

check('a year whose final is not paid yet is not used',
  fiscalYearDividend(
    [{ fiscalYear: 2026, asOf: '2026-06-30' }],
    [{ date: '2026-09-01', amount: 1 }],
    new Date('2026-10-21T00:00:00Z'),
  ) === null);

const mega = sustainableDividend({
  years: [{ fiscalYear: 2025, asOf: '2025-12-31', dpsStatement: 1.6 }],
  dividends: [
    { date: '2025-08-27', amount: 0.8 },
    { date: '2026-03-09', amount: 0.8 },
    { date: '2026-08-26', amount: 0.85 },
  ],
  asOf: new Date('2026-10-21T00:00:00Z'),
});
check('the valuation uses the last fiscal year, not the last twelve months',
  near(mega.d0, 1.6, 1e-9), mega.d0);
check('the cash actually received is still reported',
  near(mega.ttm, 1.65, 1e-9), mega.ttm);
const withSpecial = sustainableDividend({
  years: [{ dpsStatement: 10 }],
  dividends: [
    { date: '2026-02-20', amount: 30 }, // one-off special
    { date: '2026-08-20', amount: 10 },
  ],
  asOf,
});
check('a special dividend is not capitalised into the perpetuity',
  near(withSpecial.d0, 10, 1e-9), withSpecial.d0);
check('the special is still reported as cash received', near(withSpecial.ttm, 40, 1e-9), withSpecial.ttm);
check('the special is flagged for the UI', withSpecial.hasSpecial === true);

// A raise that earnings paid for is not a special: BTG tripled its dividend
// (0.50 → 1.50) in the same year EPS went 1.27 → 3.46, a 43% payout. The
// statement lags by a year for an annual payer, so the old rule capped it at
// the previous rate and reported 2.50% for a 7.43% payer.
const funded = sustainableDividend({
  years: [{ fiscalYear: 2025, asOf: '2025-12-31', dpsStatement: 0.5 }],
  dividends: [
    { date: '2025-03-11', amount: 0.5 }, // the previous year's rate
    { date: '2026-03-10', amount: 1.5 },
  ],
  asOf: new Date('2026-10-21T00:00:00Z'),
  ttmEps: 3.46,
});
check('a dividend the earnings fund is followed, not capped',
  near(funded.d0, 1.5, 1e-9), funded.d0);
check('and it is not marked as a special', funded.hasSpecial === false);

const holdingCompany = sustainableDividend({
  years: [{ dpsStatement: 2.83 }], // inflated by dividends paid to minorities
  dividends: [{ date: '2026-03-01', amount: 0.66 }],
  asOf,
});
check('an inflated statement figure loses to the ex-date record',
  near(holdingCompany.d0, 0.66, 1e-9), holdingCompany.d0);

check('the statement alone is used when there is no ex-date record',
  near(sustainableDividend({ years: [{ dpsStatement: 1.5 }], dividends: [], asOf }).d0, 1.5));

// The statement can also be too small: a final paid after the year end leaves
// only an instalment behind. The trailing record is the only complete year.
const instalment = sustainableDividend({
  years: [{ dpsStatement: 0.3 }, { dpsStatement: 0.15 }, { dpsStatement: 0.004 }],
  dividends: [{ date: '2026-03-09', amount: 0.55 }],
  asOf,
});
check('a statement that is only an instalment does not cap the dividend',
  near(instalment.d0, 0.55, 1e-9), instalment.d0);

// And a genuine step-up is followed rather than treated as a special.
const raised = sustainableDividend({
  years: [{ dpsStatement: 0.55 }],
  dividends: [
    { date: '2025-08-08', amount: 0.25 },
    { date: '2026-03-31', amount: 0.35 },
    { date: '2026-08-04', amount: 0.4 },
  ],
  asOf,
});
check('a real raise is followed, not capped', near(raised.d0, 0.75, 1e-9), raised.d0);
check('a real raise is not flagged as a special', raised.hasSpecial === false);
check('no dividend at all reports zero',
  sustainableDividend({ years: [{}], dividends: [], asOf }).d0 === 0);
check('the trailing window is twelve months',
  near(trailingDividend([
    { date: '2026-01-15', amount: 1 },
    { date: '2024-01-15', amount: 5 },
  ], asOf), 1));

// ── Per-share definitions ───────────────────────────────────────────────────

console.log('\n── Per-share definitions ──');

// PTT's shape: the cash-flow line counts every baht leaving the group,
// including the share that went to minority owners of subsidiaries.
const ptt = deriveYears({
  '2025-12-31': {
    netIncome: 90_000,
    stockholdersEquity: 1_127_000,
    totalAssets: 3_500_000,
    totalRevenue: 2_900_000,
    totalDebt: 900_000,
    cashDividendsPaid: -1_100,
    dilutedEPS: 3.15,
    ordinarySharesNumber: 374,
  },
}, [{ date: new Date('2025-05-10'), amount: 2.2 }])[0];

check('the statement DPS is the group total divided by shares',
  near(ptt.dpsStatement, 1100 / 374, 1e-9), ptt.dpsStatement);
check('the reported DPS is what a holder actually received',
  near(ptt.dps, 2.2, 1e-9), ptt.dps);
check('the fiscal year end is not treated as the day of filing',
  ptt.knownFrom === '2026-03-31', ptt.knownFrom);

// The opposite shape: a cash-flow line that is incomplete rather than inflated
// (BANPU reports 0.02 against 0.55 actually paid). The ex-date record wins in
// both directions because it is the amount the exchange credited.
const banpu = deriveYears({
  '2025-12-31': { dilutedEPS: -0.1, ordinarySharesNumber: 4_000, cashDividendsPaid: -80 },
}, [{ date: new Date('2025-05-10'), amount: 0.55 }])[0];
check('a deflated statement figure does not win either',
  near(banpu.dps, 0.55, 1e-9), banpu.dps);
check('with no ex-date record the statement is the only source',
  near(deriveYears({ '2025-12-31': { dilutedEPS: 1, ordinarySharesNumber: 100, cashDividendsPaid: -50 } }, [])[0].dps, 0.5));

// A ratio against the closing balance flatters a shrinking company and punishes
// a growing one. The denominator is the average of the opening and closing
// balance, which is also the definition the exchange publishes.
const growing = deriveYears({
  '2024-12-31': { netIncome: 10, stockholdersEquity: 100, totalAssets: 200, dilutedEPS: 1, ordinarySharesNumber: 10 },
  '2025-12-31': { netIncome: 30, stockholdersEquity: 200, totalAssets: 300, dilutedEPS: 3, ordinarySharesNumber: 10 },
}, []);
check('ROE uses the average of opening and closing equity',
  near(growing[1].roe, 30 / 150, 1e-12), growing[1].roe);
check('ROA uses the average of opening and closing assets',
  near(growing[1].roa, 30 / 250, 1e-12), growing[1].roa);
check('the first year of a truncated history falls back to its closing balance',
  near(growing[0].roe, 10 / 100, 1e-12), growing[0].roe);

// A company that files in dollars: amounts and per-share figures are converted
// to the trading currency, ratios are not touched, and the ex-date dividend is
// already in the trading currency so it must not be converted twice.
const dollars = deriveYears({
  '2025-12-31': {
    netIncome: 10, stockholdersEquity: 100, totalAssets: 200, totalRevenue: 300,
    dilutedEPS: 1, ordinarySharesNumber: 10, cashDividendsPaid: -20,
  },
}, [{ date: new Date('2025-05-10'), amount: 6 }], { fx: 30 });
check('statement amounts are converted to the trading currency',
  near(dollars[0].netIncome, 300, 1e-9) && near(dollars[0].eps, 30, 1e-9),
  `${dollars[0].netIncome} / ${dollars[0].eps}`);
check('the statement DPS is converted with the rest',
  near(dollars[0].dpsStatement, 60, 1e-9), dollars[0].dpsStatement);
check('the ex-date dividend is already in the trading currency',
  near(dollars[0].dps, 6, 1e-9), dollars[0].dps);
check('ratios are currency-free and unchanged by the conversion',
  near(dollars[0].roe, 0.1, 1e-12) && near(dollars[0].npm, 10 / 300, 1e-12),
  `${dollars[0].roe} / ${dollars[0].npm}`);

// ── Quality score ───────────────────────────────────────────────────────────

console.log('\n── Quality score ──');

const year = (overrides = {}) => ({
  fiscalYear: 2022,
  asOf: '2022-12-31',
  netIncome: 100,
  equity: 500,
  assets: 1000,
  revenue: 700,
  totalDebt: 200,
  ebit: 120,
  interestExpense: 12,
  operatingCashFlow: 130,
  freeCashFlow: 80,
  eps: 2,
  dpsStatement: 1,
  dpsPaid: 1,
  shares: 50,
  roe: 0.2,
  roa: 0.1,
  npm: 0.15,
  de: 0.4,
  interestCoverage: 10,
  bvps: 10,
  ...overrides,
});
const years = [2022, 2023, 2024, 2025].map((fy) => year({
  fiscalYear: fy,
  asOf: `${fy}-12-31`,
}));
const dividends = ['2021', '2022', '2023', '2024', '2025', '2026'].map((y) => ({
  date: `${y}-06-01`,
  amount: 1,
}));

const healthy = scoreQuality({ years, dividends, price: 20, asOf });
check('a company that meets every rule scores 100', healthy.score === 100, healthy.score);
check('all eighteen rules are evaluated', healthy.total === 18, healthy.total);
check('nothing fails', healthy.failed === 0, healthy.failed);
check('the dividend streak is counted', healthy.streak >= 5, healthy.streak);

// Without the long history the three growth rules cannot be judged, so they
// stay out of both sides of the fraction rather than counting as failures.
check('a company with no long history is judged on the fifteen rules it has',
  healthy.evaluated === 15 && healthy.coverage < 1, `${healthy.evaluated} of ${healthy.total}`);

// ── Growth from the long history ─────────────────────────────────────────────
const longHistory = (eps, revenue, netIncome) => ({
  years: Array.from({ length: 10 }, (_, i) => ({
    fiscalYear: 2016 + i,
    netIncome: netIncome(i),
    revenue: revenue(i),
    eps: eps(i),
    npm: 0.2,
    de: 0.4,
  })),
});

const growthUp = scoreQuality({
  years,
  dividends,
  price: 20,
  asOf,
  history: longHistory((i) => 1 * 1.12 ** i, (i) => 100 * 1.06 ** i, () => 10),
});
const epsGrowth = growthUp.checks.find((c) => c.id === 'epsGrowth');
const revenueGrowth = growthUp.checks.find((c) => c.id === 'revenueGrowth');
const stability = growthUp.checks.find((c) => c.id === 'earningsStability');
check('a company that grows passes the growth rules',
  epsGrowth.pass === true && revenueGrowth.pass === true && stability.pass === true,
  JSON.stringify([epsGrowth.pass, revenueGrowth.pass, stability.pass]));
check('the growth rate is a compound annual rate over the calendar span',
  near(epsGrowth.value, 0.12, 1e-9), epsGrowth.value);
check('the growth rules are counted in the score',
  growthUp.evaluated === 18 && growthUp.coverage === 1, `${growthUp.evaluated}`);

const growthDown = scoreQuality({
  years,
  dividends,
  price: 20,
  asOf,
  history: longHistory((i) => 2 * 0.9 ** i, (i) => 200 * 0.97 ** i, (i) => (i > 6 ? -5 : 10)),
});
check('a company that shrinks fails the growth rules',
  growthDown.checks.find((c) => c.id === 'epsGrowth').pass === false &&
  growthDown.checks.find((c) => c.id === 'revenueGrowth').pass === false);
check('loss years are counted against the stability rule',
  growthDown.checks.find((c) => c.id === 'earningsStability').pass === false,
  JSON.stringify(growthDown.checks.find((c) => c.id === 'earningsStability')));

// A short history cannot answer a five-year question.
const shortHistory = scoreQuality({
  years,
  dividends,
  price: 20,
  asOf,
  history: { years: longHistory(() => 1, () => 1, () => 1).years.slice(0, 5) },
});
check('a history too short for the question is left unmeasured',
  shortHistory.checks.find((c) => c.id === 'revenueGrowth').pass === null &&
  shortHistory.checks.find((c) => c.id === 'earningsStability').pass === null);

// A company that lost money in the base year has no growth to measure, and
// that is a known answer rather than an unknown one: a turnaround must not be
// scored on a smaller denominator than a compounder and come out ahead.
const turnaround = scoreQuality({
  years,
  dividends,
  price: 20,
  asOf,
  history: longHistory((i) => (i === 6 ? -1 : 2 * 1.1 ** i), (i) => 100 * 1.06 ** i, () => 10),
});
const turnaroundCheck = turnaround.checks.find((c) => c.id === 'epsGrowth');
check('a loss year in the base is a known failure, not an unknown one',
  turnaroundCheck.pass === false && turnaroundCheck.value === null, JSON.stringify(turnaroundCheck));
check('and the growth rules still count against it',
  turnaround.evaluated === 18, `${turnaround.evaluated}`);

// Payout pairs the fiscal year's dividend with the fiscal year's earnings. A
// doubled trailing EPS does not change the dividend declared for the year or
// the profit earned in it; mixing the two periods reported PTT at 53% when its
// own FY2025 payout was 73% (2.30 / 3.15).
const fyPayout = scoreQuality({ years, dividends, price: 20, asOf, ttmEps: 4 });
const payoutCheck = fyPayout.checks.find((c) => c.id === 'payoutBand');
check('payout is measured against the same fiscal year\'s earnings',
  near(payoutCheck.value, 0.5, 1e-9), payoutCheck.value);
check('a payout of half the year\'s profit is inside the band', payoutCheck.pass === true);
check('and it is not marked as a warning', payoutCheck.warn !== true, JSON.stringify(payoutCheck));
const noTtmPayout = scoreQuality({ years, dividends, price: 20, asOf });
check('without trailing earnings the fiscal year is the fallback',
  near(noTtmPayout.checks.find((c) => c.id === 'payoutBand').value, 0.5, 1e-9),
  noTtmPayout.checks.find((c) => c.id === 'payoutBand').value);

// The ceiling without the floor: the same ratio, asked a different question.
// The band says whether this is an income case at all; the ceiling says
// whether the distribution can survive a bad year — and it decides
// membership only, never the score.
const ceilingCheck = (r) => r.checks.find((c) => c.id === 'payoutCeiling');
check('the payout ceiling passes a company paying half its profit',
  ceilingCheck(noTtmPayout).pass === true && near(ceilingCheck(noTtmPayout).value, 0.5, 1e-9),
  JSON.stringify(ceilingCheck(noTtmPayout)));
// The payout falls back to the fiscal year's own declared dividend over its
// EPS, so the statement doubles — the same profit, all of it paid out.
const overPaying = scoreQuality({
  years: years.map((y) => ({ ...y, dpsStatement: 2, dpsPaid: 2 })),
  dividends: dividends.map((d) => ({ ...d, amount: 2 })),
  price: 20,
  asOf,
});
check('the payout ceiling fails a company paying out all it earns',
  ceilingCheck(overPaying).pass === false && near(ceilingCheck(overPaying).value, 1, 1e-9),
  JSON.stringify(ceilingCheck(overPaying)));

// A bank: no meaningful interest expense, so the rule cannot be judged. It must
// come back neutral rather than failing a company for a metric that does not
// apply to it.
const bank = scoreQuality({
  years: years.map((y) => ({ ...y, interestExpense: null, interestCoverage: null })),
  dividends,
  price: 20,
  asOf,
  history: longHistory((i) => 1 * 1.12 ** i, (i) => 100 * 1.06 ** i, () => 10),
});
const bankIcr = bank.checks.find((c) => c.id === 'interestCoverage');
check('a bank is not failed for missing interest cover', bankIcr.pass === null, JSON.stringify(bankIcr));
check('an unevaluated rule still leaves the rest of the score intact', bank.score === 100, bank.score);
check('coverage reports how much of the framework applied', near(bank.coverage, 110 / 120, 1e-9), bank.coverage);

// A financial business as a whole. Leverage is its business model, operating
// cash flow is the movement in deposits and loans, and free cash flow after
// capex is an industrial measurement. All five rules must be left out of both
// sides of the score, and a mandatory one must not disqualify the name either.
const financial = scoreQuality({
  years,
  dividends,
  price: 20,
  asOf,
  isFinancial: true,
  history: longHistory((i) => 1 * 1.12 ** i, (i) => 100 * 1.06 ** i, () => 10),
});
const financialCheck = (id) => financial.checks.find((c) => c.id === id);
const industrial = ['debtLevel', 'interestCoverage', 'cfoPositive', 'cfoBeatsEarnings', 'fcfPositive'];
check('a financial is not scored on industrial leverage or cash flow',
  industrial.every((id) => financialCheck(id).pass === null && financialCheck(id).na === true),
  industrial.map((id) => `${id}:${financialCheck(id).pass}/${financialCheck(id).na}`).join(' '));
check('the score is built only from the rules that apply',
  near(financial.coverage, 80 / 120, 1e-9), financial.coverage);
const financialRow = { score: financial.score, checks: financial.checks, ddm: { mos: 20 } };
check('a mandatory rule that cannot apply does not disqualify a financial',
  applyPreset(financialRow, presetById('moat')).pass === true,
  applyPreset(financialRow, presetById('moat')).reason);
check('a mandatory rule that is merely unknown still disqualifies',
  applyPreset({ ...financialRow, checks: financial.checks.map((c) => (c.id === 'cfoPositive' ? { id: 'cfoPositive', pass: null } : c)) },
    presetById('moat')).pass === false);

const noDividend = scoreQuality({
  years: years.map((y) => ({ ...y, dpsStatement: null, dpsPaid: null })),
  dividends: [],
  price: 20,
  asOf,
});
check('no dividend is neutral, not a failure',
  noDividend.checks.find((c) => c.id === 'dividendYield').pass === null,
  JSON.stringify(noDividend.checks.find((c) => c.id === 'dividendYield')));
check('a strong non-payer still scores well', noDividend.score >= 70, noDividend.score);

const broken = scoreQuality({
  years: years.map((y) => ({
    ...y,
    netIncome: -50,
    equity: 100,
    totalDebt: 400,
    de: 4,
    ebit: 5,
    interestCoverage: 0.5,
    operatingCashFlow: -20,
    freeCashFlow: -30,
    eps: -1,
    roe: -0.1,
    roa: -0.05,
    npm: -0.2,
  })),
  dividends: [],
  price: 20,
  asOf,
});
check('a loss-making, over-levered company scores low', broken.score < 40, broken.score);
check('and fails several rules outright', broken.failed >= 5, broken.failed);

// ── Presets ─────────────────────────────────────────────────────────────────

console.log('\n── Presets ──');

const row = (overrides = {}) => ({
  score: 80,
  checks: [
    { id: 'roeLevel', pass: true },
    { id: 'roaLevel', pass: true },
    { id: 'fcfPositive', pass: true },
    { id: 'dividendStreak', pass: true },
    { id: 'cfoPositive', pass: true },
    { id: 'dividendYield', pass: true },
    { id: 'payoutBand', pass: true },
  ],
  ddm: { mos: 25 },
  ...overrides,
});
const moat = presetById('moat');
check('a passing row is kept', applyPreset(row(), moat).pass === true);

const thinYield = row({
  checks: row().checks.map((c) => (c.id === 'dividendYield' ? { id: 'dividendYield', pass: false } : c)),
});
check('the high-dividend preset refuses a name that barely pays',
  applyPreset(thinYield, moat).pass === false);
check('and says the yield was the reason',
  applyPreset(thinYield, moat).reason === 'requires:dividendYield');

const warnOnly = row({
  checks: row().checks.map((c) => (c.id === 'roeLevel' ? { id: 'roeLevel', pass: false, warn: true } : c)),
});
check('a "warn" does not satisfy a mandatory rule', applyPreset(warnOnly, moat).pass === false);
check('and says which rule stopped it', applyPreset(warnOnly, moat).reason === 'requires:roeLevel');

const unknown = row({
  checks: row().checks.map((c) => (c.id === 'roeLevel' ? { id: 'roeLevel', pass: null } : c)),
});
check('an unevaluated mandatory rule also blocks', applyPreset(unknown, moat).pass === false);

// The income preset — "sleep well". Its gates are the ones a bad year
// attacks: the return's consistency, the whole asset base, the cash, the
// record, the leverage, and the payout the company can keep paying.
const income = presetById('income');
const incomeRow = (overrides = {}) => row({
  checks: [
    ...row().checks,
    { id: 'roeConsistency', pass: true },
    { id: 'debtLevel', pass: true },
    { id: 'payoutCeiling', pass: true },
  ],
  ...overrides,
});
check('the income preset keeps a row that clears every gate',
  applyPreset(incomeRow(), income).pass === true);
const overPayer = incomeRow({
  checks: incomeRow().checks.map((c) => (c.id === 'payoutCeiling' ? { id: 'payoutCeiling', pass: false } : c)),
});
check('the income preset refuses a company paying more than it earns',
  applyPreset(overPayer, income).pass === false);
check('and says the payout ceiling was the reason',
  applyPreset(overPayer, income).reason === 'requires:payoutCeiling');

const value = presetById('value');
check('deep value refuses a name with no margin of safety',
  applyPreset(row({ ddm: { mos: null } }), value).pass === false);
check('deep value refuses a negative margin of safety',
  applyPreset(row({ ddm: { mos: -5 } }), value).pass === false);
check('deep value keeps a positive one', applyPreset(row({ ddm: { mos: 5 } }), value).pass === true);

check('the score floor is enforced',
  applyPreset(row({ score: 10 }), moat).pass === false);
check('the permissive preset keeps everything',
  applyPreset(row({ score: 0, checks: [] , ddm: { mos: null } }), presetById('all')).pass === true);

// ── Universe ────────────────────────────────────────────────────────────────

console.log('\n── Universe ──');

check('the curated list has entries', SET_LARGE_CAPS.length > 40, SET_LARGE_CAPS.length);
check('the curated list has no duplicates',
  new Set(SET_LARGE_CAPS).size === SET_LARGE_CAPS.length);
check('every ticker is a bare SET symbol',
  SET_LARGE_CAPS.every((s) => /^[A-Z0-9-]+$/.test(s)),
  SET_LARGE_CAPS.filter((s) => !/^[A-Z0-9-]+$/.test(s)).join(','));

check('SET100 has a hundred members', SET100.length === 100, SET100.length);
check('SET100 has no duplicates', new Set(SET100).size === SET100.length);
check('every SET100 ticker is a bare SET symbol',
  SET100.every((s) => /^[A-Z0-9-]+$/.test(s)),
  SET100.filter((s) => !/^[A-Z0-9-]+$/.test(s)).join(','));

// The live list comes from set.or.th; the parser is what has to be right when
// the exchange rebalances the index, so it is tested without the network.
const throws = (fn) => {
  try { fn(); return false; } catch { return true; }
};
const fixtures = Array.from({ length: 22 }, (_, i) => ({ symbol: `S${i}` }));
const parsed = parseComposition({
  composition: {
    stockInfos: [...fixtures, { symbol: 'ptt' }, { symbol: 'PTT' }, { symbol: '' }, { symbol: 'not a symbol' }],
  },
});
check('constituents are upper-cased and de-duplicated',
  parsed.includes('PTT') && parsed.filter((s) => s === 'PTT').length === 1, parsed.join(','));
check('junk symbols are dropped rather than sent to the screen',
  parsed.every((s) => /^[A-Z0-9-]{1,12}$/.test(s)));
check('a truncated payload is refused instead of shrinking the index',
  throws(() => parseComposition({ composition: { stockInfos: [{ symbol: 'PTT' }] } })));
check('a payload with no table is refused',
  throws(() => parseComposition({})));

// The cache is what makes a stale list harmless: one fetch, then the written
// copy until the TTL expires, and the written copy again if the exchange goes
// away. `fetch` is stubbed so the test never touches set.or.th.
const realFetch = globalThis.fetch;
const realNow = Date.now;
const fakeSymbols = Array.from({ length: 100 }, (_, i) => `T${i}`);
const fakeResponse = (json) => ({
  ok: true,
  headers: { getSetCookie: () => ['ak_bmsc=test; Path=/'] },
  json: async () => json,
});
let calls = 0;
const stubFetch = (ok = true) => async (url) => {
  calls += 1;
  if (!ok) return { ok: false, status: 403, headers: { getSetCookie: () => [] }, json: async () => ({}) };
  if (String(url).includes('/composition')) {
    return fakeResponse({ composition: { stockInfos: fakeSymbols.map((symbol) => ({ symbol })) } });
  }
  return fakeResponse({});
};

globalThis.fetch = stubFetch(true);
clearConstituentCache();
const written = ['WRITTEN'];
const first = constituents('set100', written);
check('an empty cache answers with the written list', first === written, first.join(','));
await refresh('set100');
const live = constituents('set100', written);
check('the exchange list replaces the written one once it lands',
  live.length === 100 && live[0] === 'T0', `${live.length}`);

const before = calls;
check('a list inside the TTL is served without another request',
  constituents('set100', written) === live && calls === before, `${calls - before} extra`);

// Past the TTL the reader still gets the cached list, and a refresh starts.
Date.now = () => realNow() + 13 * 60 * 60 * 1000;
check('a stale list is still served while it refreshes',
  constituents('set100', written) === live);
await refresh('set100');
check('the refresh after the TTL goes back to the exchange', calls > before, calls);
const afterTtl = constituents('set100', written);

// Failure path: keep the last good list, never throw.
const realWarn = console.warn;
console.warn = () => {};
globalThis.fetch = stubFetch(false);
Date.now = () => realNow() + 26 * 60 * 60 * 1000;
const failed = await refresh('set100');
console.warn = realWarn;
check('a failed refresh resolves quietly', failed === null, failed);
Date.now = realNow;
check('and the last good list stays in use', constituents('set100', written) === afterTtl);
globalThis.fetch = realFetch;

// ── Long annual history ──────────────────────────────────────────────────────
console.log('\n── Long annual history ──');

// The annual row is the one flagged `quarter === 9`; the three-month rows must
// not be summed with it or the year double-counts.
const rows = [
  { fiscal: 2024, quarter: 1, net_profit: '1', revenue: '10', npm: '5', debt_to_equity: '0.5', end_of_year_date: '2024-12-31' },
  { fiscal: 2024, quarter: 2, net_profit: '2', revenue: '20', npm: '6', debt_to_equity: '0.6' },
  { fiscal: 2024, quarter: 9, net_profit: '7', revenue: '70', gross_profit: '42', gpm: '60', npm: '7', debt_to_equity: '0.7', end_of_year_date: '2024-12-31' },
  { fiscal: 2025, quarter: 9, net_profit: '8', revenue: '80', gross_profit: '40', gpm: '50', npm: '8', debt_to_equity: '0.8', end_of_year_date: '2025-12-31' },
];
const annual = aggregateAnnual(rows);
check('only the annual row is kept, and the year is not double-counted',
  annual.length === 2 && annual[0].netIncome === 7 && annual[0].revenue === 70, JSON.stringify(annual));
check('a margin reported as a percentage becomes a fraction',
  annual[0].npm === 0.07 && annual[1].npm === 0.08, `${annual[0].npm}`);
check('the gross profit and its margin come through as amounts and a fraction',
  annual[0].grossProfit === 42 && annual[0].gpm === 0.6 && annual[1].gpm === 0.5,
  `${annual[0].grossProfit}/${annual[0].gpm}`);
// The upstream prints the revenue itself where the cost-of-sales line is
// missing — SCB read exactly 100% for nine years running — and prints figures
// outside (0, 1) where the line has been mangled. None of them is a margin, and
// a negative one would not fit an axis that starts at zero, so the year is left
// blank rather than drawn: the placeholder also sets the axis, so one bad year
// would squash every real bar beside it.
const unreportable = [
  { fiscal: 2016, quarter: 9, revenue: '100', gross_profit: '100' },
  { fiscal: 2017, quarter: 9, revenue: '100', gross_profit: '104' },
  { fiscal: 2018, quarter: 9, revenue: '100', gross_profit: '-20' },
  { fiscal: 2019, quarter: 9, revenue: '100', gross_profit: '0' },
].map((r) => aggregateAnnual([r])[0]);
check('a gross line the arithmetic cannot support leaves the year blank',
  unreportable.every((y) => y.gpm == null && y.grossProfit == null),
  JSON.stringify(unreportable.map((y) => y.gpm)));
check('a gross line of zero is a cost as wide as the revenue, not a margin',
  unreportable[3].gpm == null);
check('a year the upstream leaves the line out of has no margin, not a zero',
  aggregateAnnual([{ fiscal: 2023, quarter: 9, revenue: '10', net_profit: '1' }])[0].gpm == null);
check('the years come back in order',
  annual[0].fiscalYear === 2024 && annual[1].fiscalYear === 2025);
check('empty input yields no years', aggregateAnnual([]).length === 0);

// The quarters are kept apart, so a chart can stack them.
const quarters = aggregateQuarterly(rows);
check('the three-month rows are kept per year, in order',
  quarters.length === 1 && quarters[0].quarters.length === 2
    && quarters[0].quarters[0].quarter === 1 && quarters[0].quarters[1].quarter === 2,
  JSON.stringify(quarters));
check('the annual row is not one of the quarters',
  !quarters[0].quarters.some((q) => q.quarter === 9));
check('a quarter carries its own margin and leverage',
  quarters[0].quarters[0].npm === 0.05 && quarters[0].quarters[0].de === 0.5);
check('no quarters means no groups', aggregateQuarterly([]).length === 0);

const finnomenaFetch = (ok = true) => async (url) => {
  const u = String(url);
  if (!ok) return { ok: false, status: 500, json: async () => ({}) };
  if (u.includes('/stock/list')) {
    return { ok: true, status: 200, json: async () => ({ data: Array.from({ length: 100 }, (_, i) => ({
      name: `T${i}`,
      security_id: `id-${i}`,
    })) }) };
  }
  if (u.includes('/stock/summary/')) {
    const years = Array.from({ length: 16 }, (_, i) => ({
      fiscal: 2010 + i,
      quarter: 9,
      net_profit: String(1000 + i),
      revenue: String(10000 + i),
      earning_per_share: '1',
      npm: '10',
      debt_to_equity: '0.5',
      end_of_year_date: `${2010 + i}-12-31`,
    }));
    const quarters = Array.from({ length: 16 }, (_, i) => [1, 2, 3, 4].map((q) => ({
      fiscal: 2010 + i,
      quarter: q,
      net_profit: String(250 + i),
      revenue: String(2500 + i),
      earning_per_share: '0.25',
      npm: '10',
      debt_to_equity: '0.5',
    }))).flat();
    return { ok: true, status: 200, json: async () => ({ data: [...quarters, ...years] }) };
  }
  return { ok: true, status: 200, json: async () => ({ data: [] }) };
};

// The tracked file is the first source: the deploy boots from it, and it
// answers whatever the upstream refuses.
const tmpDir = await mkdtemp(join(tmpdir(), 'annual-history-'));
const tmpFile = join(tmpDir, 'annual-history.json');
await writeFile(tmpFile, JSON.stringify({
  symbols: {
    ZZZ: {
      years: [[2020, 5, 50, 1, 0.1, 0.2]],
      quarters: [[2020, 1, 1, 10, 0.25, 0.1, 0.2]],
    },
    // The object form carries the gross margin the charts draw, as a fraction
    // — the same way the margin it has always carried is stored.
    YYY: {
      years: [{ y: 2021, np: 3, rev: 30, gp: 18, npm: 0.1, gpm: 0.6, de: 0.4 }],
      quarters: [],
    },
  },
}), 'utf8');
process.env.ANNUAL_HISTORY_FILE = tmpFile;
clearFinnomenaCache();
globalThis.fetch = finnomenaFetch(true);
const fromFile = await annualHistory('SET:ZZZ');
check('the tracked file answers before the network',
  fromFile?.years.length === 1 && fromFile.years[0].fiscalYear === 2020
    && fromFile.years[0].netIncome === 5 && fromFile.quarters.length === 1,
  JSON.stringify(fromFile));
check('the object form reads back its gross profit and margin',
  (await annualHistory('SET:YYY'))?.years[0]?.grossProfit === 18
    && (await annualHistory('SET:YYY'))?.years[0]?.gpm === 0.6,
  JSON.stringify((await annualHistory('SET:YYY'))?.years));
check('the file carries the quarters too, grouped by year',
  fromFile?.quarters[0]?.fiscalYear === 2020 && fromFile?.quarters[0]?.quarters[0]?.quarter === 1
    && fromFile?.quarters[0]?.quarters[0]?.netIncome === 1,
  JSON.stringify(fromFile?.quarters));

// A symbol the file does not have falls through to the live API.
process.env.ANNUAL_HISTORY_FILE = join(tmpDir, 'not-here.json');
clearFinnomenaCache();
const live7 = await annualHistory('SET:T7');
check('a symbol the file does not have comes from the live API',
  live7?.years.length === HISTORY_YEARS && live7.years[0].fiscalYear === 2016
    && live7.years.at(-1).fiscalYear === 2025,
  live7 ? `${live7.years.length} years` : 'null');
check('and the quarters come with it',
  live7?.quarters.length === HISTORY_YEARS && live7.quarters[0].quarters.length === 4,
  live7 ? `${live7.quarters.length} groups` : 'null');
check('a symbol the source does not carry resolves to null',
  (await annualHistory('SET:NOPE')) === null);

globalThis.fetch = finnomenaFetch(false);
clearFinnomenaCache();
check('a failed request resolves to null rather than throwing',
  (await annualHistory('SET:T7')) === null);
check('and the failure is reported for the health endpoint',
  finnomenaStatus().live.ok === false && !!finnomenaStatus().live.error);
globalThis.fetch = realFetch;
delete process.env.ANNUAL_HISTORY_FILE;
clearFinnomenaCache();

// ── Peer percentiles ────────────────────────────────────────────────────────
console.log('\n── Peer percentiles ──');

const peerRows = [
  { name: 'A', roe: 0.30, pe: 20 },
  { name: 'B', roe: 0.20, pe: 10 },
  { name: 'C', roe: 0.10, pe: 30 },
];
const p = peerPercentiles(peerRows, [{ key: 'roe', better: 'high', get: (r) => r.roe }]);
check('the best name in the group reads 100', p.get(peerRows[0]).roe === 100, p.get(peerRows[0]).roe);
check('the worst reads 0', p.get(peerRows[2]).roe === 0, p.get(peerRows[2]).roe);
check('the middle reads 50', p.get(peerRows[1]).roe === 50, p.get(peerRows[1]).roe);

const pl = peerPercentiles(peerRows, [{ key: 'pe', better: 'low', get: (r) => r.pe }]);
check('a lower multiple is the better one when the measure is a multiple',
  pl.get(peerRows[1]).pe === 100 && pl.get(peerRows[2]).pe === 0,
  `${pl.get(peerRows[1]).pe}/${pl.get(peerRows[2]).pe}`);

// A tie is half a place: the name beats nobody and matches one, out of two.
const tied = [{ v: 10 }, { v: 10 }, { v: 20 }];
const pt = peerPercentiles(tied, [{ key: 'v', better: 'high', get: (r) => r.v }]);
check('a tie counts as half a place', pt.get(tied[0]).v === 25, pt.get(tied[0]).v);
check('and the name alone on top still reads 100', pt.get(tied[2]).v === 100, pt.get(tied[2]).v);

// A sector with too few names in it is not a peer group.
const small = [
  { g: 'A', v: 1 }, { g: 'A', v: 2 },
  { g: 'B', v: 3 }, { g: 'B', v: 4 }, { g: 'B', v: 5 },
];
const ps = peerPercentiles(
  small,
  [{ key: 'v', better: 'high', get: (r) => r.v }],
  { groupBy: (r) => r.g, minGroup: 3 },
);
check('a group below the floor gets no percentile', ps.get(small[0]).v == null, ps.get(small[0]).v);
check('a group above the floor is compared', ps.get(small[4]).v === 100, ps.get(small[4]).v);
check('and its worst reads 0', ps.get(small[2]).v === 0, ps.get(small[2]).v);

// A name with no value for the measure is left out of that comparison.
const missing = [{ v: 10 }, { v: null }, { v: 20 }, { v: 30 }];
const pm = peerPercentiles(missing, [{ key: 'v', better: 'high', get: (r) => r.v }]);
check('a name with no value is given no percentile', pm.get(missing[1]).v == null, pm.get(missing[1]).v);
check('and the rest are compared with each other',
  pm.get(missing[3]).v === 100 && pm.get(missing[0]).v === 0,
  `${pm.get(missing[0]).v}/${pm.get(missing[3]).v}`);

// Names with no sector are not a group of their own.
const noGroup = [
  { g: '', v: 1 }, { g: '', v: 2 }, { g: '', v: 3 },
  { g: 'B', v: 4 }, { g: 'B', v: 5 }, { g: 'B', v: 6 },
];
const pg = peerPercentiles(
  noGroup,
  [{ key: 'v', better: 'high', get: (r) => r.v }],
  { groupBy: (r) => r.g, minGroup: 3 },
);
check('names with no sector are not compared with each other',
  pg.get(noGroup[0]).v == null, pg.get(noGroup[0]).v);

// ── The price's unit against the earnings' unit ─────────────────────────────
console.log('\n── Units ──');

// Shell's London line is priced in pence and its earnings are in pounds, so
// a multiple built from one and the other is out by a hundred. The quote's own
// trailing multiple is the only figure that knows the units.
check('a price in pence against earnings in pounds is a hundred apart',
  unitGap(3910, 4.69, 11.57) === 100, unitGap(3910, 4.69, 11.57));
check('a thousand-fold unit is caught as well', unitGap(1000, 1, 1) === 1000);
check('a multiple that differs a little is not a unit gap',
  unitGap(100, 10, 10.5) === 1, unitGap(100, 10, 10.5));
check('a multiple that differs by a round factor but not enough is left alone',
  unitGap(100, 10, 8) === 1, unitGap(100, 10, 8));

// ── The reader's own conditions ─────────────────────────────────────────────
console.log('\n── Filters ──');

const filterRows = [
  { bare: 'A', score: 90, roe3: 0.25, pe: 10, ddm: { mos: 30 } },
  { bare: 'B', score: 70, roe3: 0.12, pe: 20, ddm: { mos: -5 } },
  { bare: 'C', score: 80, roe3: null, pe: 8, ddm: { mos: 10 } },
];
const one = applyFilters(filterRows, [{ field: 'roe3', op: '>=', value: 0.15 }]);
check('a name that clears the condition stays', one[0].pass === true);
check('a name that does not is rejected', one[1].pass === false);
check('a name with no value cannot clear a condition', one[2].pass === false, JSON.stringify(one[2]));
check('the reason names the measure', one[1].reason === 'filter:roe3', one[1].reason);

const two = applyFilters(filterRows, [
  { field: 'roe3', op: '>=', value: 0.15 },
  { field: 'pe', op: '<', value: 12 },
]);
check('every condition has to be cleared', two[0].pass === true && two[1].pass === false, JSON.stringify(two.map((v) => v.pass)));

const unknownField = applyFilters(filterRows, [{ field: 'nonsense', op: '>=', value: 1 }]);
check('a field the server does not know is ignored', unknownField.every((v) => v.pass));
check('no conditions leaves every name alone',
  applyFilters(filterRows, []).every((v) => v.pass));

// ── Audit regressions ──────────────────────────────────────────────────────
console.log('\n── Audit regressions ──');

// 1. Negative equity must not read as low leverage. THAI's insolvency years
// produced a negative D/E, which a `de <= 1.0` rule would have passed.
const negativeEquity = deriveYears({
  '2025-12-31': {
    netIncome: -10,
    totalRevenue: 100,
    totalDebt: 50,
    stockholdersEquity: -20,
    totalAssets: 100,
    dilutedEPS: -0.5,
    ordinarySharesNumber: 20,
  },
}, []);
check('negative equity leaves debt/equity unknown',
  negativeEquity[0].de === null && negativeEquity[0].negativeEquity === true,
  JSON.stringify(negativeEquity[0]));
check('negative equity leaves ROE unknown', negativeEquity[0].roe === null);

// 2. An EPS whose sign disagrees with the profit is not a per-share figure.
// TU 2023 reports a 13.9bn loss alongside a positive 1.21 "EPS" (core).
const epsSign = deriveYears({
  '2025-12-31': {
    netIncome: -100,
    totalRevenue: 100,
    stockholdersEquity: 50,
    totalAssets: 200,
    dilutedEPS: 1,
    ordinarySharesNumber: 100,
  },
}, []);
check('an EPS with the wrong sign is not used',
  epsSign[0].eps === null && epsSign[0].epsConflict === true,
  JSON.stringify(epsSign[0]));

// 3. An EPS that implies a share count wildly different from the statement's
// own share count is a data error, not growth (DELTA 2016/2020/2022).
const epsSize = deriveYears({
  '2025-12-31': {
    netIncome: 100,
    totalRevenue: 1000,
    stockholdersEquity: 500,
    totalAssets: 1000,
    dilutedEPS: 1,
    ordinarySharesNumber: 1000,
  },
}, []);
check('an EPS implying a different share count is not used',
  epsSize[0].eps === null && epsSize[0].epsConflict === true,
  JSON.stringify(epsSize[0]));

// 4. Growth uses the long history for revenue and profit, but only the
// reconciled Yahoo years for EPS. The old buildRow passed `trusted` (four
// years) as the growth history, so revenueGrowth (6y) and earningsStability
// (8y) were null for every company even though the ten-year file had them.
const growthYahoo = [2022, 2023, 2024, 2025].map((fy, i) => year({
  fiscalYear: fy,
  asOf: `${fy}-12-31`,
  eps: 2 * 1.1 ** i,
  netIncome: 100 * 1.1 ** i,
  revenue: 1000 * 1.06 ** i,
}));
const growthFile = Array.from({ length: 10 }, (_, i) => {
  const fy = 2016 + i;
  return {
    fiscalYear: fy,
    asOf: `${fy}-12-31`,
    eps: 2 * 1.1 ** (fy - 2022),
    netIncome: 100 * 1.1 ** (fy - 2022),
    revenue: 1000 * 1.06 ** (fy - 2022),
    de: 0.4,
  };
});
const growthFin = {
  symbol: 'SET:GROWTH',
  bare: 'GROWTH',
  name: 'Growth fixture',
  currency: 'THB',
  price: 30,
  priceDate: '2026-10-01',
  closes: [],
  dividends: ['2022', '2023', '2024', '2025', '2026'].map((y) => ({ date: `${y}-06-01`, amount: 1 })),
  years: growthYahoo,
  ttm: { eps: 2 * 1.1 ** 3, epsAsOf: '2026-06-30', epsBasis: 'trailing', bvps: 10, bvpsAsOf: '2026-06-30' },
  isFinancial: false,
  dataIssue: null,
};
const growthRow = buildRow(growthFin, { history: { years: growthFile } });
const growthCheck = (id) => growthRow.checks.find((c) => c.id === id);
check('buildRow uses the long history for revenue growth',
  growthCheck('revenueGrowth')?.pass !== null
  && near(growthCheck('revenueGrowth')?.value, 0.06, 0.005),
  JSON.stringify(growthCheck('revenueGrowth')));
check('buildRow uses the long history for earnings stability',
  growthCheck('earningsStability')?.pass === true,
  JSON.stringify(growthCheck('earningsStability')));
check('buildRow uses the Yahoo years for EPS growth',
  growthCheck('epsGrowth')?.pass !== null
  && near(growthCheck('epsGrowth')?.value, 0.1, 0.01),
  JSON.stringify(growthCheck('epsGrowth')));

// 5. A missing required check is UNKNOWN, not a failed rule.
const incomePreset = presetById('income');
const unknownRow = {
  score: 60,
  checks: incomePreset.requires.map((id) => ({
    id,
    pass: id === 'payoutCeiling' ? null : true,
  })),
};
const unknownVerdict = applyPreset(unknownRow, incomePreset);
check('a missing required check is labelled unknown',
  unknownVerdict.pass === false && unknownVerdict.reason === 'unknown:payoutCeiling',
  JSON.stringify(unknownVerdict));

// 6. A reader's filter on a missing value is UNKNOWN, not a fail.
const unknownFilter = applyFilters([{ pe: null }], [{ field: 'pe', op: '<', value: 15 }]);
check('a filter on a missing value is labelled unknown',
  unknownFilter[0].pass === false && unknownFilter[0].reason === 'unknown:pe',
  JSON.stringify(unknownFilter[0]));

// 7. A special dividend is estimated from the non-special instalment growth,
// not from the lagged cash-flow figure. ADVANC FY2025: 6.89 + 27.41 (the
// 19.00 special), prior year 4.87 + 5.74, official regular 15.30.
const advancDividend = sustainableDividend({
  years: [2022, 2023, 2024, 2025].map((fy) => ({
    fiscalYear: fy,
    asOf: `${fy}-12-31`,
    dpsStatement: fy === 2025 ? 12.63 : 9,
  })),
  dividends: [
    { date: '2024-08-19', amount: 4.87 },
    { date: '2025-02-20', amount: 5.74 },
    { date: '2025-08-19', amount: 6.89 },
    { date: '2026-02-27', amount: 27.41 },
    { date: '2026-08-19', amount: 8.69 },
  ],
  asOf: new Date('2026-10-23T00:00:00Z'),
  ttmEps: 18,
});
check('a special dividend is capped at the estimated recurring rate',
  advancDividend.hasSpecial === true && near(advancDividend.d0, 15.01, 0.02),
  JSON.stringify(advancDividend));

// 8. The payout denominator is the year the dividend belongs to, not the last
// row. MC has a 2026 stub with no EPS yet; the FY2025 payout is 0.96 / 0.96 =
// 100%, which is over the ceiling and is a fail, not an unknown.
const stubYears = [
  year({ fiscalYear: 2024, asOf: '2024-12-31', eps: 0.9, netIncome: 90, revenue: 1000 }),
  year({ fiscalYear: 2025, asOf: '2025-12-31', eps: 0.96, netIncome: 96, revenue: 1000, dpsStatement: 0.96, dpsPaid: 0.96 }),
  year({ fiscalYear: 2026, asOf: '2026-06-30', eps: null, netIncome: 70, revenue: 1000, dpsStatement: null, dpsPaid: 0.52 }),
];
const stubDividends = [
  { date: '2024-09-01', amount: 0.9 },
  { date: '2025-09-01', amount: 0.96 },
];
const stubScore = scoreQuality({
  years: stubYears,
  dividends: stubDividends,
  price: 10,
  asOf: new Date('2026-10-23T00:00:00Z'),
  ttmEps: 0.96,
});
const stubPayout = stubScore.checks.find((c) => c.id === 'payoutCeiling');
check('the payout uses the fiscal year the dividend belongs to',
  near(stubScore.payout, 1, 1e-9), JSON.stringify(stubScore.payout));
check('a payout over the ceiling fails even when a later stub has no EPS',
  stubPayout.pass === false, JSON.stringify(stubPayout));

// 9. The back-test's headline compounds overlapping windows; the mean window
// is reported beside it so a 3-year holding period is not read as a 12-year
// compound.
const overlapping = [
  [{ date: '2019-03-31', symbol: 'A', name: 'A', score: 100, forwardTotal: 0.1, checks: [], yield: 0.05, mos: 10, price: 10, intrinsic: 12 }],
  [{ date: '2020-03-31', symbol: 'A', name: 'A', score: 100, forwardTotal: 0.1, checks: [], yield: 0.05, mos: 10, price: 10, intrinsic: 12 }],
];
const overlappingTotals = summariseBacktest(overlapping, 'quality').totals;
check('overlapping windows are compounded and also reported as a mean',
  near(overlappingTotals.portfolio, 0.21, 1e-9)
  && near(overlappingTotals.portfolioMean, 0.1, 1e-9),
  JSON.stringify(overlappingTotals));

// ── The back test ───────────────────────────────────────────────────────────
console.log('\n── Back test ──');

check('a fiscal year is usable from its end plus the filing lag',
  publishedOn({ fiscalYear: 2020, asOf: '2020-12-31' }) === '2021-03-31',
  publishedOn({ fiscalYear: 2020, asOf: '2020-12-31' }));
check('a September year end is usable from December',
  publishedOn({ fiscalYear: 2020, asOf: '2020-09-30' }) === '2020-12-29',
  publishedOn({ fiscalYear: 2020, asOf: '2020-09-30' }));

const schedule = rebalanceDates([2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025], 3);
check('the rebalance dates run from the fourth year to the last with room to hold',
  schedule.length === 4 && schedule[0] === '2019-03-31' && schedule.at(-1) === '2022-03-31',
  schedule.join(','));

// A company judged on what had been published, and not on what came later.
const hist = [2016, 2017, 2018, 2019, 2020].map((y) => ({
  fiscalYear: y,
  asOf: `${y}-12-31`,
  netIncome: 1000,
  revenue: 10000,
  eps: 1,
  npm: 0.1,
  de: 0.5,
  roe: 0.2,
  roa: 0.1,
  operatingCashFlow: 1200,
  totalDebt: 500,
  equity: 5000,
  assets: 9000,
  dividendYield: 0.04,
  close: 10,
}));
const closes = [];
for (let y = 2015; y <= 2025; y += 1) closes.push({ date: `${y}-03-31`, close: y === 2022 ? 20 : 10 });
const obs = backtestCompany({
  history: hist,
  dividends: [],
  closes,
  rebalances: ['2019-03-31'],
  holdYears: 3,
});
check('the company is judged at the rebalance date', obs.length === 1, JSON.stringify(obs.length));
check('the forward return is the price three years later', obs[0]?.forward === 1, obs[0]?.forward);
check('the rules saw the years that had been published',
  obs[0]?.checks.find((c) => c.id === 'roeLevel')?.pass === true,
  JSON.stringify(obs[0]?.checks.find((c) => c.id === 'roeLevel')));

// The summary: the two groups, and the portfolio against the universe.
// The other company earns a tenth of the profit, so it fails the return rule,
// and its price goes nowhere, so the two groups earned different amounts.
const other = backtestCompany({
  history: hist.map((y) => ({ ...y, netIncome: 100 })),
  dividends: [],
  closes: closes.map((c) => ({ ...c, close: 10 })),
  rebalances: ['2019-03-31'],
  holdYears: 3,
});
const summary = summariseBacktest([...obs, ...other], 'quality');
const roeRow = summary.rules.find((r) => r.id === 'roeLevel');
check('the rule is scored on the two groups', roeRow?.passed === 1 && roeRow?.failed === 1, JSON.stringify(roeRow));
check('the edge is the difference between them', roeRow?.edge === 1, roeRow?.edge);
check('the portfolio is compared with the universe',
  summary.totals.periods === 1 && summary.totals.names === 2, JSON.stringify(summary.totals));

// ── Two sources, one set of filings ──────────────────────────────────────────
console.log('\n── Reconciling the sources ──');

const ours = [{ fiscalYear: 2025, netIncome: 100, de: 0.5 }];
const theirs = [{ fiscalYear: 2025, netIncome: 102, de: 1.2 }];
check('a year the two sources agree on is kept', reconcileYears(ours, theirs).length === 1);
check('the leverage is read the way the exchange reads it',
  reconcileYears(ours, theirs)[0].de === 1.2, reconcileYears(ours, theirs)[0].de);
check('a year whose profit has the wrong sign is left out',
  reconcileYears([{ fiscalYear: 2025, netIncome: 100, de: 0.5 }],
    [{ fiscalYear: 2025, netIncome: -100, de: 1.2 }]).length === 0);
check('a year one source has and the other does not is kept',
  reconcileYears([{ fiscalYear: 2024, netIncome: 100, de: 0.5 }],
    [{ fiscalYear: 2025, netIncome: 102, de: 1.2 }]).length === 1);
check('a zero in one source is missing information, not a contradiction',
  reconcileYears([{ fiscalYear: 2025, netIncome: 100, de: 0.5 }],
    [{ fiscalYear: 2025, netIncome: 0, de: 1.2 }]).length === 1);
check('a company with no statements cannot be scored',
  scoreQuality({ years: [], dividends: [{ date: '2025-06-01', amount: 1 }], price: 20, asOf }).score === 0);

// ── Two things a rule cannot see on its own ─────────────────────────────────
console.log('\n── Warnings ──');

// A profit that did not turn into cash.
const oneOffYears = [2022, 2023, 2024, 2025].map((fy) => year({
  fiscalYear: fy,
  asOf: `${fy}-12-31`,
  netIncome: 1000,
  operatingCashFlow: 200,
}));
const oneOff = scoreQuality({ years: oneOffYears, dividends, price: 20, asOf });
check('a profit with no cash behind it is flagged',
  oneOff.checks.find((c) => c.id === 'cfoBeatsEarnings')?.oneOff === true,
  JSON.stringify(oneOff.checks.find((c) => c.id === 'cfoBeatsEarnings')));

// Earnings per share can grow while the profit does not, if the company is
// buying its own stock back.
const buybackYears = [2022, 2023, 2024, 2025].map((fy, i) => year({
  fiscalYear: fy,
  asOf: `${fy}-12-31`,
  netIncome: 1000,
  eps: 2 + i * 0.27,
  shares: 50 - i * 5,
}));
const buyback = scoreQuality({ years: buybackYears, dividends, price: 20, asOf });
check('growth that came from buying shares back is flagged',
  buyback.checks.find((c) => c.id === 'epsGrowth')?.buyback === true,
  JSON.stringify(buyback.checks.find((c) => c.id === 'epsGrowth')));

// ── The money ───────────────────────────────────────────────────────────────
console.log('\n── The portfolio ──');

// A price path a hand can follow: two names, a flat price and a rising one,
// with a dividend on the way.
const pathCloses = {
  'SET:AAA': [
    { date: '2020-01-02', close: 10 },
    { date: '2020-02-03', close: 10 },
    { date: '2020-03-02', close: 10 },
    { date: '2020-04-01', close: 10 },
    { date: '2020-05-04', close: 10 },
  ],
  'SET:BBB': [
    { date: '2020-01-02', close: 20 },
    { date: '2020-02-03', close: 25 },
    { date: '2020-03-02', close: 30 },
    { date: '2020-04-01', close: 30 },
    { date: '2020-05-04', close: 30 },
  ],
};
const pathDividends = {
  'SET:AAA': [{ date: '2020-03-10', amount: 1 }],
  'SET:BBB': [],
};
const pathPicks = [
  { symbol: 'SET:AAA', price: 10, intrinsic: 20 },
  { symbol: 'SET:BBB', price: 20, intrinsic: 20 },
];

// All at once: 100,000 split evenly. AAA stays at 10 and pays 1 a share, so
// 5,000 units are worth 50,000 plus 5,000 of dividend; BBB goes from 20 to 30,
// so 2,500 units are worth 75,000.
const lump = simulatePeriod({
  picks: pathPicks, closesBySymbol: pathCloses, dividendsBySymbol: pathDividends,
  from: '2020-01-02', to: '2020-05-04', capital: 100000, monthly: 1000,
});
check('all at once buys on the first day',
  near(lump.lump.value, 50000 + 5000 + 75000, 1e-6) && near(lump.lump.deployed, 100000, 1e-6),
  JSON.stringify(lump.lump));

// A slice a month: 1,000 a month into each name, five months, so 10,000 goes
// to work and 90,000 is still sitting in cash.
const dca = simulatePeriod({
  picks: pathPicks, closesBySymbol: pathCloses, dividendsBySymbol: pathDividends,
  from: '2020-01-02', to: '2020-05-04', capital: 100000, monthly: 1000,
});
check('a slice a month buys every month, not on the first day',
  near(dca.dca.deployed, 10000, 1e-6) && near(dca.dca.cash, 90000, 1e-6),
  JSON.stringify(dca.dca));

// Waiting: BBB is above its value of 20 from February on, so it is never
// bought; AAA is below its value of 20 the whole way.
const wait = simulatePeriod({
  picks: pathPicks, closesBySymbol: pathCloses, dividendsBySymbol: pathDividends,
  from: '2020-01-02', to: '2020-05-04', capital: 100000, monthly: 1000,
  thresholds: { 'SET:AAA': 20, 'SET:BBB': 20 },
});
check('waiting buys only what fell to the price worth paying',
  wait.wait.deployed > 0 && wait.wait.deployed < dca.dca.deployed,
  JSON.stringify(wait.wait));

// The dividends are the reader's money: the same holding, with and without.
const withDividends = simulatePeriod({
  picks: pathPicks, closesBySymbol: pathCloses, dividendsBySymbol: pathDividends,
  from: '2020-01-02', to: '2020-05-04', capital: 100000, monthly: 1000,
});
const withoutDividends = simulatePeriod({
  picks: pathPicks, closesBySymbol: pathCloses, dividendsBySymbol: {},
  from: '2020-01-02', to: '2020-05-04', capital: 100000, monthly: 1000,
});
check('the dividends are counted as cash',
  withDividends.lump.value > withoutDividends.lump.value,
  `${withDividends.lump.value} vs ${withoutDividends.lump.value}`);

// ── The names being followed ────────────────────────────────────────────────
console.log('\n── The tracked list ──');

const trackedFile = join(tmpdir(), `tracked-test-${Date.now()}.json`);
const trackedStore = new TrackedStore(trackedFile);
await trackedStore.load();
check('a new list is empty', trackedStore.list().length === 0);
const added = trackedStore.save({ symbol: 'SET:BH', name: 'Bumrungrad', note: 'watching the yield', at: { price: 190, pe: 20 } });
check('a name is added with its numbers', added.symbol === 'SET:BH' && added.at.pe === 20, JSON.stringify(added));
trackedStore.update(added.id, { status: 'bought', note: 'bought at 190' });
check('a name can be marked and annotated',
  trackedStore.get(added.id).status === 'bought' && trackedStore.get(added.id).note === 'bought at 190');
check('the same name is not added twice', trackedStore.findBySymbol('set:bh')?.id === added.id);
trackedStore.save({ symbol: 'SET:MEGA' });
check('a second name joins the list', trackedStore.list().length === 2);
trackedStore.remove(added.id);
check('a name can be removed', trackedStore.list().length === 1);
trackedStore.replaceAll([{ symbol: 'SET:PTT' }, { symbol: '' }]);
check('a backup replaces the list, and a nameless entry is dropped',
  trackedStore.list().length === 1 && trackedStore.list()[0].symbol === 'SET:PTT', JSON.stringify(trackedStore.list()));

// ── Routes (no upstream calls) ──────────────────────────────────────────────

console.log('\n── Routes ──');

const req = async (method, path, body) => {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let parsed = null;
  try { parsed = JSON.parse(text); } catch { parsed = text; }
  return { status: res.status, body: parsed };
};

try {
  const universe = await req('GET', '/api/screener/universe');
  check('universe responds', universe.status === 200, universe.status);
  check('every universe carries symbols',
    Array.isArray(universe.body.lists) &&
    universe.body.lists.every((l) => Array.isArray(l.symbols) && l.symbols.length > 0));
  check('the static SET list is offered',
    universe.body.lists.some((l) => l.id === 'set-large'));
  const set100 = universe.body.lists.find((l) => l.id === 'set100');
  check('SET100 is offered with about a hundred symbols',
    Boolean(set100) && set100.symbols.length >= 95 && set100.symbols.length <= 105,
    set100?.symbols.length);
  check('the run cap is published',
    Number.isInteger(universe.body.maxSymbols) && universe.body.maxSymbols > 0,
    universe.body.maxSymbols);

  const empty = await req('POST', '/api/screener/run', {});
  check('a run with no symbols is a 400', empty.status === 400, empty.status);
  check('and says what was missing',
    empty.body?.error?.code === 'BAD_REQUEST', JSON.stringify(empty.body));

  const unknownUniverse = await req('POST', '/api/screener/run', { universe: 'nope' });
  check('an unknown universe is a 400', unknownUniverse.status === 400, unknownUniverse.status);

  const tooMany = await req('POST', '/api/screener/run', {
    symbols: Array.from({ length: 500 }, (_, i) => `SET:X${i}`),
  });
  check('an oversized run is refused', tooMany.status === 400, tooMany.status);

  const noSymbol = await req('GET', '/api/screener/stock');
  check('stock detail without a symbol is a 400', noSymbol.status === 400, noSymbol.status);
} catch (err) {
  check('screener routes are reachable', false, err.message);
}

console.log(`\n${failures ? `${failures} check(s) failed` : 'all screener checks passed'}\n`);
process.exit(failures ? 1 : 0);
