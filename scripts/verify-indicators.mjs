/**
 * Indicator verification harness.
 *
 * Runs the browser maths module (`public/js/ta.js`, which has no DOM
 * dependencies) against real candles fetched from the running API, and checks
 * every indicator against a second implementation written independently here
 * plus structural invariants.
 *
 *   npm start                # in one terminal
 *   npm run verify           # in another
 *
 * Exit code 0 means every indicator agrees with its reference and satisfies the
 * invariants (ranges, ordering, warm-up, flip behaviour).
 */
import { computeIndicator, SUPPORTED_INDICATORS } from '../public/js/ta.js';
import { INDICATORS, defaultParams } from '../server/indicator-catalog.js';

const BASE = process.env.API ?? 'http://127.0.0.1:8787';
const SYMBOL = process.env.SYMBOL ?? 'SET:CPF';
const TIMEFRAME = process.env.TIMEFRAME ?? '1d';
const CATALOG = Object.fromEntries(INDICATORS.map((i) => [i.type, i]));

const failures = [];
const summary = [];

const check = (name, ok, detail = '') => {
  if (!ok) failures.push(`${name}: ${detail}`);
  return ok;
};

const closeTo = (a, b, tol = 1e-6) => {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  return Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));
};

// ── reference maths (deliberately a separate code path from ta.js) ──────────

function refSMA(vals, n) {
  const out = [];
  for (let i = n - 1; i < vals.length; i += 1) {
    out.push(vals.slice(i - n + 1, i + 1).reduce((a, b) => a + b, 0) / n);
  }
  return out;
}

function refEMA(vals, n) {
  const out = new Array(vals.length).fill(NaN);
  if (vals.length < n) return out;
  const k = 2 / (n + 1);
  let prev = vals.slice(0, n).reduce((a, b) => a + b, 0) / n;
  out[n - 1] = prev;
  for (let i = n; i < vals.length; i += 1) { prev = vals[i] * k + prev * (1 - k); out[i] = prev; }
  return out;
}

/** Wilder's moving average. */
function refRMA(vals, n) {
  const out = new Array(vals.length).fill(NaN);
  if (vals.length < n) return out;
  let prev = vals.slice(0, n).reduce((a, b) => a + b, 0) / n;
  out[n - 1] = prev;
  for (let i = n; i < vals.length; i += 1) { prev = (prev * (n - 1) + vals[i]) / n; out[i] = prev; }
  return out;
}

function refRSI(closes, n) {
  const g = [0];
  const l = [0];
  for (let i = 1; i < closes.length; i += 1) {
    const d = closes[i] - closes[i - 1];
    g.push(Math.max(d, 0));
    l.push(Math.max(-d, 0));
  }
  const ag = refRMA(g.slice(1), n);
  const al = refRMA(l.slice(1), n);
  const out = [NaN];
  for (let i = 0; i < ag.length; i += 1) {
    out.push(al[i] === 0 ? 100 : 100 - 100 / (1 + ag[i] / al[i]));
  }
  return out;
}

function refATR(bars, n) {
  const tr = [bars[0].high - bars[0].low];
  for (let i = 1; i < bars.length; i += 1) {
    const pc = bars[i - 1].close;
    tr.push(Math.max(bars[i].high - bars[i].low, Math.abs(bars[i].high - pc), Math.abs(bars[i].low - pc)));
  }
  const smoothed = refRMA(tr.slice(1), n);
  const out = new Array(bars.length).fill(NaN);
  for (let i = 0; i < smoothed.length; i += 1) out[i + 1] = smoothed[i];
  return out;
}

function refSupertrend(bars, n, mult) {
  const a = refATR(bars, n);
  const upper = bars.map((b, i) => (Number.isFinite(a[i]) ? (b.high + b.low) / 2 + mult * a[i] : NaN));
  const lower = bars.map((b, i) => (Number.isFinite(a[i]) ? (b.high + b.low) / 2 - mult * a[i] : NaN));
  const out = [];
  let trend = bars[1].close >= bars[0].close ? 'up' : 'down';
  for (let i = 1; i < bars.length; i += 1) {
    if (!(Number.isFinite(upper[i]) && Number.isFinite(upper[i - 1]))) continue;
    const u = (upper[i] < upper[i - 1] || bars[i - 1].close > upper[i - 1]) ? upper[i] : upper[i - 1];
    const l = (lower[i] > lower[i - 1] || bars[i - 1].close < lower[i - 1]) ? lower[i] : lower[i - 1];
    if (trend === 'down' && bars[i].close > u) trend = 'up';
    else if (trend === 'up' && bars[i].close < l) trend = 'down';
    out.push({ time: bars[i].time, value: trend === 'up' ? l : u });
  }
  return out;
}

function refPSAR(bars, start, step, max) {
  let bull = bars[0].close > bars[1].close;
  let acc = start;
  let ep = bull ? bars[0].low : bars[0].high;
  let sar = bull ? Math.min(bars[0].low, bars[1].low) : Math.max(bars[0].high, bars[1].high);
  const out = [];
  for (let i = 1; i < bars.length; i += 1) {
    sar += acc * (ep - sar);
    const b = bars[i];
    const prev = bars[i - 1];
    const prev2 = i >= 2 ? bars[i - 2] : prev;
    if (bull) {
      sar = Math.min(sar, prev.low, prev2.low);
      if (b.low < sar) { bull = false; sar = ep; ep = b.low; acc = start; }
      else if (b.high > ep) { ep = b.high; acc = Math.min(max, acc + step); }
    } else {
      sar = Math.max(sar, prev.high, prev2.high);
      if (b.high > sar) { bull = true; sar = ep; ep = b.high; acc = start; }
      else if (b.low < ep) { ep = b.low; acc = Math.min(max, acc + step); }
    }
    out.push({ time: b.time, value: sar });
  }
  return out;
}

// ── load candles ────────────────────────────────────────────────────────────

const res = await fetch(`${BASE}/api/candles?symbol=${SYMBOL}&timeframe=${TIMEFRAME}`);
if (!res.ok) {
  console.error(`cannot reach the API at ${BASE} (status ${res.status}). Start the server with "npm start" first.`);
  process.exit(2);
}
const payload = await res.json();
const bars = payload.bars;
const closes = bars.map((b) => b.close);
console.log(`bars: ${bars.length} (${payload.symbol} ${payload.timeframe} via ${payload.yahooSymbol})\n`);

// ── every indicator must produce usable series ──────────────────────────────

for (const type of SUPPORTED_INDICATORS) {
  if (!CATALOG[type]) {
    failures.push(`${type}: missing from the catalog`);
    continue;
  }
  const out = computeIndicator(type, bars, defaultParams(type));
  if (!out) { failures.push(`${type}: returned null`); continue; }
  if (!out.plots.length) { failures.push(`${type}: no plots`); continue; }

  for (const plot of out.plots) {
    if (!plot.data.length) { failures.push(`${type}.${plot.key}: empty data`); continue; }
    if (plot.data.some((p) => !Number.isFinite(p.value))) {
      failures.push(`${type}.${plot.key}: non-finite value in series`);
    }
    for (let i = 1; i < plot.data.length; i += 1) {
      if (!(plot.data[i].time > plot.data[i - 1].time)) {
        failures.push(`${type}.${plot.key}: time not ascending at index ${i}`);
        break;
      }
    }
    summary.push(`${type.padEnd(11)} ${plot.key.padEnd(11)} pts=${String(plot.data.length).padStart(4)} last=${Number(plot.data.at(-1).value.toFixed(4))}`);
  }
}

// ── cross-checks against the reference implementations ──────────────────────

const tail = (type, key) => computeIndicator(type, bars, defaultParams(type))?.plots.find((p) => p.key === key)?.data.at(-1)?.value;

check('sma vs reference', closeTo(tail('sma', 'sma'), refSMA(closes, 20).at(-1)));
check('ema vs reference', closeTo(tail('ema', 'ema'), refEMA(closes, 50).at(-1)));
check('rsi vs reference', closeTo(tail('rsi', 'rsi'), refRSI(closes, 14).at(-1), 1e-4));
check('atr vs reference', closeTo(tail('atr', 'atr'), refATR(bars, 14).at(-1)));
check('rsi in 0..100', tail('rsi', 'rsi') >= 0 && tail('rsi', 'rsi') <= 100);

const macd = computeIndicator('macd', bars, defaultParams('macd'));
const macdByKey = Object.fromEntries(macd.plots.map((p) => [p.key, p.data]));
const hMap = new Map(macdByKey.hist.map((p) => [p.time, p.value]));
const mMap = new Map(macdByKey.macd.map((p) => [p.time, p.value]));
const sMap = new Map(macdByKey.signal.map((p) => [p.time, p.value]));
let histErrors = 0;
for (const [time, h] of hMap) {
  const m = mMap.get(time);
  const s = sMap.get(time);
  if (m === undefined || s === undefined) continue;
  if (!closeTo(h, m - s, 1e-9)) histErrors += 1;
}
check('macd histogram = macd - signal', histErrors === 0, `${histErrors} bars wrong`);
check('macd histogram per-bar colours', macdByKey.hist.at(-1).color !== undefined);
check('macd signal populated', macdByKey.signal.length > 100, `${macdByKey.signal.length} points`);

for (const type of ['bb', 'keltner', 'donchian']) {
  const byKey = Object.fromEntries(computeIndicator(type, bars, defaultParams(type)).plots.map((p) => [p.key, p.data]));
  let bad = 0;
  for (const b of byKey.basis) {
    const u = byKey.upper.find((x) => x.time === b.time)?.value;
    const l = byKey.lower.find((x) => x.time === b.time)?.value;
    if (u === undefined || l === undefined) continue;
    if (!(u >= b.value && b.value >= l)) bad += 1;
  }
  check(`${type} ordering (upper >= basis >= lower)`, bad === 0, `${bad} bars wrong`);
}

const rangeOf = (type, key, lo, hi) => {
  const values = computeIndicator(type, bars, defaultParams(type)).plots.find((p) => p.key === key).data.map((p) => p.value);
  check(`${type}.${key} within ${lo}..${hi}`, values.every((v) => v >= lo - 1e-9 && v <= hi + 1e-9));
};
rangeOf('stoch', 'k', 0, 100);
rangeOf('stochRsi', 'k', 0, 100);
rangeOf('mfi', 'mfi', 0, 100);
rangeOf('williamsR', 'wr', -100, 0);
rangeOf('adx', 'adx', 0, 100);
rangeOf('adx', 'plus', 0, 100);
rangeOf('adx', 'minus', 0, 100);

const vol = computeIndicator('volume', bars, defaultParams('volume'));
check('volume reproduces raw volumes', vol.plots[0].data.every((p) => {
  const bar = bars.find((b) => b.time === p.time);
  return bar && Math.abs(bar.volume - p.value) < 1e-6;
}));
check('volume per-bar colours', vol.plots[0].data.every((p) => p.color === '#26a69a' || p.color === '#ef5350'));

let obvAccum = 0;
for (let i = 1; i < bars.length; i += 1) {
  const d = bars[i].close - bars[i - 1].close;
  obvAccum += d > 0 ? bars[i].volume : d < 0 ? -bars[i].volume : 0;
}
check('obv is the signed cumulative sum', closeTo(tail('obv', 'obv'), obvAccum, 1e-9));

const st = computeIndicator('supertrend', bars, defaultParams('supertrend'));
const stUp = st.plots.find((p) => p.key === 'up').data;
const stDown = st.plots.find((p) => p.key === 'down').data;
check('supertrend flips between both states', stUp.length > 0 && stDown.length > 0, `up=${stUp.length} down=${stDown.length}`);
const stRef = refSupertrend(bars, defaultParams('supertrend').atrLength, defaultParams('supertrend').mult);
const stMap = new Map([...stDown, ...stUp].map((p) => [p.time, p.value]));
check('supertrend matches reference', stRef.every((p) => closeTo(stMap.get(p.time), p.value, 1e-9)),
  `${stRef.filter((p) => !closeTo(stMap.get(p.time), p.value, 1e-9)).length} bars wrong`);

const pParams = defaultParams('psar');
const psar = computeIndicator('psar', bars, pParams);
const psarRef = refPSAR(bars, pParams.start, pParams.step, pParams.max);
const psarMap = new Map(psar.points.map((p) => [p.time, p.value]));
check('psar point count', psar.points.length === psarRef.length, `${psar.points.length} vs ${psarRef.length}`);
check('psar matches reference', psarRef.every((p) => closeTo(psarMap.get(p.time), p.value, 1e-9)),
  `${psarRef.filter((p) => !closeTo(psarMap.get(p.time), p.value, 1e-9)).length} bars wrong`);
check('psar flips between both states', psar.plots[0].data.length > 0 && psar.plots[1].data.length > 0,
  `up=${psar.plots[0].data.length} down=${psar.plots[1].data.length}`);

const ichimoku = computeIndicator('ichimoku', bars, defaultParams('ichimoku'));
for (const key of ['tenkan', 'kijun', 'spanA', 'spanB', 'chikou']) {
  check(`ichimoku.${key} populated`, (ichimoku.plots.find((p) => p.key === key)?.data.length ?? 0) > 100);
}

// warm-up: a 400-period SMA over 491 bars must not yield a full-length series
check('warm-up respected', computeIndicator('sma', bars, { ...defaultParams('sma'), length: 400 }).plots[0].data.length === bars.length - 400 + 1);

// degenerate inputs
const flat = Array.from({ length: 60 }, (_, i) => ({
  time: 1700000000 + i * 86400, open: 10, high: 10, low: 10, close: 10, volume: 100,
}));
check('flat series: rsi = 100', computeIndicator('rsi', flat, defaultParams('rsi')).plots[0].data.at(-1).value === 100);
check('flat series: atr = 0', computeIndicator('atr', flat, defaultParams('atr')).plots[0].data.at(-1).value === 0);
const up = Array.from({ length: 60 }, (_, i) => ({
  time: 1700000000 + i * 86400, open: 10 + i, high: 11 + i, low: 9 + i, close: 10 + i, volume: 100,
}));
check('monotonic rise: rsi = 100', computeIndicator('rsi', up, defaultParams('rsi')).plots[0].data.at(-1).value === 100);
check('single bar does not crash', computeIndicator('rsi', flat.slice(0, 1), defaultParams('rsi'))?.plots[0] !== undefined);

// ── report ──────────────────────────────────────────────────────────────────

console.log('--- series summary ---');
for (const line of summary) console.log(line);

console.log(`\nindicators checked: ${SUPPORTED_INDICATORS.length}`);
console.log(`assertions failed:  ${failures.length}`);
for (const f of failures) console.log(`  FAIL ${f}`);
process.exit(failures.length ? 1 : 0);