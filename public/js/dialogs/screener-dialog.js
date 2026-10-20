/**
 * The value screen — Arjan Kavee's framework, applied to a list of symbols.
 *
 * Two views in one modal:
 *
 *   the table   one row per symbol: quality score, the ratios that decide it,
 *               the margin of safety, and whether the chosen preset kept it
 *   the detail  one company in full: the rule-by-rule scorecard, a live
 *               valuation calculator, and the stock's own P/E and P/BV bands
 *
 * The screen runs on the server (`/api/screener/run`) because the statements it
 * needs are fetched, four years at a time, from outside — and cached there for
 * twelve hours. The calculator, though, re-queries per keystroke: the whole
 * point of tuning `r` or `g1` is watching the intrinsic value move, and the
 * cached statements make each round trip a few milliseconds. Recomputing it in
 * the browser would mean a second copy of the discount formula, and a second
 * copy is a second answer waiting to disagree with the first.
 */
import { modal, escape, section, toast } from '../ui.js';
import { t, tp } from '../i18n.js';
import { api } from '../api.js';

/** Preset ids, in the order the chips are shown. */
const PRESETS = ['moat', 'quality', 'dividend', 'value', 'all'];

/** Rule ids in scorecard order, matching `scoreQuality()` on the server. */
const CHECK_ORDER = [
  'roeLevel', 'roeConsistency', 'roaLevel', 'npmLevel', 'npmTrend', 'npmPositive',
  'debtLevel', 'interestCoverage', 'cfoPositive', 'cfoBeatsEarnings', 'fcfPositive',
  'dividendYield', 'payoutBand', 'dividendStreak',
];

/** Formats a check's measured value according to what the rule measures. */
const RATIO_CHECKS = new Set([
  'roeLevel', 'roaLevel', 'npmLevel', 'dividendYield', 'payoutBand', 'npmTrend',
]);
/** Ratios quoted as a plain number, like the D/E the framework specifies. */
const DECIMAL_CHECKS = new Set(['debtLevel']);
const MULTIPLE_CHECKS = new Set(['interestCoverage']);
const YEAR_CHECKS = new Set(['dividendStreak']);
const COUNT_CHECKS = new Set([
  'roeConsistency', 'npmPositive', 'cfoPositive', 'cfoBeatsEarnings', 'fcfPositive',
]);

function formatCheckValue(check) {
  const v = check.value;
  if (v == null || !Number.isFinite(v)) return '—';
  if (COUNT_CHECKS.has(check.id)) return `${v}/${check.of ?? check.threshold}`;
  if (YEAR_CHECKS.has(check.id)) return tp('scr.years', v);
  if (MULTIPLE_CHECKS.has(check.id)) return `${v.toFixed(1)}×`;
  if (DECIMAL_CHECKS.has(check.id)) return v.toFixed(2);
  if (RATIO_CHECKS.has(check.id)) return `${(v * 100).toFixed(1)}%`;
  return String(v);
}

const percent = (v, digits = 1) =>
  v == null || !Number.isFinite(v) ? '—' : `${(v * 100).toFixed(digits)}%`;

const money = (v, currency = '') =>
  v == null || !Number.isFinite(v)
    ? '—'
    : `${v.toFixed(2)}${currency ? ` ${currency}` : ''}`;

/**
 * Score → colour band.
 *
 * The thresholds are the presets' own: a name at 65 clears the moat screen, a
 * name below 50 fails everything. Using the same numbers here means the colour
 * of the badge and the fact that a preset kept the row never contradict.
 */
function scoreTone(score) {
  if (score >= 75) return 'good';
  if (score >= 55) return 'ok';
  return 'poor';
}

/**
 * @param {object} opts
 * @param {import('../board.js').Board} opts.board
 * @param {string} [opts.symbol] open straight into one company
 */
export function openScreener({ board, symbol = null }) {
  const state = {
    preset: 'moat',
    universe: 'set-large',
    lists: [],
    result: null,
    loading: false,
    error: null,
    detail: null,
    detailSymbol: null,
    overrides: { r: 0.09, g1: null, g2: 0.03, years: 5 },
  };

  let render = () => {};

  const handle = modal({
    title: t('scr.title'),
    subtitle: t('scr.subtitle'),
    size: 'xl',
    render: (body) => {
      // One repaint closes over everything it needs, so every interaction below
      // can call the same function rather than threading state back out.
      render = () => paint(body, state, board);
      render();
    },
    footer: (foot) => {
      foot.innerHTML = `<span class="spacer"></span>
        <button class="btn" data-close>${escape(t('common.close'))}</button>`;
    },
  });

  loadUniverses(state, render).then(() => {
    if (symbol) openDetail(state, render, symbol);
    else runScreen(state, render);
  });

  return handle;
}

async function loadUniverses(state, render) {
  try {
    const res = await api.screenerUniverse();
    state.lists = res.lists ?? [];
    if (state.lists.length && !state.lists.some((l) => l.id === state.universe)) {
      state.universe = state.lists[0].id;
    }
  } catch (err) {
    state.error = err;
  }
  render();
}

async function runScreen(state, render) {
  state.loading = true;
  state.error = null;
  render();
  try {
    state.result = await api.screenerRun({ universe: state.universe, preset: state.preset });
  } catch (err) {
    state.error = err;
    state.result = null;
  } finally {
    state.loading = false;
    render();
  }
}

async function openDetail(state, render, symbol) {
  state.detailSymbol = symbol;
  state.overrides = { r: 0.09, g1: null, g2: 0.03, years: 5 };
  render();
  await refreshDetail(state, render);
}

/** Re-query the valuation for the current sliders. Debounced by the caller. */
async function refreshDetail(state, render) {
  if (!state.detailSymbol) return;
  try {
    const overrides = { r: state.overrides.r, g2: state.overrides.g2 };
    if (state.overrides.g1 != null) overrides.g1 = state.overrides.g1;
    state.detail = await api.screenerStock(state.detailSymbol, overrides);
    state.error = null;
  } catch (err) {
    state.error = err;
  } finally {
    render();
  }
}

function paint(body, state, board) {
  const rerender = () => paint(body, state, board);
  body.innerHTML = '';
  body.classList.add('screener-body');

  if (state.detailSymbol) {
    paintDetail(body, state, board, rerender);
    return;
  }
  paintToolbar(body, state, rerender);
  paintResults(body, state, rerender);
}

// ── Search view ─────────────────────────────────────────────────────────────

function paintToolbar(body, state, rerender) {
  const bar = document.createElement('div');
  bar.className = 'scr-toolbar';

  const presets = document.createElement('div');
  presets.className = 'scr-presets';
  for (const id of PRESETS) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = `scr-chip${state.preset === id ? ' is-on' : ''}`;
    chip.textContent = t(`scr.preset.${id}`);
    chip.title = t(`scr.preset.${id}.hint`);
    chip.addEventListener('click', () => {
      state.preset = id;
      runScreen(state, rerender);
    });
    presets.appendChild(chip);
  }
  bar.appendChild(presets);

  const controls = document.createElement('div');
  controls.className = 'scr-controls';

  const select = document.createElement('select');
  select.className = 'input input--select';
  for (const list of state.lists) {
    const opt = document.createElement('option');
    opt.value = list.id;
    opt.textContent = `${list.label} (${list.count})`;
    if (list.id === state.universe) opt.selected = true;
    select.appendChild(opt);
  }
  select.addEventListener('change', () => {
    state.universe = select.value;
  });
  controls.appendChild(select);

  const run = document.createElement('button');
  run.type = 'button';
  run.className = 'btn btn--primary';
  run.textContent = state.loading ? t('scr.running') : t('scr.run');
  run.disabled = state.loading;
  run.addEventListener('click', () => runScreen(state, rerender));
  controls.appendChild(run);

  bar.appendChild(controls);
  body.appendChild(bar);
}

function paintResults(body, state, rerender) {
  if (state.error) {
    const box = document.createElement('p');
    box.className = 'section__hint is-error';
    box.textContent = t('scr.err', { msg: state.error.message });
    body.appendChild(box);
    return;
  }
  if (state.loading) {
    const box = document.createElement('p');
    box.className = 'section__hint';
    box.textContent = t('scr.loading');
    body.appendChild(box);
    return;
  }
  if (!state.result) return;

  const { rows, matched, errors, meta } = state.result;

  const summary = document.createElement('p');
  summary.className = 'section__hint';
  summary.textContent = t('scr.summary', {
    matched,
    screened: meta.screened,
    failed: meta.failed,
    seconds: (meta.tookMs / 1000).toFixed(1),
  });
  body.appendChild(summary);

  if (rows.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'section__hint';
    empty.textContent = t('scr.empty');
    body.appendChild(empty);
  } else {
    body.appendChild(buildTable(rows, state, rerender));
  }

  if (errors?.length) {
    const note = document.createElement('p');
    note.className = 'section__hint';
    note.textContent = t('scr.noData', {
      symbols: errors.map((e) => e.bare).join(', '),
    });
    body.appendChild(note);
  }
}

function buildTable(rows, state, rerender) {
  const wrap = document.createElement('div');
  wrap.className = 'scr-table-wrap';

  const table = document.createElement('table');
  table.className = 'scr-table';
  table.innerHTML = `
    <thead><tr>
      <th>${escape(t('scr.col.symbol'))}</th>
      <th class="num">${escape(t('scr.col.score'))}</th>
      <th class="num">${escape(t('scr.col.roe'))}</th>
      <th class="num">${escape(t('scr.col.de'))}</th>
      <th class="num">${escape(t('scr.col.yield'))}</th>
      <th class="num">${escape(t('scr.col.pe'))}</th>
      <th class="num">${escape(t('scr.col.mos'))}</th>
    </tr></thead>`;

  const tbody = document.createElement('tbody');
  for (const row of rows) {
    const tr = document.createElement('tr');
    // A row the preset rejected stays visible but dimmed, with the rule that
    // stopped it as a tooltip — "why is this not in the list" is half of what
    // a screen is for.
    tr.className = row.pass ? '' : 'is-out';
    if (!row.pass && row.failReason) tr.title = t('scr.rejected', { reason: row.failReason });
    tr.innerHTML = `
      <td><b>${escape(row.bare)}</b><span class="scr-name">${escape(row.name ?? '')}</span></td>
      <td class="num"><span class="scr-score is-${scoreTone(row.score)}">${row.score}</span></td>
      <td class="num">${percent(row.roe3)}</td>
      <td class="num">${row.de == null ? '—' : row.de.toFixed(2)}</td>
      <td class="num">${percent(row.dividendYield)}${row.hasSpecialDividend ? `<i class="scr-flag" title="${escape(t('scr.special'))}">*</i>` : ''}</td>
      <td class="num">${row.bands?.pe ? row.bands.pe.current.toFixed(1) : '—'}</td>
      <td class="num ${row.ddm.mos > 0 ? 'is-up' : 'is-down'}">${row.ddm.mos == null ? '—' : `${row.ddm.mos.toFixed(0)}%`}</td>`;
    tr.addEventListener('click', () => openDetail(state, rerender, row.symbol));
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  wrap.appendChild(table);
  return wrap;
}

// ── Detail view ─────────────────────────────────────────────────────────────

function paintDetail(body, state, board, rerender) {
  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'btn btn--sm scr-back';
  back.textContent = `← ${t('scr.back')}`;
  back.addEventListener('click', () => {
    state.detailSymbol = null;
    state.detail = null;
    rerender();
  });
  body.appendChild(back);

  if (state.error) {
    const box = document.createElement('p');
    box.className = 'section__hint is-error';
    box.textContent = t('scr.err', { msg: state.error.message });
    body.appendChild(box);
    return;
  }
  const detail = state.detail;
  if (!detail) {
    const box = document.createElement('p');
    box.className = 'section__hint';
    box.textContent = t('scr.loading');
    body.appendChild(box);
    return;
  }

  body.appendChild(headline(detail, board));

  const grid = document.createElement('div');
  grid.className = 'scr-detail-grid';
  grid.appendChild(scorecard(detail));
  grid.appendChild(calculator(detail, state, rerender));
  body.appendChild(grid);

  body.appendChild(bandsBlock(detail));
  body.appendChild(financialsBlock(detail));
}

function headline(detail, board) {
  const el = document.createElement('div');
  el.className = 'scr-headline';
  el.innerHTML = `
    <div>
      <h3>${escape(detail.bare)} <span class="scr-score is-${scoreTone(detail.score)}">${detail.score}</span></h3>
      <p class="section__hint">${escape(detail.name ?? '')} · ${escape(detail.currency ?? '')}
        · ${escape(t('scr.price'))} ${money(detail.price)}</p>
    </div>`;

  const actions = document.createElement('div');
  actions.className = 'scr-headline__actions';
  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'btn btn--sm';
  add.textContent = t('scr.addToBoard');
  add.addEventListener('click', () => {
    if (!board) return;
    // `addChart` appends unconditionally, unlike the batch `addCharts`. Checking
    // first means a second click reports the truth instead of quietly doubling
    // the tile.
    const onBoard = (board.workspace?.charts ?? []).some((c) => c.symbol === detail.symbol);
    if (onBoard) {
      toast(t('scr.alreadyOnBoard', { symbol: detail.bare }), { type: 'info' });
      return;
    }
    board.addChart({ symbol: detail.symbol });
    toast(t('scr.added', { symbol: detail.bare }));
  });
  actions.appendChild(add);
  el.appendChild(actions);
  return el;
}

function scorecard(detail) {
  const box = document.createElement('div');
  box.appendChild(section(t('scr.scorecard'), t('scr.scorecardHint', {
    passed: detail.passed,
    total: detail.checks.length,
    years: detail.yearCount,
  })));

  const list = document.createElement('div');
  list.className = 'scr-checks';
  const byId = new Map(detail.checks.map((c) => [c.id, c]));
  for (const id of CHECK_ORDER) {
    const check = byId.get(id);
    if (!check) continue;
    const verdict = check.pass === true ? 'pass'
      : check.pass === null ? 'na'
        : check.warn ? 'warn' : 'fail';
    const row = document.createElement('div');
    row.className = `scr-check is-${verdict}`;
    row.innerHTML = `
      <span class="scr-check__mark">${verdict === 'pass' ? '✓' : verdict === 'na' ? '–' : verdict === 'warn' ? '!' : '✕'}</span>
      <span class="scr-check__label">${escape(t(`scr.check.${id}`))}</span>
      <span class="scr-check__value">${escape(formatCheckValue(check))}</span>
      <span class="scr-check__verdict">${escape(t(`scr.verdict.${verdict}`))}</span>`;
    row.title = t(`scr.check.${id}.hint`, { threshold: formatThreshold(check) });
    list.appendChild(row);
  }
  box.appendChild(list);
  return box;
}

function formatThreshold(check) {
  if (!Number.isFinite(check.threshold)) return '—';
  if (COUNT_CHECKS.has(check.id)) return `${check.threshold}`;
  if (YEAR_CHECKS.has(check.id)) return `${check.threshold}`;
  if (MULTIPLE_CHECKS.has(check.id)) return `${check.threshold}×`;
  if (RATIO_CHECKS.has(check.id)) return `${(check.threshold * 100).toFixed(0)}%`;
  return String(check.threshold);
}

/**
 * The valuation calculator.
 *
 * Sliders, not number inputs: the point is to feel how sensitive the answer is,
 * and clicking through a range shows that faster than typing does. Each change
 * re-asks the server, which owns the only copy of the formula.
 */
function calculator(detail, state, rerender) {
  const box = document.createElement('div');
  box.className = 'scr-calc';
  box.appendChild(section(t('scr.valuation'), t('scr.valuationHint')));

  const ddm = detail.ddm;
  const controls = [
    { key: 'r', label: t('scr.r'), min: 5, max: 20, step: 0.5, value: state.overrides.r * 100,
      hint: t('scr.r.hint') },
    { key: 'g1', label: t('scr.g1'), min: 0, max: 15, step: 0.5,
      value: (state.overrides.g1 ?? ddm.g1) * 100, hint: t('scr.g1.hint') },
    { key: 'g2', label: t('scr.g2'), min: 0, max: 5, step: 0.25, value: state.overrides.g2 * 100,
      hint: t('scr.g2.hint') },
  ];

  let debounce = null;
  for (const control of controls) {
    const wrap = document.createElement('label');
    wrap.className = 'scr-slider';
    wrap.innerHTML = `
      <span class="scr-slider__label">${escape(control.label)}
        <b data-role="out">${control.value.toFixed(2)}%</b></span>
      <input type="range" min="${control.min}" max="${control.max}" step="${control.step}"
             value="${control.value}">
      <span class="field__hint">${escape(control.hint)}</span>`;
    const input = wrap.querySelector('input');
    const out = wrap.querySelector('[data-role=out]');
    input.addEventListener('input', () => {
      const value = Number(input.value) / 100;
      out.textContent = `${Number(input.value).toFixed(2)}%`;
      state.overrides[control.key] = value;
      clearTimeout(debounce);
      debounce = setTimeout(() => refreshDetail(state, rerender), 180);
    });
    box.appendChild(wrap);
  }

  const reset = document.createElement('button');
  reset.type = 'button';
  reset.className = 'btn btn--sm';
  reset.textContent = t('scr.reset');
  reset.addEventListener('click', () => {
    state.overrides = { r: 0.09, g1: null, g2: 0.03, years: 5 };
    refreshDetail(state, rerender);
  });
  box.appendChild(reset);

  const out = document.createElement('div');
  out.className = 'scr-calc__out';
  if (!ddm.ok) {
    out.innerHTML = `<p class="section__hint">${escape(t(`scr.ddm.${ddm.reason ?? 'not-computable'}`))}</p>`;
  } else {
    out.innerHTML = `
      <div><span>${escape(t('scr.intrinsic'))}</span>
        <b>${money(ddm.intrinsic, detail.currency)}</b></div>
      <div><span>${escape(t('scr.mos'))}</span>
        <b class="${ddm.mos > 0 ? 'is-up' : 'is-down'}">${ddm.mos.toFixed(1)}%</b></div>
      <div><span>${escape(t('scr.d0'))}</span><b>${money(ddm.d0)}</b></div>
      <div><span>${escape(t('scr.dps.ttm'))}</span><b>${money(detail.ttmDps)}</b></div>`;
  }
  box.appendChild(out);
  return box;
}

/**
 * The band charts.
 *
 * The ratio itself is plotted, not the price, so the mean and the ±1/±2 SD
 * lines share one axis with the series — a price line with ratio bands drawn
 * across it invites reading a crossing that is not there.
 */
function bandsBlock(detail) {
  const box = document.createElement('div');
  box.appendChild(section(t('scr.band'), t('scr.bandHint', { years: detail.bands.basis })));

  const grid = document.createElement('div');
  grid.className = 'scr-bands';
  for (const [key, label] of [['pe', t('scr.band.pe')], ['pbv', t('scr.band.pbv')]]) {
    const band = detail.bands[key];
    const points = key === 'pe' ? detail.pePoints : detail.pbvPoints;
    const levels = key === 'pe' ? detail.peLevels : detail.pbvLevels;
    const cell = document.createElement('div');
    cell.className = 'scr-band';

    if (!band || !points?.length) {
      cell.innerHTML = `<h4>${escape(label)}</h4>
        <p class="section__hint">${escape(t('scr.band.none'))}</p>`;
      grid.appendChild(cell);
      continue;
    }

    cell.innerHTML = `
      <h4>${escape(label)}
        <span>${escape(t('scr.band.now'))} ${band.current.toFixed(2)}
        · ${escape(t('scr.band.z'))} ${band.z.toFixed(2)}σ</span></h4>
      <canvas height="150"></canvas>
      <table class="scr-band__levels">
        <tr><td>${escape(t('scr.band.plus2'))}</td><td>${levels.plus2.toFixed(2)}</td></tr>
        <tr><td>${escape(t('scr.band.plus1'))}</td><td>${levels.plus1.toFixed(2)}</td></tr>
        <tr><td>${escape(t('scr.band.mean'))}</td><td>${levels.mean.toFixed(2)}</td></tr>
        <tr><td>${escape(t('scr.band.minus1'))}</td><td>${levels.minus1.toFixed(2)}</td></tr>
        <tr><td>${escape(t('scr.band.minus2'))}</td><td>${levels.minus2.toFixed(2)}</td></tr>
      </table>`;
    grid.appendChild(cell);
    // Laid out after insertion: a canvas in a detached node has no width.
    requestAnimationFrame(() => drawBand(cell.querySelector('canvas'), points, levels, band.current));
  }
  box.appendChild(grid);
  return box;
}

/**
 * Draw one band chart on a canvas.
 *
 * Deliberately dependency-free: the board's charts are TradingView's, but
 * pulling a charting library into a modal for one 150px line would be more
 * machinery than the drawing needs.
 */
function drawBand(canvas, points, levels, current) {
  if (!canvas) return;
  const dpr = window.devicePixelRatio || 1;
  const width = canvas.clientWidth || 320;
  const height = canvas.clientHeight || 150;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, width, height);

  const pad = { top: 8, right: 40, bottom: 14, left: 6 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;

  const values = points.map((p) => p.value).concat([levels.plus2, levels.minus2]);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const x = (i) => pad.left + (points.length === 1 ? 0 : (i / (points.length - 1)) * plotW);
  const y = (v) => pad.top + plotH - ((v - min) / span) * plotH;

  const style = getComputedStyle(document.documentElement);
  const line = style.getPropertyValue('--text-dim').trim() || '#888';
  const accent = style.getPropertyValue('--accent').trim() || '#2962ff';
  const up = style.getPropertyValue('--up').trim() || '#26a69a';
  const down = style.getPropertyValue('--down').trim() || '#ef5350';

  // The bands, then the series on top, so the price line is never hidden.
  const guides = [
    [levels.plus2, down, '+2σ'],
    [levels.plus1, down, '+1σ'],
    [levels.mean, line, 'x̄'],
    [levels.minus1, up, '−1σ'],
    [levels.minus2, up, '−2σ'],
  ];
  ctx.font = '9px system-ui, sans-serif';
  ctx.textBaseline = 'middle';
  for (const [value, colour, label] of guides) {
    ctx.strokeStyle = colour;
    ctx.globalAlpha = label === 'x̄' ? 0.55 : 0.35;
    ctx.setLineDash(label === 'x̄' ? [] : [3, 3]);
    ctx.beginPath();
    ctx.moveTo(pad.left, y(value));
    ctx.lineTo(pad.left + plotW, y(value));
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillStyle = colour;
    ctx.fillText(label, pad.left + plotW + 4, y(value));
  }
  ctx.setLineDash([]);

  ctx.strokeStyle = accent;
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  points.forEach((point, i) => {
    const px = x(i);
    const py = y(point.value);
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  });
  ctx.stroke();

  ctx.fillStyle = accent;
  ctx.beginPath();
  ctx.arc(x(points.length - 1), y(current), 3, 0, Math.PI * 2);
  ctx.fill();
}

/** The four statements' worth of numbers the screen is built out of. */
function financialsBlock(detail) {
  const box = document.createElement('div');
  box.appendChild(section(t('scr.fin'), t('scr.finHint')));

  const wrap = document.createElement('div');
  wrap.className = 'scr-table-wrap';
  const table = document.createElement('table');
  table.className = 'scr-table scr-table--years';
  table.innerHTML = `<thead><tr>
      <th>${escape(t('scr.fin.year'))}</th>
      <th class="num">${escape(t('scr.fin.roe'))}</th>
      <th class="num">${escape(t('scr.fin.roa'))}</th>
      <th class="num">${escape(t('scr.fin.npm'))}</th>
      <th class="num">${escape(t('scr.fin.de'))}</th>
      <th class="num">${escape(t('scr.fin.eps'))}</th>
      <th class="num">${escape(t('scr.fin.bvps'))}</th>
      <th class="num">${escape(t('scr.fin.dps'))}</th>
    </tr></thead>`;
  const tbody = document.createElement('tbody');
  for (const year of detail.years) {
    const dps = year.dpsStatement ?? year.dpsPaid;
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${year.fiscalYear}</td>
      <td class="num">${percent(year.roe)}</td>
      <td class="num">${percent(year.roa)}</td>
      <td class="num">${percent(year.npm)}</td>
      <td class="num">${year.de == null ? '—' : year.de.toFixed(2)}</td>
      <td class="num">${year.eps == null ? '—' : year.eps.toFixed(2)}</td>
      <td class="num">${year.bvps == null ? '—' : year.bvps.toFixed(2)}</td>
      <td class="num">${dps == null ? '—' : dps.toFixed(2)}</td>`;
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  wrap.appendChild(table);
  box.appendChild(wrap);
  return box;
}