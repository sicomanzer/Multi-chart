/**
 * The screening engine.
 *
 * Three independent pieces, kept apart on purpose so each can be tested and
 * explained on its own:
 *
 *   scoreQuality()  Arjan Kavee's rules, as pass/fail checks with a 0-100 score
 *   ddm()           two-stage dividend discount model and margin of safety
 *   computeBands()  the stock's own P/E and P/BV history, as a normal band
 *
 * Everything here is pure: no I/O, no clock, no cache. `screen()` in
 * screener-run.js is the part that fetches. That split is what makes the
 * numbers reproducible — a row can be recomputed from its inputs and will come
 * out identical.
 */

/**
 * Rule weights, summing to 100.
 *
 * The split follows the framework: quality of the business first (40), then
 * whether it can survive a bad year (20), then whether the profit is real cash
 * (20), and only then what it pays out (20). A high dividend on a business that
 * fails the first three is the trap the framework is built to avoid, so yield
 * alone can never carry a name into the result set.
 */
const WEIGHTS = {
  roeLevel: 12,
  roeConsistency: 8,
  roaLevel: 6,
  npmLevel: 6,
  npmTrend: 4,
  npmPositive: 4,
  debtLevel: 10,
  interestCoverage: 10,
  cfoPositive: 8,
  cfoBeatsEarnings: 6,
  fcfPositive: 6,
  dividendYield: 7,
  payoutBand: 6,
  dividendStreak: 7,
};

/** Below this the name is filtered out of the stricter presets. */
export const MIN_SCORE = 55;

const pct = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function average(values) {
  const usable = values.filter((v) => typeof v === 'number' && Number.isFinite(v));
  if (usable.length === 0) return null;
  return usable.reduce((a, b) => a + b, 0) / usable.length;
}

/** Last N fiscal years, oldest first. */
function recent(years, n) {
  return years.slice(-n);
}

/**
 * Cash dividends received over the last twelve months.
 *
 * This is a fact, not a forecast: it is what a holder of the stock would have
 * been paid, specials included.
 */
export function trailingDividend(dividends, asOf = new Date()) {
  const cutoff = new Date(asOf);
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - 1);
  return dividends
    .filter((d) => new Date(d.date) > cutoff && new Date(d.date) <= asOf)
    .reduce((sum, d) => sum + d.amount, 0);
}

/** Shift a date by whole months, clamping the day to the target month. */
function addMonths(date, months) {
  const day = date.getUTCDate();
  const shifted = new Date(date.getTime());
  shifted.setUTCDate(1);
  shifted.setUTCMonth(shifted.getUTCMonth() + months);
  const last = new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, 0)).getUTCDate();
  shifted.setUTCDate(Math.min(day, last));
  return shifted;
}

/** Cash dividends with an ex-date in `(from, to]`. */
function sumDividends(dividends, from, to) {
  return dividends
    .filter((d) => {
      const t = new Date(d.date);
      return t > from && t <= to;
    })
    .reduce((sum, d) => sum + d.amount, 0);
}

/**
 * The dividend declared for the latest completed fiscal year.
 *
 * This is the figure the exchange publishes as "dividend yield": one fiscal
 * year's dividend over today's price. A fiscal year is paid in two halves — the
 * interim inside the year, the final in the first months after it — so the
 * window is the twelve months centred on the year end, and it is complete once
 * the final has been paid (roughly six months later).
 *
 * A plain trailing-twelve-month sum is not the same number, and the difference
 * is not small. It mixes the *next* year's interim with the current year's
 * final: ICHI read 1.00 (0.55 final + 0.45 interim) where the exchange
 * publishes 1.10 (0.55 + 0.55), and every company that moves its interim date
 * makes the rolling figure drift by half a year's growth.
 *
 * Returns null when no fiscal year is old enough for its final to have been
 * paid, or when the statements carry no year end at all (test fixtures).
 */
export function fiscalYearDividend(years, dividends, asOf = new Date()) {
  const complete = years.filter((y) => {
    const end = y.asOf ? new Date(y.asOf) : null;
    return end && Number.isFinite(end.getTime()) && addMonths(end, 6) <= asOf;
  });
  const year = complete.at(-1);
  if (!year) return null;
  const end = new Date(year.asOf);
  const from = addMonths(end, -6);
  const to = addMonths(end, 6);
  return {
    fiscalYear: year.fiscalYear ?? null,
    from,
    to,
    amount: sumDividends(dividends, from, to),
  };
}

/**
 * The dividend to value, as opposed to the dividend that was just paid.
 *
 * The anchor is the fiscal-year figure above, because that is the one the
 * exchange and the company's own annual report quote, and because it is a
 * clean year rather than a window that slides across two of them.
 *
 * The exception is a one-off. ADVANC's 2026 record contains a 27.41 special on
 * top of the usual 8.69 instalment — real cash, and the price really did gap on
 * the ex-date — and a two-stage model that capitalises it into a perpetuity
 * would value ADVANC as if the special repeated every year forever, which is
 * how a screen produces absurd margins of safety.
 *
 * So the fiscal-year figure is used unless it spikes against both the annual
 * statement and the same window a year earlier; then the smaller of the two is
 * used and `hasSpecial` tells the UI why.
 */
export function sustainableDividend({ years, dividends, asOf = new Date() }) {
  const last = years.at(-1);
  const ttm = trailingDividend(dividends, asOf);
  const fy = fiscalYearDividend(years, dividends, asOf);

  // An empty fiscal-year window means the statements themselves are stale, not
  // that the company stopped paying: GULF's last full year is FY2024 and its
  // 3.25 was paid in March 2026, after that window closed. There the trailing
  // record is the only figure that knows a dividend was paid at all.
  const annual = fy && fy.amount > 0 ? fy.amount : ttm;
  // The same window a year earlier, so a one-off can be told from a new rate.
  const prior = fy
    ? sumDividends(dividends, addMonths(fy.from, -12), addMonths(fy.to, -12))
    : trailingDividend(dividends, new Date(asOf.getTime() - 365 * 86_400_000));

  // The annual cash-flow line is only an anchor when it looks like a full year
  // of distributions. A company that pays its final after the year end leaves a
  // figure that is an instalment, not a year — STECON paid 0.55 in March 2026
  // against a FY2025 line of 0.004 — and taking the minimum against it reported
  // a 0.02% yield for a 4.7% payer. A statement far below the company's own
  // recent history is ignored rather than trusted.
  const history = years
    .map((y) => y.dpsStatement)
    .filter((v) => typeof v === 'number' && v > 0)
    .sort((a, b) => a - b);
  const typical = history.length ? history[Math.floor(history.length / 2)] : null;
  const fromStatement = last?.dpsStatement != null && last.dpsStatement > 0
    && (typical == null || last.dpsStatement >= typical * 0.5)
    ? last.dpsStatement
    : null;

  // A spike has to clear both the statement and the same window a year earlier
  // — one of them alone is often just a timing difference.
  const inflated = fromStatement != null && annual > fromStatement * 1.5;
  const spiked = prior > 0 && annual > prior * 1.5;
  const special = annual > 0 && inflated && (prior === 0 || spiked);

  const d0 = special ? Math.min(annual, fromStatement) : annual || fromStatement || 0;

  return {
    d0,
    ttm,
    annual,
    fiscalYear: fy?.fiscalYear ?? null,
    fromStatement,
    // Worth flagging in the UI: the cash received was well above the recurring rate.
    hasSpecial: special,
  };
}

/**
 * Consecutive calendar years with a dividend, counting back from the most
 * recent year that paid one.
 *
 * A gap ends the streak — that is the whole point. MINT skipped 2020-2022 and
 * must not be credited with a long record just because the years either side
 * were generous.
 */
function dividendStreak(dividends, asOf = new Date()) {
  if (!dividends.length) return 0;
  const yearsPaid = new Set(dividends.map((d) => Number(d.date.slice(0, 4))));
  let year = asOf.getUTCFullYear();
  // The current year may simply not have gone ex yet; that is not a suspension.
  if (!yearsPaid.has(year)) year -= 1;
  let streak = 0;
  while (yearsPaid.has(year)) {
    streak += 1;
    year -= 1;
  }
  return streak;
}

/**
 * Two-stage dividend discount model.
 *
 *   P0 = Σ D0(1+g1)^t / (1+r)^t  for t = 1..n
 *      + D0(1+g1)^n (1+g2) / ((r - g2)(1+r)^n)
 *
 * Returns a `reason` instead of a number when the inputs cannot support a
 * valuation — no dividend, or a discount rate at or below terminal growth,
 * which makes the perpetuity negative or infinite. A screen that quietly
 * printed `Infinity` there would rank those names first, so it prints nothing.
 */
export function ddm({ d0, g1, g2 = 0.03, r = 0.09, years = 5 }) {
  const safe = {
    d0: Number(d0),
    g1: Number(g1),
    g2: Number(g2),
    r: Number(r),
    years: Math.max(1, Math.min(20, Math.round(Number(years) || 5))),
  };
  if (!Number.isFinite(safe.d0) || safe.d0 <= 0) {
    return { ok: false, reason: 'no-dividend', intrinsic: null, mos: null };
  }
  if (!Number.isFinite(safe.r) || !Number.isFinite(safe.g2) || safe.r <= safe.g2) {
    return { ok: false, reason: 'r-not-above-g2', intrinsic: null, mos: null };
  }

  let present = 0;
  for (let t = 1; t <= safe.years; t += 1) {
    present += (safe.d0 * Math.pow(1 + safe.g1, t)) / Math.pow(1 + safe.r, t);
  }
  const terminal =
    (safe.d0 * Math.pow(1 + safe.g1, safe.years) * (1 + safe.g2)) /
    ((safe.r - safe.g2) * Math.pow(1 + safe.r, safe.years));

  const intrinsic = present + terminal;
  if (!Number.isFinite(intrinsic) || intrinsic <= 0) {
    return { ok: false, reason: 'not-computable', intrinsic: null, mos: null };
  }
  return {
    ok: true,
    intrinsic,
    presentValue: present,
    terminalValue: terminal,
    inputs: safe,
  };
}

/** Margin of safety against a price, in percent of intrinsic value. */
export function marginOfSafety(intrinsic, price) {
  if (!Number.isFinite(intrinsic) || !Number.isFinite(price) || intrinsic <= 0 || price <= 0) {
    return null;
  }
  return ((intrinsic - price) / intrinsic) * 100;
}

/**
 * Multiples beyond these are not valuation observations.
 *
 * A company that earned 0.05 baht a share is not "trading at 300 times
 * earnings" in any useful sense — the denominator is noise around zero, and one
 * such year drags the mean and the standard deviation far enough that every
 * other year looks cheap by comparison. BANPU's band read a mean of 175× and a
 * −2σ level below zero; the honest answer is that its earnings were too close to
 * zero for a multiple to describe it. Points above the cap are counted and
 * reported rather than silently dropped.
 */
const MAX_MULTIPLE = { pe: 100, pbv: 50 };

/**
 * Historical P/E and P/BV band.
 *
 * The series is rebuilt from the statements rather than taken from a data
 * provider: for each trading day, the multiple is `close / EPS` (or `close /
 * BVPS`) using the most recently *published* fiscal year as of that date. That
 * is what an investor at the time could actually have known — using the final
 * year's number across the whole window would fold hindsight into the bands
 * and make every stock look expensive in the past.
 *
 * `knownFrom` on a year is the day its statements became public (fiscal year
 * end plus a filing lag), which is not the same as the day the period ended.
 * Falling back to `asOf` keeps hand-built rows working.
 *
 * `peCurrent` / `pbvCurrent` replace the last point with today's multiple on
 * trailing earnings and the latest quarter's book value. The history is annual
 * because that is the only comparable series we have; the right-hand edge has
 * to be the number on the screen today, or the chart's "now" would be a year
 * old.
 *
 * `basis` reports how many fiscal years of earnings the window spans, so the
 * UI can say "4y" rather than implying a decade.
 */
export function computeBands(closes, years, { peCurrent, pbvCurrent } = {}) {
  const usable = years.filter(
    (y) => typeof y.eps === 'number' && Number.isFinite(y.eps) && y.eps > 0 &&
      typeof y.asOf === 'string',
  );
  if (closes.length === 0 || usable.length === 0) {
    return { pe: null, pbv: null, basis: 0 };
  }

  const known = (y) => y.knownFrom ?? y.asOf;
  const pe = [];
  const pbv = [];
  let peSkipped = 0;
  let pbvSkipped = 0;
  for (const point of closes) {
    const applicable = usable.filter((y) => known(y) <= point.date).at(-1);
    if (!applicable) continue;
    if (applicable.eps > 0) {
      const value = point.close / applicable.eps;
      if (value <= MAX_MULTIPLE.pe) pe.push({ date: point.date, value });
      else peSkipped += 1;
    }
    if (typeof applicable.bvps === 'number' && applicable.bvps > 0) {
      const value = point.close / applicable.bvps;
      if (value <= MAX_MULTIPLE.pbv) pbv.push({ date: point.date, value });
      else pbvSkipped += 1;
    }
  }

  const basis = usable.length;
  return {
    pe: summarise(pe, basis, peCurrent, peSkipped, MAX_MULTIPLE.pe),
    pbv: summarise(pbv, basis, pbvCurrent, pbvSkipped, MAX_MULTIPLE.pbv),
    basis,
  };
}

function summarise(points, basis, currentOverride, skipped = 0, cap = Infinity) {
  if (points.length < 20) return null;
  // The override belongs on the last day, not appended as a second point for
  // the same session — the chart draws one dot per date. It is left out of the
  // statistics when it is itself above the cap, so today's odd denominator
  // cannot distort the band it is being compared against.
  const inBand = typeof currentOverride === 'number' && Number.isFinite(currentOverride) &&
    currentOverride <= cap;
  const series = inBand
    ? [...points.slice(0, -1), { ...points.at(-1), value: currentOverride }]
    : points;
  const values = series.map((p) => p.value).sort((a, b) => a - b);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
  const sd = Math.sqrt(variance);
  // `null` means today has no multiple at all (a loss); a number above the cap
  // is still reported as today's multiple, it just does not join the band.
  let current;
  if (currentOverride === null) current = null;
  else if (typeof currentOverride === 'number' && Number.isFinite(currentOverride)) current = currentOverride;
  else current = series[series.length - 1].value;

  return {
    basis,
    points: downsample(series, 160),
    mean,
    sd,
    min: values[0],
    max: values[values.length - 1],
    median: quantile(values, 0.5),
    current,
    z: current == null || sd === 0 ? null : (current - mean) / sd,
    skipped,
    cap: Number.isFinite(cap) ? cap : null,
    levels: {
      plus2: mean + 2 * sd,
      plus1: mean + sd,
      mean,
      minus1: mean - sd,
      minus2: mean - 2 * sd,
    },
  };
}

function quantile(sorted, q) {
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  if (sorted[base + 1] === undefined) return sorted[base];
  return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
}

/** Keep the shape of the series without shipping thousands of points. */
function downsample(points, max) {
  if (points.length <= max) return points;
  const step = points.length / max;
  const out = [];
  for (let i = 0; i < max; i += 1) out.push(points[Math.floor(i * step)]);
  if (out[out.length - 1] !== points[points.length - 1]) out.push(points[points.length - 1]);
  return out;
}

/**
 * Score one company against the framework.
 *
 * Each check carries its own `pass` (and `warn` where the framework allows a
 * softer bound), the measured value and the threshold, so the scorecard in the
 * UI can explain *why* a row scored what it did instead of just printing a
 * number. A check that cannot be evaluated — a bank has no meaningful interest
 * coverage, a company has no dividend — passes as `null`, neither earning nor
 * losing points, so a missing data point never masquerades as a red flag.
 *
 * `isFinancial` goes further: for a bank, insurer or consumer lender the
 * leverage and cash-flow rules are not merely unmeasured, they measure the
 * wrong thing. Those checks are marked `na` and skipped by the score and by
 * presets, while a check that is `null` for lack of data stays strict.
 */
export function scoreQuality({
  years,
  dividends,
  price,
  asOf = new Date(),
  ttmEps = null,
  isFinancial = false,
}) {
  const last3 = recent(years, 3);
  const last4 = recent(years, 4);
  const checks = [];
  const add = (id, pass, value, threshold, extra = {}) => {
    checks.push({ id, pass, value, threshold, ...extra });
  };

  const roe3 = average(last3.map((y) => y.roe));
  add('roeLevel', roe3 != null ? roe3 >= 0.15 : null, roe3, 0.15);

  const roeKnown = last4.map((y) => y.roe);
  const roeYearsAbove = roeKnown.filter((v) => typeof v === 'number' && v >= 0.15).length;
  const roeComplete = roeKnown.length > 0 && roeKnown.every((v) => typeof v === 'number');
  add('roeConsistency', roeComplete ? roeYearsAbove >= Math.min(3, last4.length) : null,
    roeYearsAbove, Math.min(3, last4.length), { of: last4.length });

  const roa3 = average(last3.map((y) => y.roa));
  add('roaLevel', roa3 != null ? roa3 >= 0.07 : null, roa3, 0.07);

  const npm3 = average(last3.map((y) => y.npm));
  add('npmLevel', npm3 != null ? npm3 >= 0.10 : null, npm3, 0.10);

  const npmSeries = last4.map((y) => y.npm).filter((v) => typeof v === 'number');
  const npmTrend = npmSeries.length >= 2 ? npmSeries[npmSeries.length - 1] - npmSeries[0] : null;
  add('npmTrend', npmTrend != null ? npmTrend >= 0 : null, npmTrend, 0);

  // Every one of the last three years profitable — "consistently", not "on
  // average". A year the source has no net income for is unknown, not a loss:
  // treating it as one turned a gap in Yahoo's history into a red flag.
  const income3 = last3.map((y) => y.netIncome);
  const incomeComplete = income3.length === 3 && income3.every((v) => typeof v === 'number');
  add('npmPositive', incomeComplete ? income3.every((v) => v > 0) : null,
    income3.filter((v) => typeof v === 'number' && v > 0).length, income3.length, { of: last3.length });

  const de = years.at(-1)?.de ?? null;
  // 1.5 is the framework's allowance for capital-intensive utilities; `warn`
  // keeps a 1.2 name visible without pretending it passed the strict bound.
  //
  // A lender's leverage is its business model, and the debt line Yahoo reports
  // for one is not even the funding: KBANK's deposits sit outside `totalDebt`,
  // so the ratio reads 0.38 where the exchange publishes 5.77. Scoring that
  // would hand every bank ten free points and tell the reader nothing.
  add('debtLevel', isFinancial ? null : de != null ? de <= 1.0 : null, de, 1.0,
    { warn: !isFinancial && de != null && de <= 1.5, ...(isFinancial ? { na: true } : {}) });

  const icr = years.at(-1)?.interestCoverage ?? null;
  add('interestCoverage', isFinancial ? null : icr != null ? icr >= 3 : null, icr, 3,
    isFinancial ? { na: true } : {});

  // Operating cash flow at a bank is the movement in deposits and loans, and at
  // an insurer it is the movement in reserves. It is not a measure of the
  // business earning cash, and neither is "free" cash flow after capex.
  const cfo3 = last3.map((y) => y.operatingCashFlow);
  const cfoComplete = cfo3.length === 3 && cfo3.every((v) => typeof v === 'number');
  add('cfoPositive', isFinancial ? null : cfoComplete ? cfo3.every((v) => v > 0) : null,
    cfo3.filter((v) => typeof v === 'number' && v > 0).length, cfo3.length,
    { of: last3.length, ...(isFinancial ? { na: true } : {}) });

  const cfoBeatsKnown = last3.filter(
    (y) => typeof y.operatingCashFlow === 'number' && typeof y.netIncome === 'number' &&
      y.netIncome > 0 && y.operatingCashFlow > y.netIncome,
  ).length;
  const cfoBeatsComplete = last3.length === 3 && last3.every(
    (y) => typeof y.operatingCashFlow === 'number' && typeof y.netIncome === 'number',
  );
  add('cfoBeatsEarnings', isFinancial ? null : cfoBeatsComplete
    ? cfoBeatsKnown >= Math.min(2, last3.length) : null,
  cfoBeatsKnown, Math.min(2, last3.length),
  { of: last3.length, ...(isFinancial ? { na: true } : {}) });

  const fcfKnown = last4.map((y) => y.freeCashFlow);
  const fcfComplete = fcfKnown.length > 0 && fcfKnown.every((v) => typeof v === 'number');
  const fcfPositive = fcfKnown.filter((v) => typeof v === 'number' && v > 0).length;
  add('fcfPositive', isFinancial || !fcfComplete ? null
    : fcfPositive >= Math.max(1, last4.length - 1),
  fcfPositive, Math.max(1, last4.length - 1),
  { of: last4.length, ...(isFinancial ? { na: true } : {}) });

  const dividend = sustainableDividend({ years, dividends, asOf });
  const dividendYield = price > 0 && dividend.d0 > 0 ? dividend.d0 / price : null;
  add('dividendYield', dividendYield != null ? dividendYield >= 0.04 : null, dividendYield, 0.04,
    {
      special: dividend.hasSpecial,
      ttmYield: price > 0 ? dividend.ttm / price : null,
      fy: dividend.fiscalYear,
    });

  const last = years.at(-1);
  // Paying more than 70% of profit is flagged even though it still passes the
  // "is it being paid" question — the framework wants room to reinvest.
  //
  // The ratio pairs trailing cash with trailing earnings. Mixing a fiscal-year
  // numerator with a fiscal-year denominator looked tidy but was wrong twice
  // over: `dividendsPaid` carries the minority owners' share (PTT read 93%
  // against a true 70%) and a dividend declared in March is paid out of the
  // previous year's profit, so the two lines described different years.
  const paidPerShare = last?.dps ?? last?.dpsStatement ?? last?.dpsPaid ?? null;
  const payout = ttmEps > 0 && dividend.d0 > 0
    ? dividend.d0 / ttmEps
    : last?.eps > 0 && paidPerShare != null ? paidPerShare / last.eps : null;
  const payoutOk = payout != null ? payout >= 0.40 && payout <= 0.70 : null;
  // Only the shoulder above the band is a warning: 70–80% is still covered but
  // leaves no room to reinvest. A payout *below* the band is not a warning, it
  // is simply not an income case — the earlier `<= 0.80` test handed every low
  // payer half credit, which is how DELTA's 19% payout earned three points.
  add('payoutBand', payoutOk, payout, 0.40, {
    upper: 0.70,
    warn: payout != null && payout > 0.70 && payout <= 0.80,
  });

  const streak = dividendStreak(dividends, asOf);
  add('dividendStreak', dividends.length ? streak >= 5 : null, streak, 5);

  let earned = 0;
  let possible = 0;
  const totalWeight = Object.values(WEIGHTS).reduce((sum, w) => sum + w, 0);
  for (const check of checks) {
    const weight = WEIGHTS[check.id] ?? 0;
    // A rule that cannot be judged is left out of both sides of the fraction.
    // Counting it as half credit — the obvious compromise — docks a bank five
    // points forever for an interest-cover test that has no meaning on a
    // balance sheet funded by deposits, which is the opposite of neutral.
    if (check.pass === null) continue;
    possible += weight;
    if (check.pass === true) earned += weight;
    else if (check.warn) earned += weight * 0.5;
  }
  const score = possible > 0 ? Math.round((earned / possible) * 100) : 0;
  // How much of the framework actually applied, so a score built on four of
  // fourteen rules can be recognised as thin rather than taken at face value.
  const coverage = totalWeight > 0 ? possible / totalWeight : 0;

  const failed = checks.filter((c) => c.pass === false && !c.warn);
  return {
    checks,
    score,
    coverage,
    passed: checks.filter((c) => c.pass === true).length,
    failed: failed.length,
    evaluated: checks.filter((c) => c.pass !== null).length,
    total: checks.length,
    roe3,
    roa3,
    npm3,
    de,
    icr,
    dividendYield,
    payout,
    streak,
    dividend,
  };
}

/**
 * Presets.
 *
 * `requires` lists check ids that must pass outright; the score threshold
 * handles the rest. Presets differ in *which* checks are mandatory rather than
 * in how the score is computed, so the same row can be strong for one mandate
 * and disqualified for another without the maths changing underneath.
 */
export const PRESETS = [
  {
    id: 'moat',
    // "High dividend" is part of the mandate, so the yield floor is mandatory
    // too. Without it the preset admitted DELTA at a 0.19% yield — a fine
    // business, and not an income idea by any reading of the name.
    requires: ['dividendYield', 'roeLevel', 'dividendStreak', 'cfoPositive'],
    minScore: 65,
    sort: 'score',
  },
  {
    id: 'quality',
    requires: ['roeLevel', 'roaLevel', 'fcfPositive'],
    minScore: 60,
    sort: 'score',
  },
  {
    id: 'dividend',
    requires: ['dividendYield', 'dividendStreak', 'payoutBand'],
    minScore: 55,
    sort: 'yield',
  },
  {
    id: 'value',
    requires: [],
    minScore: 50,
    sort: 'mos',
    // Deep-value names are allowed a weaker quality score, but not a broken
    // one: a negative margin of safety is not a value case, it is a forecast.
    minMos: 0,
  },
  {
    id: 'all',
    requires: [],
    minScore: 0,
    sort: 'score',
  },
];

export function presetById(id) {
  return PRESETS.find((p) => p.id === id) ?? PRESETS[0];
}

/**
 * Decide whether a scored row belongs in a preset's result set.
 *
 * Mandatory checks are strict: a `warn` or an unevaluated check does not
 * satisfy them. That is the difference between "this company passes the
 * dividend rule" and "we could not tell whether it does", and a screen that
 * blurs the two is how a name with a two-year-old suspension ends up in a
 * long-dividend list.
 */
export function applyPreset(row, preset) {
  for (const id of preset.requires) {
    const check = row.checks.find((c) => c.id === id);
    // A rule that does not apply to this business — cash flow at a bank — is
    // skipped rather than treated as unknown. Missing data is still strict: the
    // difference between "cannot apply" and "we could not tell" matters.
    if (check?.na === true) continue;
    if (!check || check.pass !== true) {
      return { pass: false, reason: `requires:${id}` };
    }
  }
  if (typeof preset.minMos === 'number') {
    if (row.ddm.mos == null) return { pass: false, reason: 'no-mos' };
    if (row.ddm.mos < preset.minMos) return { pass: false, reason: 'mos-too-low' };
  }
  if (row.score < preset.minScore) return { pass: false, reason: 'score-too-low' };
  return { pass: true, reason: null };
}

export { dividendStreak };
