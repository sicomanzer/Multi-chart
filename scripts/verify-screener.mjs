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
  applyPreset,
  computeBands,
  ddm,
  fiscalYearDividend,
  marginOfSafety,
  presetById,
  scoreQuality,
  sustainableDividend,
  trailingDividend,
} from '../server/screener.js';
import { DEFAULTS, SET_LARGE_CAPS, SET100 } from '../server/screener-run.js';
import { clearConstituentCache, constituents, parseComposition, refresh } from '../server/setindex.js';
import { deriveYears } from '../server/fin.js';
import { aggregateAnnual, annualHistory, clearFinnomenaCache, HISTORY_YEARS } from '../server/finnomena.js';

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
check('all fourteen rules are evaluated', healthy.total === 14, healthy.total);
check('nothing fails', healthy.failed === 0, healthy.failed);
check('the dividend streak is counted', healthy.streak >= 5, healthy.streak);

// Payout pairs trailing cash with trailing earnings. On a doubled trailing EPS
// the same dividend is 25% of profit, not the 50% the fiscal-year lines imply.
const ttmPayout = scoreQuality({ years, dividends, price: 20, asOf, ttmEps: 4 });
const payoutCheck = ttmPayout.checks.find((c) => c.id === 'payoutBand');
check('payout is measured against trailing earnings',
  near(payoutCheck.value, 0.25, 1e-9), payoutCheck.value);
check('a payout that thin fails the framework band', payoutCheck.pass === false);
check('and earns no half credit for being thin', payoutCheck.warn !== true, JSON.stringify(payoutCheck));
const noTtmPayout = scoreQuality({ years, dividends, price: 20, asOf });
check('without trailing earnings the fiscal year is the fallback',
  near(noTtmPayout.checks.find((c) => c.id === 'payoutBand').value, 0.5, 1e-9),
  noTtmPayout.checks.find((c) => c.id === 'payoutBand').value);

// A bank: no meaningful interest expense, so the rule cannot be judged. It must
// come back neutral rather than failing a company for a metric that does not
// apply to it.
const bank = scoreQuality({
  years: years.map((y) => ({ ...y, interestExpense: null, interestCoverage: null })),
  dividends,
  price: 20,
  asOf,
});
const bankIcr = bank.checks.find((c) => c.id === 'interestCoverage');
check('a bank is not failed for missing interest cover', bankIcr.pass === null, JSON.stringify(bankIcr));
check('an unevaluated rule still leaves the rest of the score intact', bank.score === 100, bank.score);
check('coverage reports how much of the framework applied', near(bank.coverage, 0.9, 1e-9), bank.coverage);

// A financial business as a whole. Leverage is its business model, operating
// cash flow is the movement in deposits and loans, and free cash flow after
// capex is an industrial measurement. All five rules must be left out of both
// sides of the score, and a mandatory one must not disqualify the name either.
const financial = scoreQuality({ years, dividends, price: 20, asOf, isFinancial: true });
const financialCheck = (id) => financial.checks.find((c) => c.id === id);
const industrial = ['debtLevel', 'interestCoverage', 'cfoPositive', 'cfoBeatsEarnings', 'fcfPositive'];
check('a financial is not scored on industrial leverage or cash flow',
  industrial.every((id) => financialCheck(id).pass === null && financialCheck(id).na === true),
  industrial.map((id) => `${id}:${financialCheck(id).pass}/${financialCheck(id).na}`).join(' '));
check('the score is built only from the rules that apply',
  near(financial.coverage, 0.6, 1e-9), financial.coverage);
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
  { fiscal: 2024, quarter: 9, net_profit: '7', revenue: '70', npm: '7', debt_to_equity: '0.7', end_of_year_date: '2024-12-31' },
  { fiscal: 2025, quarter: 9, net_profit: '8', revenue: '80', npm: '8', debt_to_equity: '0.8', end_of_year_date: '2025-12-31' },
];
const annual = aggregateAnnual(rows);
check('only the annual row is kept, and the year is not double-counted',
  annual.length === 2 && annual[0].netIncome === 7 && annual[0].revenue === 70, JSON.stringify(annual));
check('a margin reported as a percentage becomes a fraction',
  annual[0].npm === 0.07 && annual[1].npm === 0.08, `${annual[0].npm}`);
check('the years come back in order',
  annual[0].fiscalYear === 2024 && annual[1].fiscalYear === 2025);
check('empty input yields no years', aggregateAnnual([]).length === 0);

const finnomenaFetch = (ok = true) => async (url) => {
  const u = String(url);
  if (!ok) return { ok: false, status: 500, json: async () => ({}) };
  if (u.includes('/stock/list')) {
    return { ok: true, status: 200, json: async () => ({ data: Array.from({ length: 100 }, (_, i) => ({
      name: i === 0 ? 'BH' : `T${i}`,
      security_id: `id-${i}`,
    })) }) };
  }
  if (u.includes('/stock/summary/id-0')) {
    return { ok: true, status: 200, json: async () => ({ data: Array.from({ length: 16 }, (_, i) => ({
      fiscal: 2010 + i,
      quarter: 9,
      net_profit: String(1000 + i),
      revenue: String(10000 + i),
      earning_per_share: '1',
      npm: '10',
      debt_to_equity: '0.5',
      end_of_year_date: `${2010 + i}-12-31`,
    })) }) };
  }
  return { ok: true, status: 200, json: async () => ({ data: [] }) };
};

globalThis.fetch = finnomenaFetch(true);
clearFinnomenaCache();
const bh = await annualHistory('SET:BH');
check('the symbol map resolves the ticker to an id and returns history',
  bh?.length === HISTORY_YEARS && bh[0].fiscalYear === 2016 && bh.at(-1).fiscalYear === 2025,
  bh ? `${bh.length} years` : 'null');
check('a symbol the source does not carry resolves to null',
  (await annualHistory('SET:NOPE')) === null);

globalThis.fetch = finnomenaFetch(false);
clearFinnomenaCache();
check('a failed request resolves to null rather than throwing',
  (await annualHistory('SET:BH')) === null);
globalThis.fetch = realFetch;

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
