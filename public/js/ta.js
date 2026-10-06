/**
 * Indicator math.
 *
 * Every function takes the raw bar array (`{time, open, high, low, close,
 * volume}`, ascending by `time`) plus the parameter object produced by
 * `server/indicator-catalog.js`, and returns a plot description that
 * `chart-tile.js` turns into lightweight-charts series.
 *
 * Contract:
 *   plots   [{ key, label, type: 'line'|'histogram'|'area', color, lineWidth,
 *              data: [{ time, value }], priceFormat? }]
 *   bands   [{ upper: key, lower: key, color }]  -> shaded area between lines
 *   levels  [{ value, color, lineStyle, width, title }]
 *   fixed   { min?, max? }                       -> pin the pane scale
 *
 * Warm-up slots are omitted rather than emitted as nulls: lightweight-charts
 * treats gaps as holes and draws cleaner lines.
 */

/** Pull the configured price series out of the bars. */
function src(bars, source = 'close') {
  const out = new Float64Array(bars.length);
  switch (source) {
    case 'open': for (let i = 0; i < bars.length; i += 1) out[i] = bars[i].open; break;
    case 'high': for (let i = 0; i < bars.length; i += 1) out[i] = bars[i].high; break;
    case 'low': for (let i = 0; i < bars.length; i += 1) out[i] = bars[i].low; break;
    case 'hl2': for (let i = 0; i < bars.length; i += 1) out[i] = (bars[i].high + bars[i].low) / 2; break;
    case 'hlc3': for (let i = 0; i < bars.length; i += 1) out[i] = (bars[i].high + bars[i].low + bars[i].close) / 3; break;
    case 'ohlc4': for (let i = 0; i < bars.length; i += 1) out[i] = (bars[i].open + bars[i].high + bars[i].low + bars[i].close) / 4; break;
    default: for (let i = 0; i < bars.length; i += 1) out[i] = bars[i].close;
  }
  return out;
}

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/** `series` (Float64Array) -> plot data with NaN gaps dropped. */
function toData(bars, series) {
  const data = [];
  for (let i = 0; i < bars.length; i += 1) {
    if (isNum(series[i])) data.push({ time: bars[i].time, value: series[i] });
  }
  return data;
}

// ── Primitives ───────────────────────────────────────────────────────────────

/**
 * Rolling-window helper that refuses to compute over a window containing a
 * non-finite value. Inputs to these primitives routinely start with NaN
 * (a 200-period EMA of a 26-period MACD, a smoothed stochastic over a raw
 * stochastic), and a naive running sum would stay NaN forever after.
 */
function windowed(values, length, fn) {
  const out = new Float64Array(values.length).fill(NaN);
  if (length < 1) return out;
  for (let end = length - 1; end < values.length; end += 1) {
    const start = end - length + 1;
    let ok = true;
    for (let i = start; i <= end; i += 1) {
      if (!Number.isFinite(values[i])) { ok = false; break; }
    }
    if (ok) out[end] = fn(start, end);
  }
  return out;
}

/** Index of the first finite run of `length` consecutive values, or -1. */
function firstRun(values, length) {
  let run = 0;
  for (let i = 0; i < values.length; i += 1) {
    run = Number.isFinite(values[i]) ? run + 1 : 0;
    if (run >= length) return i - length + 1;
  }
  return -1;
}

function sma(values, length) {
  return windowed(values, length, (start, end) => {
    let sum = 0;
    for (let i = start; i <= end; i += 1) sum += values[i];
    return sum / length;
  });
}

function ema(values, length) {
  const out = new Float64Array(values.length).fill(NaN);
  if (length < 1) return out;
  const start = firstRun(values, length);
  if (start < 0) return out;

  let seed = 0;
  for (let i = start; i < start + length; i += 1) seed += values[i];
  const k = 2 / (length + 1);
  let prev = seed / length;
  out[start + length - 1] = prev;
  for (let i = start + length; i < values.length; i += 1) {
    if (!Number.isFinite(values[i])) { out[i] = NaN; continue; }
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

/** Wilder's smoothing — used by RSI/ATR/ADX, so it is separate from `ema`. */
function rma(values, length) {
  const out = new Float64Array(values.length).fill(NaN);
  if (length < 1) return out;
  const start = firstRun(values, length);
  if (start < 0) return out;

  let seed = 0;
  for (let i = start; i < start + length; i += 1) seed += values[i];
  let prev = seed / length;
  out[start + length - 1] = prev;
  for (let i = start + length; i < values.length; i += 1) {
    if (!Number.isFinite(values[i])) { out[i] = NaN; continue; }
    prev = (prev * (length - 1) + values[i]) / length;
    out[i] = prev;
  }
  return out;
}

function wma(values, length) {
  const denom = (length * (length + 1)) / 2;
  return windowed(values, length, (start, end) => {
    let acc = 0;
    for (let j = start; j <= end; j += 1) acc += values[j] * (j - start + 1);
    return acc / denom;
  });
}

function stdev(values, length) {
  return windowed(values, length, (start, end) => {
    let mean = 0;
    for (let i = start; i <= end; i += 1) mean += values[i];
    mean /= length;
    let acc = 0;
    for (let i = start; i <= end; i += 1) acc += (values[i] - mean) ** 2;
    return Math.sqrt(acc / length);
  });
}

function highest(values, length) {
  return windowed(values, length, (start, end) => {
    let m = -Infinity;
    for (let i = start; i <= end; i += 1) if (values[i] > m) m = values[i];
    return m;
  });
}

function lowest(values, length) {
  return windowed(values, length, (start, end) => {
    let m = Infinity;
    for (let i = start; i <= end; i += 1) if (values[i] < m) m = values[i];
    return m;
  });
}

/** True range series (needs OHLC, not a single source). */
function trueRange(bars) {
  const out = new Float64Array(bars.length).fill(NaN);
  out[0] = bars[0].high - bars[0].low;
  for (let i = 1; i < bars.length; i += 1) {
    const { high, low } = bars[i];
    const pc = bars[i - 1].close;
    out[i] = Math.max(high - low, Math.abs(high - pc), Math.abs(low - pc));
  }
  return out;
}

/**
 * Average True Range, aligned to the bar index.
 *
 * `trueRange[0]` has no previous close to compare against, so it is dropped
 * before smoothing and the result is shifted back — otherwise every caller
 * reading `atr[i]` would be looking one bar into the past.
 */
function atr(bars, length, useRma = true) {
  const n = bars.length;
  const out = new Float64Array(n).fill(NaN);
  const tr = trueRange(bars);
  const smoothed = useRma ? rma(tr.subarray(1), length) : sma(tr.subarray(1), length);
  for (let i = 1; i < n; i += 1) out[i] = smoothed[i - 1];
  return out;
}

/** Shift a series forward (positive = drop old values, negative = pad). */
function shift(values, offset) {
  if (offset === 0) return values;
  const out = new Float64Array(values.length).fill(NaN);
  for (let i = 0; i < values.length; i += 1) {
    const j = i - offset;
    if (j >= 0 && j < values.length) out[i] = values[j];
  }
  return out;
}

// ── Indicators ───────────────────────────────────────────────────────────────

const REGISTRY = {
  sma(bars, p) {
    const s = src(bars, p.source);
    return {
      plots: [{
        key: 'sma', label: `SMA ${p.length}`, type: 'line',
        color: p.color, lineWidth: p.width, data: toData(bars, sma(s, p.length)),
      }],
      last: p.showLast,
    };
  },

  ema(bars, p) {
    const s = src(bars, p.source);
    return {
      plots: [{
        key: 'ema', label: `EMA ${p.length}`, type: 'line',
        color: p.color, lineWidth: p.width, data: toData(bars, ema(s, p.length)),
      }],
      last: p.showLast,
    };
  },

  wma(bars, p) {
    const s = src(bars, p.source);
    return {
      plots: [{
        key: 'wma', label: `WMA ${p.length}`, type: 'line',
        color: p.color, lineWidth: p.width, data: toData(bars, wma(s, p.length)),
      }],
    };
  },

  vwma(bars, p) {
    const num = new Float64Array(bars.length).fill(NaN);
    const den = new Float64Array(bars.length).fill(NaN);
    for (let i = p.length - 1; i < bars.length; i += 1) {
      let a = 0;
      let b = 0;
      for (let j = i - p.length + 1; j <= i; j += 1) {
        a += bars[j].close * bars[j].volume;
        b += bars[j].volume;
      }
      if (b > 0) { num[i] = a / b; den[i] = b; }
    }
    return {
      plots: [{
        key: 'vwma', label: `VWMA ${p.length}`, type: 'line',
        color: p.color, lineWidth: p.width, data: toData(bars, num),
      }],
    };
  },

  hma(bars, p) {
    const s = src(bars, p.source);
    const half = wma(s, Math.max(1, Math.round(p.length / 2)));
    const full = wma(s, p.length);
    const diff = new Float64Array(s.length).fill(NaN);
    for (let i = 0; i < s.length; i += 1) {
      if (isNum(half[i]) && isNum(full[i])) diff[i] = 2 * half[i] - full[i];
    }
    return {
      plots: [{
        key: 'hma', label: `HMA ${p.length}`, type: 'line',
        color: p.color, lineWidth: p.width, data: toData(bars, wma(diff, Math.max(1, Math.round(Math.sqrt(p.length))))),
      }],
    };
  },

  bb(bars, p) {
    const s = src(bars, p.source);
    const mid = sma(s, p.length);
    const dev = stdev(s, p.length);
    const upper = new Float64Array(s.length).fill(NaN);
    const lower = new Float64Array(s.length).fill(NaN);
    for (let i = 0; i < s.length; i += 1) {
      if (isNum(mid[i]) && isNum(dev[i])) {
        upper[i] = mid[i] + p.mult * dev[i];
        lower[i] = mid[i] - p.mult * dev[i];
      }
    }
    return {
      plots: [
        { key: 'upper', label: 'Upper', type: 'line', color: p.upperColor, lineWidth: p.width, data: toData(bars, upper) },
        { key: 'basis', label: `Basis ${p.length}`, type: 'line', color: p.basisColor, lineWidth: p.width, data: toData(bars, mid) },
        { key: 'lower', label: 'Lower', type: 'line', color: p.lowerColor, lineWidth: p.width, data: toData(bars, lower) },
      ],
      bands: p.fill ? [{ upper: 'upper', lower: 'lower', color: p.basisColor }] : [],
    };
  },

  keltner(bars, p) {
    const s = src(bars, 'hlc3');
    const mid = ema(s, p.length);
    const a = atr(bars, p.atrLength, true);
    const upper = new Float64Array(s.length).fill(NaN);
    const lower = new Float64Array(s.length).fill(NaN);
    for (let i = 1; i < s.length; i += 1) {
      if (isNum(mid[i]) && isNum(a[i])) {
        upper[i] = mid[i] + p.atrMult * a[i];
        lower[i] = mid[i] - p.atrMult * a[i];
      }
    }
    return {
      plots: [
        { key: 'upper', label: 'Upper', type: 'line', color: p.upperColor, lineWidth: p.width, data: toData(bars, upper) },
        { key: 'basis', label: `Basis ${p.length}`, type: 'line', color: p.basisColor, lineWidth: p.width, data: toData(bars, mid) },
        { key: 'lower', label: 'Lower', type: 'line', color: p.lowerColor, lineWidth: p.width, data: toData(bars, lower) },
      ],
      bands: p.fill ? [{ upper: 'upper', lower: 'lower', color: p.basisColor }] : [],
    };
  },

  donchian(bars, p) {
    const highs = Float64Array.from(bars, (b) => b.high);
    const lows = Float64Array.from(bars, (b) => b.low);
    const up = highest(highs, p.length);
    const lo = lowest(lows, p.length);
    const mid = new Float64Array(bars.length).fill(NaN);
    for (let i = 0; i < bars.length; i += 1) {
      if (isNum(up[i]) && isNum(lo[i])) mid[i] = (up[i] + lo[i]) / 2;
    }
    return {
      plots: [
        { key: 'upper', label: 'Upper', type: 'line', color: p.upperColor, lineWidth: 1, data: toData(bars, up) },
        { key: 'basis', label: 'Basis', type: 'line', color: p.basisColor, lineWidth: 1, data: toData(bars, mid) },
        { key: 'lower', label: 'Lower', type: 'line', color: p.lowerColor, lineWidth: 1, data: toData(bars, lo) },
      ],
      bands: p.fill ? [{ upper: 'upper', lower: 'lower', color: p.basisColor }] : [],
    };
  },

  macd(bars, p) {
    const s = src(bars, p.source);
    const fast = ema(s, p.fast);
    const slow = ema(s, p.slow);
    const macd = new Float64Array(s.length).fill(NaN);
    for (let i = 0; i < s.length; i += 1) {
      if (isNum(fast[i]) && isNum(slow[i])) macd[i] = fast[i] - slow[i];
    }
    const signal = ema(macd, p.signal);
    const hist = new Float64Array(s.length).fill(NaN);
    for (let i = 0; i < s.length; i += 1) {
      if (isNum(macd[i]) && isNum(signal[i])) hist[i] = macd[i] - signal[i];
    }
    return {
      plots: [
        {
          key: 'hist',
          label: 'Histogram',
          type: 'histogram',
          color: p.macdColor,
          // Per-point colours so the histogram reads as momentum direction,
          // the way the desktop terminal draws it.
          data: toData(bars, hist).map((pt) => ({
            ...pt,
            color: pt.value >= 0 ? p.histUpColor : p.histDownColor,
          })),
        },
        { key: 'macd', label: 'MACD', type: 'line', color: p.macdColor, lineWidth: 2, data: toData(bars, macd) },
        { key: 'signal', label: 'Signal', type: 'line', color: p.signalColor, lineWidth: 1, data: toData(bars, signal) },
      ],
      levels: [{ value: 0, color: p.zeroColor, lineStyle: 'solid', width: 1 }],
    };
  },

  supertrend(bars, p) {
    const n = bars.length;
    const a = atr(bars, p.atrLength, true);
    const upData = [];
    const downData = [];
    const bandUp = [];
    const bandDown = [];
    if (n < 2) return { plots: [] };

    // Standard construction: build the raw bands, band them against the
    // previous close (the classic "don't let a band tighten through price"),
    // then flip the trend when price closes through the opposite band.
    const rawUpper = new Float64Array(n).fill(NaN);
    const rawLower = new Float64Array(n).fill(NaN);
    for (let i = 0; i < n; i += 1) {
      if (!isNum(a[i])) continue;
      const mid = (bars[i].high + bars[i].low) / 2;
      rawUpper[i] = mid + p.mult * a[i];
      rawLower[i] = mid - p.mult * a[i];
    }

    // Seed the trend from the first two closes. Seeding from anywhere later lets
    // the initial state steer every flip that follows.
    let trend = bars[1].close >= bars[0].close ? 'up' : 'down';

    for (let i = 1; i < n; i += 1) {
      if (!isNum(rawUpper[i]) || !isNum(rawUpper[i - 1])) continue;

      const upper = (rawUpper[i] < rawUpper[i - 1] || bars[i - 1].close > rawUpper[i - 1])
        ? rawUpper[i]
        : rawUpper[i - 1];
      const lower = (rawLower[i] > rawLower[i - 1] || bars[i - 1].close < rawLower[i - 1])
        ? rawLower[i]
        : rawLower[i - 1];

      if (trend === 'down' && bars[i].close > upper) trend = 'up';
      else if (trend === 'up' && bars[i].close < lower) trend = 'down';

      const time = bars[i].time;
      const line = trend === 'up' ? lower : upper;
      (trend === 'up' ? upData : downData).push({ time, value: line });

      if (p.showBands) {
        bandUp.push({ time, value: upper });
        bandDown.push({ time, value: lower });
      }
    }

    const plots = [
      { key: 'up', label: 'Up trend', type: 'line', color: p.upColor, lineWidth: 2, data: upData },
      { key: 'down', label: 'Down trend', type: 'line', color: p.downColor, lineWidth: 2, data: downData },
    ];
    if (p.showBands) {
      plots.push(
        { key: 'bandUpper', label: 'Upper band', type: 'line', color: p.upColor, lineWidth: 1, data: bandUp },
        { key: 'bandLower', label: 'Lower band', type: 'line', color: p.downColor, lineWidth: 1, data: bandDown },
      );
    }
    return { plots };
  },

  psar(bars, p) {
    const n = bars.length;
    if (n < 2) {
      return { plots: [{ key: 'psar', label: 'PSAR', type: 'line', color: p.upColor, lineWidth: 2, data: [] }] };
    }

    let bull = bars[0].close > bars[1].close;
    let acc = p.start;
    let ep = bull ? bars[0].low : bars[0].high;
    let sar = bull ? Math.min(bars[0].low, bars[1].low) : Math.max(bars[0].high, bars[1].high);

    // Two parallel series so the colour flips with the trend, like the dot plot
    // in the desktop terminal.
    const upData = [];
    const downData = [];
    const all = [];

    for (let i = 1; i < n; i += 1) {
      sar += acc * (ep - sar);
      const b = bars[i];
      // Wilder clamps the SAR against the two *previous* extremes. Clamping
      // against the current bar (as an earlier version did) makes the reversal
      // test `high > sar` unreachable, so the trend could never flip.
      const prev = bars[i - 1];
      const prev2 = i >= 2 ? bars[i - 2] : prev;

      if (bull) {
        sar = Math.min(sar, prev.low, prev2.low);
        if (b.low < sar) {
          bull = false;
          sar = ep;
          ep = b.low;
          acc = p.start;
        } else if (b.high > ep) {
          ep = b.high;
          acc = Math.min(p.max, acc + p.step);
        }
      } else {
        sar = Math.max(sar, prev.high, prev2.high);
        if (b.high > sar) {
          bull = true;
          sar = ep;
          ep = b.high;
          acc = p.start;
        } else if (b.low < ep) {
          ep = b.low;
          acc = Math.min(p.max, acc + p.step);
        }
      }

      const point = { time: b.time, value: sar, bull };
      all.push(point);
      (bull ? upData : downData).push(point);
    }

    const plots = p.showDots
      ? [
        { key: 'up', label: 'PSAR (up)', type: 'line', color: p.upColor, lineWidth: 2, data: upData },
        { key: 'down', label: 'PSAR (down)', type: 'line', color: p.downColor, lineWidth: 2, data: downData },
      ]
      : [{ key: 'psar', label: 'PSAR', type: 'line', color: p.upColor, lineWidth: 2, data: all }];

    // The active series must be the one that owns the final bar.
    return { plots, points: all };
  },

  adx(bars, p) {
    const n = bars.length;
    const plus = new Float64Array(n).fill(NaN);
    const minus = new Float64Array(n).fill(NaN);
    const tr = new Float64Array(n).fill(NaN);

    for (let i = 1; i < n; i += 1) {
      const up = bars[i].high - bars[i - 1].high;
      const down = bars[i - 1].low - bars[i].low;
      plus[i] = up > down && up > 0 ? up : 0;
      minus[i] = down > up && down > 0 ? down : 0;
      const pc = bars[i - 1].close;
      tr[i] = Math.max(
        bars[i].high - bars[i].low,
        Math.abs(bars[i].high - pc),
        Math.abs(bars[i].low - pc),
      );
    }

    const smp = rma(plus.subarray(1), p.length);
    const smm = rma(minus.subarray(1), p.length);
    const str = rma(tr.subarray(1), p.length);

    const dip = new Float64Array(n).fill(NaN);
    const dim = new Float64Array(n).fill(NaN);
    const dx = new Float64Array(n).fill(NaN);
    for (let i = 1; i < n; i += 1) {
      const p1 = smp[i - 1];
      const m1 = smm[i - 1];
      const t1 = str[i - 1];
      if (!isNum(p1) || !isNum(m1) || !isNum(t1) || t1 === 0) continue;
      dip[i] = (100 * p1) / t1;
      dim[i] = (100 * m1) / t1;
      const sum = dip[i] + dim[i];
      dx[i] = sum === 0 ? 0 : (100 * Math.abs(dip[i] - dim[i])) / sum;
    }

    const dxTrim = dx.slice(1);
    const adxSeries = rma(dxTrim.filter((v) => isNum(v)), p.adxSmoothing);
    const adxAligned = new Float64Array(n).fill(NaN);
    let k = 0;
    for (let i = 1; i < n; i += 1) {
      if (!isNum(dx[i])) continue;
      if (isNum(adxSeries[k])) adxAligned[i] = adxSeries[k];
      k += 1;
    }

    return {
      plots: [
        { key: 'adx', label: 'ADX', type: 'line', color: p.adxColor, lineWidth: 2, data: toData(bars, adxAligned) },
        { key: 'plus', label: '+DI', type: 'line', color: p.plusColor, lineWidth: 1, data: toData(bars, dip) },
        { key: 'minus', label: '-DI', type: 'line', color: p.minusColor, lineWidth: 1, data: toData(bars, dim) },
      ],
      levels: [{ value: 25, color: p.lineColor ?? '#787b86', lineStyle: 'dashed', width: 1 }],
    };
  },

  ichimoku(bars, p) {
    const highs = Float64Array.from(bars, (b) => b.high);
    const lows = Float64Array.from(bars, (b) => b.low);
    const mid = (len) => {
      const hi = highest(highs, len);
      const lo = lowest(lows, len);
      const out = new Float64Array(bars.length).fill(NaN);
      for (let i = 0; i < bars.length; i += 1) {
        if (isNum(hi[i]) && isNum(lo[i])) out[i] = (hi[i] + lo[i]) / 2;
      }
      return out;
    };

    const tenkan = mid(p.conv);
    const kijun = mid(p.base);
    const spanA = new Float64Array(bars.length).fill(NaN);
    const spanB = new Float64Array(bars.length).fill(NaN);
    for (let i = 0; i < bars.length; i += 1) {
      if (isNum(tenkan[i]) && isNum(kijun[i])) spanA[i] = (tenkan[i] + kijun[i]) / 2;
    }
    const spanBFull = mid(p.spanB);
    for (let i = 0; i < bars.length; i += 1) spanB[i] = spanBFull[i];

    const forward = (s, offset) => shift(s, offset);

    return {
      plots: [
        { key: 'tenkan', label: 'Tenkan', type: 'line', color: p.tenkanColor, lineWidth: 1, data: toData(bars, forward(tenkan, 0)) },
        { key: 'kijun', label: 'Kijun', type: 'line', color: p.kijunColor, lineWidth: 1, data: toData(bars, forward(kijun, 0)) },
        { key: 'spanA', label: 'Span A', type: 'line', color: p.tenkanColor, lineWidth: 1, lineStyle: 2, data: toData(bars, forward(spanA, p.base)) },
        { key: 'spanB', label: 'Span B', type: 'line', color: p.kijunColor, lineWidth: 1, lineStyle: 2, data: toData(bars, forward(spanB, p.base)) },
        ...(p.showChikou
          ? [{
            key: 'chikou', label: 'Chikou', type: 'line', color: '#90a4ae', lineWidth: 1, lineStyle: 3,
            data: toData(bars, shift(src(bars, 'close'), -p.base)),
          }]
          : []),
      ],
      bands: [{ upper: 'spanA', lower: 'spanB', color: p.cloudUpColor, soft: true }],
      bandSplit: {
        spanA: { up: p.cloudUpColor, down: p.cloudDownColor },
        spanB: { up: p.cloudUpColor, down: p.cloudDownColor },
      },
    };
  },

  rsi(bars, p) {
    const s = src(bars, p.source);
    const gains = new Float64Array(s.length).fill(NaN);
    const losses = new Float64Array(s.length).fill(NaN);
    for (let i = 1; i < s.length; i += 1) {
      const d = s[i] - s[i - 1];
      gains[i] = d > 0 ? d : 0;
      losses[i] = d < 0 ? -d : 0;
    }
    const ag = rma(gains.subarray(1), p.length);
    const al = rma(losses.subarray(1), p.length);
    const out = new Float64Array(s.length).fill(NaN);
    for (let i = 1; i < s.length; i += 1) {
      const g = ag[i - 1];
      const l = al[i - 1];
      if (!isNum(g) || !isNum(l)) continue;
      out[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
    }
    return {
      plots: [{
        key: 'rsi', label: `RSI ${p.length}`, type: 'line', color: p.color, lineWidth: p.width, data: toData(bars, out),
      }],
      levels: [
        { value: p.overbought, color: '#ef5350', lineStyle: 'dashed', width: 1 },
        { value: 50, color: '#787b86', lineStyle: 'dotted', width: 1 },
        { value: p.oversold, color: '#26a69a', lineStyle: 'dashed', width: 1 },
      ],
      fixed: { min: 0, max: 100 },
      zones: p.fillBands
        ? [
          { from: p.overbought, to: 100, color: 'rgba(239,83,80,0.08)' },
          { from: 0, to: p.oversold, color: 'rgba(38,166,154,0.08)' },
        ]
        : [],
    };
  },

  stoch(bars, p) {
    const n = bars.length;
    const rawK = new Float64Array(n).fill(NaN);
    for (let i = p.k - 1; i < n; i += 1) {
      let hi = -Infinity;
      let lo = Infinity;
      for (let j = i - p.k + 1; j <= i; j += 1) {
        if (bars[j].high > hi) hi = bars[j].high;
        if (bars[j].low < lo) lo = bars[j].low;
      }
      rawK[i] = hi === lo ? 50 : ((bars[i].close - lo) / (hi - lo)) * 100;
    }
    const k = sma(rawK, Math.max(1, p.smoothK));
    const d = sma(k, Math.max(1, p.d));
    return {
      plots: [
        { key: 'k', label: '%K', type: 'line', color: p.kColor, lineWidth: 2, data: toData(bars, k) },
        { key: 'd', label: '%D', type: 'line', color: p.dColor, lineWidth: 1, data: toData(bars, d) },
      ],
      levels: [
        { value: p.overbought, color: '#ef5350', lineStyle: 'dashed', width: 1 },
        { value: p.oversold, color: '#26a69a', lineStyle: 'dashed', width: 1 },
      ],
      fixed: { min: 0, max: 100 },
    };
  },

  stochRsi(bars, p) {
    const s = src(bars, 'close');
    const gains = new Float64Array(s.length).fill(NaN);
    const losses = new Float64Array(s.length).fill(NaN);
    for (let i = 1; i < s.length; i += 1) {
      const d = s[i] - s[i - 1];
      gains[i] = d > 0 ? d : 0;
      losses[i] = d < 0 ? -d : 0;
    }
    const ag = rma(gains.subarray(1), p.rsiLength);
    const al = rma(losses.subarray(1), p.rsiLength);
    const rsiVals = new Float64Array(s.length).fill(NaN);
    for (let i = 1; i < s.length; i += 1) {
      const g = ag[i - 1];
      const l = al[i - 1];
      if (!isNum(g) || !isNum(l)) continue;
      rsiVals[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
    }

    const stoch = new Float64Array(s.length).fill(NaN);
    for (let i = p.stochLength - 1; i < s.length; i += 1) {
      let hi = -Infinity;
      let lo = Infinity;
      let count = 0;
      for (let j = i - p.stochLength + 1; j <= i; j += 1) {
        if (!isNum(rsiVals[j])) continue;
        count += 1;
        if (rsiVals[j] > hi) hi = rsiVals[j];
        if (rsiVals[j] < lo) lo = rsiVals[j];
      }
      if (count === p.stochLength && hi !== lo) {
        stoch[i] = ((rsiVals[i] - lo) / (hi - lo)) * 100;
      }
    }
    const k = sma(stoch, Math.max(1, p.k));
    const d = sma(k, Math.max(1, p.d));
    return {
      plots: [
        { key: 'k', label: '%K', type: 'line', color: p.kColor, lineWidth: 2, data: toData(bars, k) },
        { key: 'd', label: '%D', type: 'line', color: p.dColor, lineWidth: 1, data: toData(bars, d) },
      ],
      fixed: { min: 0, max: 100 },
      levels: [
        { value: 80, color: '#ef5350', lineStyle: 'dashed', width: 1 },
        { value: 20, color: '#26a69a', lineStyle: 'dashed', width: 1 },
      ],
    };
  },

  cci(bars, p) {
    const s = src(bars, p.source);
    const m = sma(s, p.length);
    const out = new Float64Array(s.length).fill(NaN);
    for (let i = p.length - 1; i < s.length; i += 1) {
      let dev = 0;
      for (let j = i - p.length + 1; j <= i; j += 1) dev += Math.abs(s[j] - m[i]);
      dev /= p.length;
      out[i] = dev === 0 ? 0 : (s[i] - m[i]) / (0.015 * dev);
    }
    return {
      plots: [{
        key: 'cci', label: `CCI ${p.length}`, type: 'line', color: p.color, lineWidth: 2, data: toData(bars, out),
      }],
      levels: [
        { value: p.upper, color: p.lineColor, lineStyle: 'dashed', width: 1 },
        { value: 0, color: p.lineColor, lineStyle: 'dotted', width: 1 },
        { value: p.lower, color: p.lineColor, lineStyle: 'dashed', width: 1 },
      ],
    };
  },

  roc(bars, p) {
    const s = src(bars, p.source);
    const out = new Float64Array(s.length).fill(NaN);
    for (let i = p.length; i < s.length; i += 1) {
      const base = s[i - p.length];
      out[i] = base === 0 ? 0 : ((s[i] - base) / base) * 100;
    }
    return {
      plots: [{
        key: 'roc', label: `ROC ${p.length}`, type: 'line', color: p.color, lineWidth: 2, data: toData(bars, out),
      }],
      levels: p.showZero
        ? [{ value: 0, color: '#787b86', lineStyle: 'solid', width: 1 }]
        : [],
    };
  },

  mfi(bars, p) {
    const n = bars.length;
    const typical = Float64Array.from(bars, (b) => (b.high + b.low + b.close) / 3);
    const pos = new Float64Array(n).fill(NaN);
    const neg = new Float64Array(n).fill(NaN);
    for (let i = 1; i < n; i += 1) {
      const flow = typical[i] * bars[i].volume;
      pos[i] = typical[i] > typical[i - 1] ? flow : 0;
      neg[i] = typical[i] < typical[i - 1] ? flow : 0;
    }
    const sp = sma(pos.subarray(1), p.length);
    const sn = sma(neg.subarray(1), p.length);
    const out = new Float64Array(n).fill(NaN);
    for (let i = 1; i < n; i += 1) {
      const p1 = sp[i - 1];
      const n1 = sn[i - 1];
      if (!isNum(p1) || !isNum(n1)) continue;
      out[i] = n1 === 0 ? 100 : 100 - 100 / (1 + p1 / n1);
    }
    return {
      plots: [{
        key: 'mfi', label: `MFI ${p.length}`, type: 'line', color: p.color, lineWidth: 2, data: toData(bars, out),
      }],
      levels: [
        { value: p.overbought, color: '#ef5350', lineStyle: 'dashed', width: 1 },
        { value: p.oversold, color: '#26a69a', lineStyle: 'dashed', width: 1 },
      ],
      fixed: { min: 0, max: 100 },
    };
  },

  williamsR(bars, p) {
    const n = bars.length;
    const out = new Float64Array(n).fill(NaN);
    for (let i = p.length - 1; i < n; i += 1) {
      let hi = -Infinity;
      let lo = Infinity;
      for (let j = i - p.length + 1; j <= i; j += 1) {
        if (bars[j].high > hi) hi = bars[j].high;
        if (bars[j].low < lo) lo = bars[j].low;
      }
      out[i] = hi === lo ? -50 : ((hi - bars[i].close) / (hi - lo)) * -100;
    }
    return {
      plots: [{
        key: 'wr', label: `%R ${p.length}`, type: 'line', color: p.color, lineWidth: 2, data: toData(bars, out),
      }],
      levels: [
        { value: p.overbought, color: '#ef5350', lineStyle: 'dashed', width: 1 },
        { value: p.oversold, color: '#26a69a', lineStyle: 'dashed', width: 1 },
      ],
      fixed: { min: -100, max: 0 },
    };
  },

  volume(bars, p) {
    const data = bars.map((b) => ({
      time: b.time,
      value: b.volume,
      color: b.close >= b.open ? p.upColor : p.downColor,
    }));
    // `volume` is a price-format hint for lightweight-charts: it renders
    // 200,000,000 as 200M instead of a nine-digit axis label.
    const plots = [{
      key: 'volume',
      label: 'Volume',
      type: 'histogram',
      priceFormat: 'volume',
      data,
    }];

    if (p.showMa && p.maType !== 'none') {
      const vols = Float64Array.from(bars, (b) => b.volume);
      const ma = p.maType === 'ema' ? ema(vols, p.maLength) : sma(vols, p.maLength);
      plots.push({
        key: 'ma', label: `${p.maType.toUpperCase()} ${p.maLength}`, type: 'line',
        color: p.maColor, lineWidth: 2, lineVisible: true, priceScaleId: 'vol-ma',
        data: toData(bars, ma),
      });
    }
    return { plots, volumeOverlay: true };
  },

  obv(bars, p) {
    const n = bars.length;
    const out = new Float64Array(n).fill(NaN);
    out[0] = 0;
    for (let i = 1; i < n; i += 1) {
      const diff = bars[i].close - bars[i - 1].close;
      out[i] = out[i - 1] + (diff > 0 ? bars[i].volume : diff < 0 ? -bars[i].volume : 0);
    }
    const plots = [{
      key: 'obv', label: 'OBV', type: 'line', color: p.color, lineWidth: 2, data: toData(bars, out),
    }];
    if (p.showSignal) {
      plots.push({
        key: 'signal', label: `Signal ${p.length}`, type: 'line', color: p.signalColor, lineWidth: 1,
        data: toData(bars, ema(out, p.length)),
      });
    }
    return { plots };
  },

  atr(bars, p) {
    // `atr()` is already bar-aligned; no shift needed here.
    const out = atr(bars, p.length, p.smoothing);
    return {
      plots: [{
        key: 'atr', label: `ATR ${p.length}`, type: 'line', color: p.color, lineWidth: 2, data: toData(bars, out),
      }],
    };
  },
};

/**
 * Compute an indicator instance.
 * @returns {null|{plots:Array, levels:Array, bands:Array, fixed:object, labels:Array}}
 */
export function computeIndicator(type, bars, params) {
  const fn = REGISTRY[type];
  if (!fn || !bars?.length) return null;
  try {
    const result = fn(bars, params ?? {});
    return {
      plots: result.plots ?? [],
      levels: result.levels ?? [],
      bands: result.bands ?? [],
      zones: result.zones ?? [],
      fixed: result.fixed ?? null,
      volumeOverlay: result.volumeOverlay ?? false,
      // Raw point list for indicators that split one series by state (PSAR).
      points: result.points ?? [],
      labels: (result.plots ?? [])
        .map((plot) => plot.label)
        .filter(Boolean),
    };
  } catch (err) {
    console.warn(`[ta] ${type} failed:`, err);
    return null;
  }
}

export const SUPPORTED_INDICATORS = Object.keys(REGISTRY);