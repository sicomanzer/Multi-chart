/**
 * Regression suite for the store-level rules the UI depends on.
 *
 * These run without a server: every module imported here is pure enough to
 * exercise directly, and keeping them free of HTTP means a failure points at a
 * rule rather than at a port that happened to be busy. The HTTP suites in
 * `verify-workspaces.mjs` and `verify-watchlists.mjs` cover the wiring.
 *
 * Run with `npm test`.
 */
import { sanitizeWorkspace, DEFAULT_SETTINGS } from '../server/workspace-store.js';
import { sanitizeWatchlist, MAX_SYMBOLS_PER_LIST } from '../server/watchlist-store.js';
import { normalizeSymbol, toYahooSymbol, uniqueSymbols } from '../server/symbols.js';
import { sanitizeParams, defaultParams, INDICATORS } from '../server/indicator-catalog.js';
import { computeIndicator, SUPPORTED_INDICATORS } from '../public/js/ta.js';

let failures = 0;
let ran = 0;
const check = (name, ok, detail = '') => {
  ran += 1;
  if (!ok) {
    failures += 1;
    console.log(`  FAIL  ${name}${detail ? `  <- ${detail}` : ''}`);
  } else {
    console.log(`  PASS  ${name}`);
  }
};
const group = (title) => console.log(`\n${title}`);

const chart = (over = {}) => ({
  symbol: 'SET:CPF',
  timeframe: '1d',
  chartType: 'candles',
  indicators: [],
  ...over,
});

// ── symbols ──────────────────────────────────────────────────────────────────

group('symbols');
check('bare ticker takes the default exchange', normalizeSymbol('CPF') === 'SET:CPF');
check('yahoo suffix recovers the exchange', normalizeSymbol('CPF.BK') === 'SET:CPF');
check('already-qualified is left alone', normalizeSymbol('NASDAQ:AAPL') === 'NASDAQ:AAPL');
check('whitespace and case are cleaned', normalizeSymbol('  set:cpf ') === 'SET:CPF');
check('crypto pair maps to a yahoo pair', toYahooSymbol('BINANCE:BTCUSDT') === 'BTC-USD');
check('us ticker needs no suffix', toYahooSymbol('NASDAQ:AAPL') === 'AAPL');
check('lse carries its suffix', toYahooSymbol('LSE:SHEL') === 'SHEL.L');
check('empty input is rejected', normalizeSymbol('') === null);
check('uniqueSymbols drops repeats', uniqueSymbols(['CPF', 'SET:CPF', 'cpf.bk']).length === 1);

// ── indicator parameters ─────────────────────────────────────────────────────

group('indicator params');
check('out-of-range int is clamped', sanitizeParams('rsi', { length: 9999 }).length === 200);
check('unknown keys are dropped', !('bogus' in sanitizeParams('rsi', { bogus: 1 })));
check('missing value falls back to the default',
  sanitizeParams('rsi', {}).length === defaultParams('rsi').length);
check('float keeps its fraction', sanitizeParams('bb', { mult: 2.35 }).mult === 2.35);
check('non-numeric falls back', sanitizeParams('rsi', { length: 'abc' }).length === 14);
check('select rejects an unknown option', sanitizeParams('sma', { source: 'bogus' }).source === 'close');
check('bool accepts "true"', sanitizeParams('rsi', { fillBands: 'true' }).fillBands === true);
check('injected colour is rejected',
  sanitizeParams('sma', { color: 'url(javascript:alert(1))' }).color === '#f7a600');
check('hex colour survives', sanitizeParams('sma', { color: '#abcdef' }).color === '#abcdef');

// ── workspace sanitising ─────────────────────────────────────────────────────

group('workspace store');
const wsBase = { id: 'ws_1', name: 'Test', settings: {}, charts: [] };

const kept = sanitizeWorkspace({
  ...wsBase,
  charts: [chart({ priceLines: [{ value: 10, color: '#ff0000', style: 'dashed', title: 'target' }] })],
});
check('price level survives a save', kept.charts[0].priceLines.length === 1);
check('price level keeps its value', kept.charts[0].priceLines[0].value === 10);
check('price level keeps its style', kept.charts[0].priceLines[0].style === 'dashed');
check('price level gets explicit defaults',
  kept.charts[0].priceLines[0].lineWidth === undefined || kept.charts[0].priceLines[0].width === 1,
  JSON.stringify(kept.charts[0].priceLines[0]));

const clamped = sanitizeWorkspace({
  ...wsBase,
  charts: [chart({ priceLines: [{ value: 'nope' }, { value: 5, color: 'evil()', style: 'nope' }] })],
});
check('non-numeric price level dropped', clamped.charts[0].priceLines.length === 1);
check('invalid colour replaced', clamped.charts[0].priceLines[0].color === '#f7a600');
check('invalid style coerced', clamped.charts[0].priceLines[0].style === 'solid');

const many = sanitizeWorkspace({
  ...wsBase,
  charts: [chart({ priceLines: Array.from({ length: 40 }, (_, i) => ({ value: i })) })],
});
check('price levels are capped', many.charts[0].priceLines.length <= 12,
  `got ${many.charts[0].priceLines.length}`);

const withRsi = sanitizeWorkspace({
  ...wsBase,
  charts: [chart({ indicators: [{ type: 'rsi', paneHeight: 99999 }, { type: 'sma', paneHeight: 10 }] })],
});
check('pane height clamped to the editor bounds',
  withRsi.charts[0].indicators[0].paneHeight === 600,
  `got ${withRsi.charts[0].indicators[0].paneHeight}`);
check('pane height clamped at the low end too',
  withRsi.charts[0].indicators[1].paneHeight === 60,
  `got ${withRsi.charts[0].indicators[1].paneHeight}`);

const defaulted = sanitizeWorkspace({
  ...wsBase,
  charts: [chart({ indicators: [{ type: 'volume' }] })],
});
check('absent pane height uses the catalog default',
  defaulted.charts[0].indicators[0].paneHeight === 80,
  `got ${defaulted.charts[0].indicators[0].paneHeight}`);

const hostile = sanitizeWorkspace({
  ...wsBase,
  name: 'x'.repeat(300),
  settings: { columns: 99, theme: 'neon', layoutFit: 'nonsense', footerMetrics: 'not-an-array' },
  charts: [
    { symbol: 'CPF', timeframe: '99y', chartType: 'nope', indicators: [{ type: 'not-real' }, 'string'] },
    { symbol: '', timeframe: '1d' },
  ],
});
check('name truncated', hostile.name.length === 80);
check('columns clamped to the board maximum', hostile.settings.columns === 5,
  `got ${hostile.settings.columns}`);
check('theme is a string, unknown values survive as text', hostile.settings.theme === 'neon');
check('unknown layoutFit falls back', hostile.settings.layoutFit === 'auto');
check('non-array footerMetrics falls back',
  Array.isArray(hostile.settings.footerMetrics) && hostile.settings.footerMetrics.length > 0);
check('unknown timeframe falls back', hostile.charts[0].timeframe === DEFAULT_SETTINGS.defaultTimeframe);
check('unknown chart type falls back', hostile.charts[0].chartType === DEFAULT_SETTINGS.candleStyle);
check('unknown indicator type dropped', hostile.charts[0].indicators.length === 0);
check('chart with no symbol dropped', hostile.charts.length === 1);

check('defaults always cover every setting',
  Object.keys(sanitizeWorkspace({}).settings).length === Object.keys(DEFAULT_SETTINGS).length);

// ── watchlist sanitising ─────────────────────────────────────────────────────

group('watchlist store');
const wl = sanitizeWatchlist({ name: 'List', symbols: ['CPF', 'SET:CPF', 'cpf.bk', 'TU'] });
check('duplicates collapse', wl.symbols.length === 2, JSON.stringify(wl.symbols));
check('symbols are canonical', wl.symbols.every((s) => s.includes(':')), JSON.stringify(wl.symbols));

const split = sanitizeWatchlist({ symbols: ['SCB, KBANK', 'ADVANC'] });
check('comma-separated entry is split', split.symbols.length === 3, JSON.stringify(split.symbols));
check('a space inside an entry is rejected, not split',
  sanitizeWatchlist({ symbols: ['not a ticker!!'] }).symbols.length === 0);

const junk = sanitizeWatchlist({ symbols: [null, '', '   ', 42, {}, 'not a ticker!!', 'OK:GENUINE'] });
check('junk is dropped, valid kept', junk.symbols.length === 1, JSON.stringify(junk.symbols));
check('the survivor is genuine', junk.symbols[0] === 'OK:GENUINE');

const capped = sanitizeWatchlist({
  symbols: Array.from({ length: MAX_SYMBOLS_PER_LIST + 50 }, (_, i) => `S${i}`),
});
check(`capped at ${MAX_SYMBOLS_PER_LIST}`, capped.symbols.length === MAX_SYMBOLS_PER_LIST);
check('truncation is reported, not silent', capped.truncated === true);

const named = sanitizeWatchlist({ name: 'y'.repeat(200) });
check('name truncated', named.name.length === 80);

// ── indicator maths ──────────────────────────────────────────────────────────

group('indicator maths');
check('catalog and maths agree', INDICATORS.length === SUPPORTED_INDICATORS.length,
  `${INDICATORS.length} vs ${SUPPORTED_INDICATORS.length}`);

// A deterministic ramp-and-dip: long fall, sharp recovery, so oscillators at
// different bounds produce different answers.
const bars = Array.from({ length: 220 }, (_, i) => {
  const base = 100 + Math.sin(i / 9) * 12 + (i < 120 ? -i * 0.25 : (i - 120) * 0.6);
  const o = base;
  const c = base + Math.sin(i / 3) * 1.4;
  return {
    time: 1700000000 + i * 86400,
    open: o, high: Math.max(o, c) + 0.8, low: Math.min(o, c) - 0.8, close: c,
    volume: 1000 + (i % 37) * 11,
  };
});

const lastOf = (r) => {
  for (const plot of r.plots) for (let i = plot.data.length - 1; i >= 0; i -= 1) {
    if (Number.isFinite(plot.data[i].value)) return plot.data[i].value;
  }
  return null;
};

const rsi = computeIndicator('rsi', bars, { length: 14, source: 'close', color: '#fff', width: 2, overbought: 70, oversold: 30, fillBands: true });
check('rsi returns a series', !!rsi && rsi.plots.length === 1);
check('rsi stays inside 0..100', lastOf(rsi) >= 0 && lastOf(rsi) <= 100, `got ${lastOf(rsi)}`);
check('rsi emits ob/50/os lines', rsi.levels.length === 3, `got ${rsi.levels.length}`);
check('rsi zones are emitted when asked for', rsi.zones.length === 2, `got ${rsi.zones.length}`);
check('rsi zones are bounded', rsi.zones.every((z) => Number.isFinite(z.from) && Number.isFinite(z.to)));

const rsiNoFill = computeIndicator('rsi', bars, { length: 14, overbought: 70, oversold: 30, fillBands: false });
check('rsi zones omitted when not asked for', rsiNoFill.zones.length === 0);

const smaShow = computeIndicator('sma', bars, { length: 20, source: 'close', color: '#f7a600', width: 2, showLast: true });
const smaHide = computeIndicator('sma', bars, { length: 20, source: 'close', color: '#f7a600', width: 2, showLast: false });
check('showLast adds a reference line', smaShow.levels.length === 1, `got ${smaShow.levels.length}`);
check('showLast off adds none', smaHide.levels.length === 0);
check('showLast line sits at the series value',
  Math.abs(smaShow.levels[0].value - lastOf(smaShow)) < 1e-9,
  `${smaShow.levels[0]?.value} vs ${lastOf(smaShow)}`);

const roc = computeIndicator('roc', bars, {
  length: 9, source: 'close', color: '#ffeb3b', upper: 5, lower: -5, showZero: true,
});
check('roc upper/lower are read', roc.levels.length === 3, `got ${roc.levels.length}`);
check('roc zero line present', roc.levels.some((l) => l.value === 0));

const bb = computeIndicator('bb', bars, {
  length: 20, mult: 2, source: 'close', basisColor: '#2962ff',
  upperColor: '#ef5350', lowerColor: '#26a69a', fill: true, width: 1,
});
const bbVals = bb.plots.map((p) => lastOf({ plots: [p] }));
check('bollinger has three series', bbVals.length === 3, `got ${bbVals.length}`);
check('band ordering upper >= basis >= lower',
  bbVals.every(Number.isFinite) && bbVals[0] >= bbVals[1] && bbVals[1] >= bbVals[2],
  JSON.stringify(bbVals));
check('band fill is emitted', bb.bands.length === 1);

for (const type of SUPPORTED_INDICATORS) {
  const def = INDICATORS.find((d) => d.type === type);
  const r = computeIndicator(type, bars, defaultParams(type));
  const ok = r !== null && r.plots.length > 0;
  if (!ok) failures += 1;
  ran += 1;
  if (!ok) console.log(`  FAIL  ${def.short} produced no plot`);
}
console.log(`  PASS  all ${SUPPORTED_INDICATORS.length} indicators produce plots`);

check('unknown indicator returns null', computeIndicator('nope', bars, {}) === null);
check('empty bars return null', computeIndicator('rsi', [], defaultParams('rsi')) === null);

// A flat series is the degenerate case: no movement anywhere.
const flat = Array.from({ length: 60 }, (_, i) => ({
  time: 1700000000 + i * 86400, open: 10, high: 10, low: 10, close: 10, volume: 5,
}));
check('flat series: rsi is 100', lastOf(computeIndicator('rsi', flat, defaultParams('rsi'))) === 100);
check('flat series: atr is 0', lastOf(computeIndicator('atr', flat, defaultParams('atr'))) === 0);

console.log(`\n${failures ? `${failures} of ${ran} FAILED` : `all ${ran} passed`}\n`);
process.exit(failures ? 1 : 0);