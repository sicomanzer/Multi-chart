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
  marginOfSafety,
  presetById,
  scoreQuality,
  sustainableDividend,
  trailingDividend,
} from '../server/screener.js';
import { SET_LARGE_CAPS } from '../server/screener-run.js';
import { deriveYears } from '../server/fin.js';

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

const holdingCompany = sustainableDividend({
  years: [{ dpsStatement: 2.83 }], // inflated by dividends paid to minorities
  dividends: [{ date: '2026-03-01', amount: 0.66 }],
  asOf,
});
check('an inflated statement figure loses to the ex-date record',
  near(holdingCompany.d0, 0.66, 1e-9), holdingCompany.d0);

check('the statement alone is used when there is no ex-date record',
  near(sustainableDividend({ years: [{ dpsStatement: 1.5 }], dividends: [], asOf }).d0, 1.5));
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
  ptt.knownFrom === '2026-03-01', ptt.knownFrom);

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
