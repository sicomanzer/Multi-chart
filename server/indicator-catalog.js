/**
 * Single source of truth for every indicator the desk can draw.
 *
 * `server/indicator-catalog.js` owns this metadata; the browser receives it
 * from `GET /api/indicators` and pairs each entry with the matching compute
 * function in `public/js/indicators.js` (keyed by `type`). Adding an indicator
 * therefore means: add an entry here + add a `compute()` in the client.
 */

/** @typedef {'overlay'|'pane'} IndicatorPlacement */

/**
 * param:  { id, label, type: 'int'|'float'|'bool'|'select'|'color',
 *           default, min?, max?, step?, options?, hint? }
 * plot:   a single output line/series produced by the compute function
 * style:  { key, label, type: 'int'|'float'|'bool'|'select'|'color', default, ... }
 */

const int = (id, label, def, extra = {}) => ({ id, label, type: 'int', default: def, ...extra });
const float = (id, label, def, extra = {}) => ({ id, label, type: 'float', default: def, ...extra });
const bool = (id, label, def, extra = {}) => ({ id, label, type: 'bool', default: def, ...extra });
const select = (id, label, def, options, extra = {}) => ({ id, label, type: 'select', default: def, options, ...extra });
const color = (id, label, def, extra = {}) => ({ id, label, type: 'color', default: def, ...extra });

export const PRICE_SOURCES = [
  { value: 'close', label: 'Close' },
  { value: 'open', label: 'Open' },
  { value: 'high', label: 'High' },
  { value: 'low', label: 'Low' },
  { value: 'hl2', label: 'HL2' },
  { value: 'hlc3', label: 'HLC3' },
  { value: 'ohlc4', label: 'OHLC4' },
];

const LINE_STYLE = [
  { id: 'color', label: 'Colour', type: 'color', default: '#2962ff' },
  { id: 'width', label: 'Line width', type: 'int', default: 1, min: 1, max: 4 },
];

const OVERLAY_STYLE = [
  ...LINE_STYLE,
  { id: 'showLast', label: 'Show last value', type: 'bool', default: true },
];

export const INDICATORS = [
  // ── Moving averages ────────────────────────────────────────────────────────
  {
    type: 'sma',
    name: 'Simple Moving Average',
    short: 'SMA',
    group: 'Moving Average',
    placement: 'overlay',
    params: [
      int('length', 'Length', 20, { min: 1, max: 500 }),
      select('source', 'Source', 'close', PRICE_SOURCES.map((s) => s.value)),
      color('color', 'Colour', '#f7a600'),
      int('width', 'Line width', 2, { min: 1, max: 4 }),
      bool('showLast', 'Show last value', true),
    ],
  },
  {
    type: 'ema',
    name: 'Exponential Moving Average',
    short: 'EMA',
    group: 'Moving Average',
    placement: 'overlay',
    params: [
      int('length', 'Length', 50, { min: 1, max: 500 }),
      select('source', 'Source', 'close', PRICE_SOURCES.map((s) => s.value)),
      color('color', 'Colour', '#e91e63'),
      int('width', 'Line width', 2, { min: 1, max: 4 }),
      bool('showLast', 'Show last value', true),
    ],
  },
  {
    type: 'wma',
    name: 'Weighted Moving Average',
    short: 'WMA',
    group: 'Moving Average',
    placement: 'overlay',
    params: [
      int('length', 'Length', 20, { min: 1, max: 500 }),
      select('source', 'Source', 'close', PRICE_SOURCES.map((s) => s.value)),
      color('color', 'Colour', '#00bcd4'),
      int('width', 'Line width', 2, { min: 1, max: 4 }),
    ],
  },
  {
    type: 'vwma',
    name: 'Volume Weighted MA',
    short: 'VWMA',
    group: 'Moving Average',
    placement: 'overlay',
    params: [
      int('length', 'Length', 20, { min: 1, max: 500 }),
      color('color', 'Colour', '#9c27b0'),
      int('width', 'Line width', 2, { min: 1, max: 4 }),
    ],
  },
  {
    type: 'hma',
    name: 'Hull Moving Average',
    short: 'HMA',
    group: 'Moving Average',
    placement: 'overlay',
    params: [
      int('length', 'Length', 21, { min: 2, max: 500 }),
      select('source', 'Source', 'close', PRICE_SOURCES.map((s) => s.value)),
      color('color', 'Colour', '#ff6d00'),
      int('width', 'Line width', 2, { min: 1, max: 4 }),
    ],
  },

  // ── Bands / channels ───────────────────────────────────────────────────────
  {
    type: 'bb',
    name: 'Bollinger Bands',
    short: 'BB',
    group: 'Volatility',
    placement: 'overlay',
    params: [
      int('length', 'Length', 20, { min: 2, max: 500 }),
      float('mult', 'Std dev multiplier', 2, { min: 0.1, max: 6, step: 0.1 }),
      select('source', 'Source', 'close', PRICE_SOURCES.map((s) => s.value)),
      color('basisColor', 'Basis colour', '#2962ff'),
      color('upperColor', 'Upper colour', '#ef5350'),
      color('lowerColor', 'Lower colour', '#26a69a'),
      bool('fill', 'Fill between bands', true),
      int('width', 'Line width', 1, { min: 1, max: 4 }),
    ],
  },
  {
    type: 'keltner',
    name: 'Keltner Channels',
    short: 'KC',
    group: 'Volatility',
    placement: 'overlay',
    params: [
      int('length', 'Length', 20, { min: 2, max: 500 }),
      float('atrMult', 'ATR multiplier', 2, { min: 0.1, max: 6, step: 0.1 }),
      int('atrLength', 'ATR length', 10, { min: 1, max: 200 }),
      color('basisColor', 'Basis colour', '#ff9800'),
      color('upperColor', 'Upper colour', '#4caf50'),
      color('lowerColor', 'Lower colour', '#e53935'),
      bool('fill', 'Fill between bands', true),
      int('width', 'Line width', 1, { min: 1, max: 4 }),
    ],
  },
  {
    type: 'donchian',
    name: 'Donchian Channels',
    short: 'DC',
    group: 'Volatility',
    placement: 'overlay',
    params: [
      int('length', 'Length', 20, { min: 2, max: 400 }),
      color('upperColor', 'Upper colour', '#26a69a'),
      color('lowerColor', 'Lower colour', '#ef5350'),
      color('basisColor', 'Basis colour', '#90a4ae'),
      bool('fill', 'Fill between bands', true),
    ],
  },

  // ── Trend ──────────────────────────────────────────────────────────────────
  {
    type: 'macd',
    name: 'MACD',
    short: 'MACD',
    group: 'Trend',
    placement: 'pane',
    params: [
      int('fast', 'Fast length', 12, { min: 1, max: 200 }),
      int('slow', 'Slow length', 26, { min: 2, max: 400 }),
      int('signal', 'Signal length', 9, { min: 1, max: 100 }),
      select('source', 'Source', 'close', PRICE_SOURCES.map((s) => s.value)),
      color('macdColor', 'MACD colour', '#2962ff'),
      color('signalColor', 'Signal colour', '#ff9800'),
      color('histUpColor', 'Histogram up', '#26a69a'),
      color('histDownColor', 'Histogram down', '#ef5350'),
      color('zeroColor', 'Zero line', '#787b86'),
    ],
  },
  {
    type: 'supertrend',
    name: 'SuperTrend',
    short: 'ST',
    group: 'Trend',
    placement: 'overlay',
    params: [
      int('atrLength', 'ATR length', 10, { min: 1, max: 200 }),
      float('mult', 'Multiplier', 3, { min: 0.5, max: 10, step: 0.1 }),
      color('upColor', 'Up trend colour', '#26a69a'),
      color('downColor', 'Down trend colour', '#ef5350'),
      bool('showBands', 'Show bands', false),
    ],
  },
  {
    type: 'psar',
    name: 'Parabolic SAR',
    short: 'PSAR',
    group: 'Trend',
    placement: 'overlay',
    params: [
      float('start', 'Start acceleration', 0.02, { min: 0.001, max: 1, step: 0.001 }),
      float('step', 'Acceleration step', 0.02, { min: 0.001, max: 1, step: 0.001 }),
      float('max', 'Max acceleration', 0.2, { min: 0.01, max: 1, step: 0.01 }),
      color('upColor', 'Up colour', '#26a69a'),
      color('downColor', 'Down colour', '#ef5350'),
      bool('showDots', 'Show dots', true),
    ],
  },
  {
    type: 'adx',
    name: 'ADX / DMI',
    short: 'ADX',
    group: 'Trend',
    placement: 'pane',
    params: [
      int('length', 'Length', 14, { min: 2, max: 200 }),
      float('adxSmoothing', 'ADX smoothing', 14, { min: 1, max: 100, step: 1 }),
      color('adxColor', 'ADX colour', '#ffffff'),
      color('plusColor', '+DI colour', '#26a69a'),
      color('minusColor', '-DI colour', '#ef5350'),
    ],
  },
  {
    type: 'ichimoku',
    name: 'Ichimoku Cloud',
    short: 'ICH',
    group: 'Trend',
    placement: 'overlay',
    params: [
      int('conv', 'Conversion length', 9, { min: 1, max: 200 }),
      int('base', 'Base length', 26, { min: 1, max: 400 }),
      int('spanB', 'Span B length', 52, { min: 1, max: 600 }),
      color('tenkanColor', 'Tenkan colour', '#2962ff'),
      color('kijunColor', 'Kijun colour', '#e91e63'),
      color('cloudUpColor', 'Cloud up fill', 'rgba(38,166,154,0.18)'),
      color('cloudDownColor', 'Cloud down fill', 'rgba(239,83,80,0.18)'),
      bool('showChikou', 'Show Chikou span', true),
    ],
  },

  // ── Momentum ───────────────────────────────────────────────────────────────
  {
    type: 'rsi',
    name: 'Relative Strength Index',
    short: 'RSI',
    group: 'Momentum',
    placement: 'pane',
    defaultPaneHeight: 100,
    params: [
      int('length', 'Length', 14, { min: 2, max: 200 }),
      select('source', 'Source', 'close', PRICE_SOURCES.map((s) => s.value)),
      color('color', 'Colour', '#7e57c2'),
      int('width', 'Line width', 2, { min: 1, max: 4 }),
      float('overbought', 'Overbought', 70, { min: 50, max: 100, step: 1 }),
      float('oversold', 'Oversold', 30, { min: 0, max: 50, step: 1 }),
      bool('fillBands', 'Fill overbought/oversold zones', true),
    ],
  },
  {
    type: 'stoch',
    name: 'Stochastic',
    short: 'STOCH',
    group: 'Momentum',
    placement: 'pane',
    params: [
      int('k', '%K length', 14, { min: 1, max: 200 }),
      int('smoothK', '%K smoothing', 3, { min: 1, max: 50 }),
      int('d', '%D length', 3, { min: 1, max: 50 }),
      color('kColor', '%K colour', '#2962ff'),
      color('dColor', '%D colour', '#ff9800'),
      float('overbought', 'Overbought', 80, { min: 50, max: 100, step: 1 }),
      float('oversold', 'Oversold', 20, { min: 0, max: 50, step: 1 }),
    ],
  },
  {
    type: 'stochRsi',
    name: 'Stochastic RSI',
    short: 'STOCH RSI',
    group: 'Momentum',
    placement: 'pane',
    params: [
      int('rsiLength', 'RSI length', 14, { min: 2, max: 200 }),
      int('stochLength', 'Stochastic length', 14, { min: 1, max: 200 }),
      int('k', '%K smoothing', 3, { min: 1, max: 50 }),
      int('d', '%D length', 3, { min: 1, max: 50 }),
      color('kColor', '%K colour', '#2962ff'),
      color('dColor', '%D colour', '#ff9800'),
    ],
  },
  {
    type: 'cci',
    name: 'Commodity Channel Index',
    short: 'CCI',
    group: 'Momentum',
    placement: 'pane',
    params: [
      int('length', 'Length', 20, { min: 2, max: 200 }),
      select('source', 'Source', 'hlc3', PRICE_SOURCES.map((s) => s.value)),
      color('color', 'Colour', '#00bcd4'),
      color('lineColor', 'Reference lines', '#787b86'),
      float('upper', 'Upper', 100, { min: 10, max: 400, step: 10 }),
      float('lower', 'Lower', -100, { min: -400, max: -10, step: -10 }),
    ],
  },
  {
    type: 'roc',
    name: 'Rate of Change',
    short: 'ROC',
    group: 'Momentum',
    placement: 'pane',
    params: [
      int('length', 'Length', 9, { min: 1, max: 200 }),
      select('source', 'Source', 'close', PRICE_SOURCES.map((s) => s.value)),
      color('color', 'Colour', '#ffeb3b'),
      float('upper', 'Upper', 0, { min: -100, max: 100, step: 1 }),
      float('lower', 'Lower', 0, { min: -100, max: 100, step: 1 }),
      bool('showZero', 'Show zero line', true),
    ],
  },
  {
    type: 'mfi',
    name: 'Money Flow Index',
    short: 'MFI',
    group: 'Momentum',
    placement: 'pane',
    params: [
      int('length', 'Length', 14, { min: 2, max: 200 }),
      color('color', 'Colour', '#ab47bc'),
      float('overbought', 'Overbought', 80, { min: 50, max: 100, step: 1 }),
      float('oversold', 'Oversold', 20, { min: 0, max: 50, step: 1 }),
    ],
  },
  {
    type: 'williamsR',
    name: 'Williams %R',
    short: '%R',
    group: 'Momentum',
    placement: 'pane',
    params: [
      int('length', 'Length', 14, { min: 1, max: 200 }),
      color('color', 'Colour', '#ec407a'),
      float('overbought', 'Overbought', -20, { min: -100, max: 0, step: 5 }),
      float('oversold', 'Oversold', -80, { min: -100, max: 0, step: 5 }),
    ],
  },

  // ── Volume / volatility ────────────────────────────────────────────────────
  {
    type: 'volume',
    name: 'Volume',
    short: 'VOL',
    group: 'Volume',
    placement: 'pane',
    defaultPaneHeight: 80,
    params: [
      select('maType', 'Volume MA', 'sma', ['none', 'sma', 'ema'], {
        labels: { none: 'None', sma: 'SMA', ema: 'EMA' },
      }),
      int('maLength', 'MA length', 20, { min: 1, max: 200 }),
      color('upColor', 'Up colour', '#26a69a'),
      color('downColor', 'Down colour', '#ef5350'),
      color('maColor', 'MA colour', '#ff9800'),
      bool('showMa', 'Show MA', true),
    ],
  },
  {
    type: 'obv',
    name: 'On Balance Volume',
    short: 'OBV',
    group: 'Volume',
    placement: 'pane',
    params: [
      int('length', 'Signal length', 20, { min: 1, max: 200 }),
      color('color', 'Colour', '#42a5f5'),
      bool('showSignal', 'Show signal line', true),
      color('signalColor', 'Signal colour', '#ffa726'),
    ],
  },
  {
    type: 'atr',
    name: 'Average True Range',
    short: 'ATR',
    group: 'Volatility',
    placement: 'pane',
    params: [
      int('length', 'Length', 14, { min: 1, max: 200 }),
      color('color', 'Colour', '#8d6e63'),
      bool('smoothing', 'Use RMA smoothing', true),
    ],
  },
];

export const INDICATOR_GROUPS = [...new Set(INDICATORS.map((i) => i.group))];

/** Human-friendly default parameter object for a given indicator type. */
export function defaultParams(type) {
  const def = INDICATORS.find((i) => i.type === type);
  if (!def) return {};
  return Object.fromEntries(def.params.map((p) => [p.id, p.default]));
}

/**
 * Coerce arbitrary user input (saved layouts, the editor form) into a valid
 * parameter set: unknown keys dropped, wrong types converted, values clamped to
 * the declared min/max. A bad layout therefore degrades to defaults instead of
 * breaking the render.
 */
export function sanitizeParams(type, input = {}) {
  const def = INDICATORS.find((i) => i.type === type);
  if (!def) return {};
  const out = {};
  for (const p of def.params) {
    let v = input?.[p.id];
    if (v === undefined || v === null || v === '') v = p.default;
    switch (p.type) {
      case 'int':
      case 'float': {
        let n = Number(v);
        if (!Number.isFinite(n)) n = p.default;
        if (p.type === 'int') n = Math.round(n);
        if (p.min !== undefined) n = Math.max(p.min, n);
        if (p.max !== undefined) n = Math.min(p.max, n);
        out[p.id] = n;
        break;
      }
      case 'bool':
        out[p.id] = v === true || v === 'true' || v === 1 || v === '1';
        break;
      case 'select': {
        const allowed = p.options.map((o) => (typeof o === 'string' ? o : o.value));
        out[p.id] = allowed.includes(String(v)) ? String(v) : p.default;
        break;
      }
      case 'color': {
        const s = String(v);
        out[p.id] = /^(#[0-9a-fA-F]{3,8}|rgba?\([\d.\s,%]+\))$/.test(s) ? s : p.default;
        break;
      }
      default:
        out[p.id] = v;
    }
  }
  return out;
}