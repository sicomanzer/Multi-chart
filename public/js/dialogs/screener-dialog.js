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
import { t, tp, timeString, isThai } from '../i18n.js';
import { api } from '../api.js';

/** Preset ids, in the order the chips are shown. */
const PRESETS = ['moat', 'quality', 'dividend', 'value', 'all'];

/** Rule ids in scorecard order, matching `scoreQuality()` on the server. */
const CHECK_ORDER = [
  'roeLevel', 'roeConsistency', 'roaLevel', 'npmLevel', 'npmTrend', 'npmPositive',
  'epsGrowth', 'revenueGrowth', 'earningsStability',
  'debtLevel', 'interestCoverage', 'cfoPositive', 'cfoBeatsEarnings', 'fcfPositive',
  'dividendYield', 'payoutBand', 'dividendStreak',
];

/** Formats a check's measured value according to what the rule measures. */
const RATIO_CHECKS = new Set([
  'roeLevel', 'roaLevel', 'npmLevel', 'dividendYield', 'payoutBand', 'npmTrend',
  'epsGrowth', 'revenueGrowth',
]);
/** Ratios quoted as a plain number, like the D/E the framework specifies. */
const DECIMAL_CHECKS = new Set(['debtLevel']);
const MULTIPLE_CHECKS = new Set(['interestCoverage']);
const YEAR_CHECKS = new Set(['dividendStreak']);
const COUNT_CHECKS = new Set([
  'roeConsistency', 'npmPositive', 'cfoPositive', 'cfoBeatsEarnings', 'fcfPositive',
  'earningsStability',
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
 * How often an open screen re-prices itself.
 *
 * The board polls every ten seconds because a chart is read in real time; a
 * screen is read over minutes, and a run over a hundred names costs a hundred
 * quote lookups. A minute is the interval at which the table still shows what
 * the button would return, without turning the exchange into a hot loop.
 */
const AUTO_MS = 60_000;

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
    universe: 'set100',
    lists: [],
    result: null,
    loading: false,
    // A background refresh keeps the table on screen while it re-prices; the
    // foreground one is allowed to replace it with a spinner.
    refreshing: false,
    auto: true,
    updatedAt: null,
    error: null,
    detail: null,
    detailSymbol: null,
    // The same defaults the server uses, so the table and the calculator quote
    // the same intrinsic value before anyone touches a slider.
    overrides: { r: 0.09, g1: 0.05, g2: 0.05, years: 5 },
  };

  let render = () => {};
  let timer = null;

  // One tick at a time: a run slower than the interval must not stack a second
  // one behind it, and the detail view refreshes its own figures.
  const tick = () => {
    if (!state.auto || state.loading || state.refreshing || state.detailSymbol) return;
    runScreen(state, render, { background: true });
  };
  const setAuto = (on, { immediate = false } = {}) => {
    state.auto = on;
    clearInterval(timer);
    timer = on ? setInterval(tick, AUTO_MS) : null;
    if (on && immediate) tick();
  };

  const handle = modal({
    title: t('scr.title'),
    subtitle: t('scr.subtitle'),
    size: 'xl',
    render: (body) => {
      // One repaint closes over everything it needs, so every interaction below
      // can call the same function rather than threading state back out.
      render = () => paint(body, state, board, setAuto);
      render();
    },
    onClose: () => clearInterval(timer),
    footer: (foot) => {
      foot.innerHTML = `<span class="spacer"></span>
        <button class="btn" data-close>${escape(t('common.close'))}</button>`;
    },
  });

  loadUniverses(state, render).then(() => {
    if (symbol) openDetail(state, render, symbol);
    else runScreen(state, render);
  });

  setAuto(state.auto);

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

async function runScreen(state, render, { background = false } = {}) {
  if (background) {
    state.refreshing = true;
  } else {
    state.loading = true;
    state.error = null;
    render();
  }
  try {
    state.result = await api.screenerRun({ universe: state.universe, preset: state.preset });
    state.updatedAt = Date.now();
    state.error = null;
  } catch (err) {
    // A refresh that fails leaves the last good table alone; a first run that
    // fails has nothing else to show.
    if (!background) {
      state.error = err;
      state.result = null;
    }
  } finally {
    state.loading = false;
    state.refreshing = false;
    render();
  }
}

async function openDetail(state, render, symbol) {
  state.detailSymbol = symbol;
  state.overrides = { r: 0.09, g1: 0.05, g2: 0.05, years: 5 };
  render();
  await refreshDetail(state, render);
}

/** Re-query the valuation for the current sliders. Debounced by the caller. */
async function refreshDetail(state, render) {
  if (!state.detailSymbol) return;
  try {
    const overrides = {
      r: state.overrides.r,
      g1: state.overrides.g1,
      g2: state.overrides.g2,
    };
    state.detail = await api.screenerStock(state.detailSymbol, overrides);
    state.error = null;
  } catch (err) {
    state.error = err;
  } finally {
    render();
  }
}

function paint(body, state, board, setAuto) {
  // A background refresh rebuilds the table every minute; without this the
  // reader is thrown back to the top of a hundred rows each time.
  const scrolled = body.querySelector('.scr-table-wrap')?.scrollTop ?? 0;
  const rerender = () => paint(body, state, board, setAuto);
  body.innerHTML = '';
  body.classList.add('screener-body');

  if (state.detailSymbol) {
    paintDetail(body, state, board, rerender);
    return;
  }
  paintToolbar(body, state, rerender, setAuto);
  paintResults(body, state, rerender);

  const wrap = body.querySelector('.scr-table-wrap');
  if (wrap && scrolled) wrap.scrollTop = scrolled;
}

// ── Search view ─────────────────────────────────────────────────────────────

function paintToolbar(body, state, rerender, setAuto) {
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

  // The screen re-prices itself while it is open, the way the board does. The
  // checkbox is the off switch for a reader who wants the table to hold still
  // while they compare a row against their notes.
  const auto = document.createElement('label');
  auto.className = 'scr-auto';
  auto.title = t('scr.auto.hint');
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.checked = state.auto;
  box.addEventListener('change', () => setAuto(box.checked, { immediate: true }));
  auto.append(box, document.createTextNode(t('scr.auto')));
  controls.appendChild(auto);

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
  if (state.updatedAt) {
    // How fresh the table is, so an auto-refresh is visible rather than
    // something the reader has to take on faith.
    const stamp = document.createElement('span');
    stamp.className = 'scr-updated';
    stamp.textContent = ` · ${t('scr.updated', { time: timeString(new Date(state.updatedAt)) })}`;
    summary.appendChild(stamp);
  }
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

/**
 * Turn the server's machine reason into a sentence.
 *
 * The server says `requires:dividendStreak`; a reader needs "Dividend every
 * year for 5 years". Every check already carries a label, so this is a lookup
 * rather than a second dictionary.
 */
function rejectReason(row) {
  const reason = row.failReason;
  if (!reason) return '';
  const prefix = 'requires:';
  if (reason.startsWith(prefix)) {
    const id = reason.slice(prefix.length);
    return t(`scr.check.${id}`, null, id);
  }
  return t(`scr.reject.${reason}`, null, reason);
}

/**
 * The measures the peer comparison ranks, in the order the table shows them.
 *
 * The server ranks the same set; this is the label, the direction and the
 * figure that go with each of them.
 */
const PEER_METRICS = [
  { key: 'roe', label: 'scr.col.roe', better: 'high', value: (row) => percent(row.roe3) },
  { key: 'pe', label: 'scr.col.pe', better: 'low', value: (row) => (row.pe == null ? '—' : row.pe.toFixed(1)) },
  { key: 'yield', label: 'scr.col.yield', better: 'high', value: (row) => percent(row.dividendYield) },
  { key: 'de', label: 'scr.col.de', better: 'low', value: (row) => (row.de == null ? '—' : row.de.toFixed(2)) },
];

/**
 * The exchange's sector names, in Thai.
 *
 * The classification comes from the data source in English, and a Thai screen
 * that says "CONSUMER NON-DURABLES" is a screen that has to be translated in
 * the reader's head. A name the list does not carry is left as it came.
 */
const SECTOR_TH = {
  'Finance': 'การเงิน',
  'Retail Trade': 'ค้าปลีก',
  'Process Industries': 'อุตสาหกรรมการแปรรูป',
  'Transportation': 'การขนส่ง',
  'Utilities': 'สาธารณูปโภค',
  'Energy Minerals': 'พลังงานและแร่',
  'Consumer Non-Durables': 'สินค้าอุปโภคไม่คงทน',
  'Health Services': 'บริการสาธารณสุข',
  'Distribution Services': 'บริการกระจายสินค้า',
  'Consumer Services': 'บริการอุปโภค',
  'Electronic Technology': 'เทคโนโลยีอิเล็กทรอนิกส์',
  'Industrial Services': 'บริการอุตสาหกรรม',
  'Communications': 'การสื่อสาร',
  'Commercial Services': 'บริการพาณิชย์',
  'Non-Energy Minerals': 'แร่ที่ไม่ใช่พลังงาน',
  'Consumer Durables': 'สินค้าอุปโภคคงทน',
  'Producer Manufacturing': 'อุตสาหกรรมการผลิต',
  'Health Technology': 'เทคโนโลยีการแพทย์',
  'Technology Services': 'บริการเทคโนโลยี',
  'Miscellaneous Industrial Products': 'สินค้าอุตสาหกรรมอื่น',
  'Containers & Packaging': 'บรรจุภัณฑ์และการบรรจุ',
  'Transportation Services': 'บริการขนส่ง',
  'Hotel & Restaurant': 'โรงแรมและร้านอาหาร',
  'Broadcasting & Entertainment': 'การกระจายเสียงและบันเทิง',
  'Real Estate': 'อสังหาริมทรัพย์',
  'Publishing': 'สิ่งพิมพ์',
  'Marine Transportation': 'การขนส่งทางทะเล',
  'Apparel Retail': 'ค้าปลีกเครื่องแต่งกาย',
  'Food Retail': 'ค้าปลีกอาหาร',
  'Building Products': 'ผลิตภัณฑ์ก่อสร้าง',
  'Metal Fabrications': 'ผลิตภัณฑ์โลหะ',
  'Specialty Retail': 'ค้าปลีกเฉพาะทาง',
  'Apparel Manufacturing': 'อุตสาหกรรมเครื่องแต่งกาย',
  'Trucking': 'ขนส่งสินค้า',
  'Major Chemicals': 'เคมีภัณฑ์',
};

const sectorLabel = (name) => {
  if (!name) return null;
  return isThai() ? (SECTOR_TH[name] ?? name) : name;
};

/** Where a name sits against the names it was screened with. */
function peerPercent(row, group, key) {
  const v = row?.peers?.[group]?.values?.[key];
  return typeof v === 'number' ? v : null;
}

/**
 * The small percentile beside a table figure.
 *
 * The number is the share of the screened names the row is better than, so 92
 * means better than 92 of every 100. It is dim because it is context for the
 * figure beside it, not a second score.
 */
function peerBadge(row, key) {
  const v = peerPercent(row, 'universe', key);
  if (v == null) return '';
  const metric = PEER_METRICS.find((m) => m.key === key);
  const title = t(metric.better === 'low' ? 'scr.peer.lower' : 'scr.peer.higher', {
    n: v,
    size: row.peers?.universe?.size ?? 0,
    label: t(metric.label),
  });
  return `<i class="scr-pct" title="${escape(title)}">${v}</i>`;
}

function buildTable(rows, state, rerender) {
  const wrap = document.createElement('div');
  wrap.className = 'scr-table-wrap';

  const table = document.createElement('table');
  table.className = 'scr-table';
  table.innerHTML = `
    <thead><tr>
      <th>${escape(t('scr.col.symbol'))}</th>
      <th class="num">${escape(t('scr.col.price'))}</th>
      <th class="num">${escape(t('scr.col.score'))}</th>
      <th class="num" title="${escape(t('scr.peer.colHint'))}">${escape(t('scr.col.roe'))}</th>
      <th class="num" title="${escape(t('scr.peer.colHint'))}">${escape(t('scr.col.de'))}</th>
      <th class="num" title="${escape(`${t('scr.col.yieldHint')} ${t('scr.peer.colHint')}`)}">${escape(t('scr.col.yield'))}</th>
      <th class="num" title="${escape(t('scr.peer.colHint'))}">${escape(t('scr.col.pe'))}</th>
      <th class="num">${escape(t('scr.col.intrinsic'))}</th>
      <th class="num">${escape(t('scr.col.mos'))}</th>
    </tr></thead>`;

  const tbody = document.createElement('tbody');
  // The server puts the names that passed first, each group ranked on its own;
  // a labelled boundary is what stops a rejected 83 above a passing 71 from
  // reading as a sorting bug.
  const passing = rows.filter((row) => row.pass).length;
  let divided = false;
  for (const row of rows) {
    if (!row.pass && !divided) {
      divided = true;
      if (passing > 0) {
        const divider = document.createElement('tr');
        divider.className = 'scr-divider';
        const cell = document.createElement('td');
        cell.colSpan = 9;
        cell.textContent = t('scr.belowPreset', { n: rows.length - passing });
        divider.appendChild(cell);
        tbody.appendChild(divider);
      }
    }
    const tr = document.createElement('tr');
    // A row the preset rejected stays visible but dimmed, with the rule that
    // stopped it as a tooltip — "why is this not in the list" is half of what
    // a screen is for.
    tr.className = row.pass ? '' : 'is-out';
    if (!row.pass && row.failReason) tr.title = t('scr.rejected', { reason: rejectReason(row) });
    // When a year carries a special, the column shows the recurring rate and
    // the tooltip shows the year's full payout — the figure the exchange
    // publishes. Both numbers in one place is the only way to answer "why is
    // this different from set.or.th" without hiding the conservative one.
    const specialTitle = row.hasSpecialDividend && row.annualDps != null && row.price > 0
      ? t('scr.specialHint', {
        all: percent(row.annualDps / row.price, 2),
        recurring: percent(row.dividendYield, 2),
      })
      : '';
    // A score is a fraction of the rules that could be judged, so a name with
    // a short history is scored on a smaller base than the rest. The number
    // says so rather than letting the reader compare two different rulers.
    const coverageTitle = row.coverage != null && row.coverage < 1
      ? t('scr.coverageHint', { n: Math.round(row.coverage * 100) })
      : '';
    tr.innerHTML = `
      <td><b>${escape(row.bare)}</b><span class="scr-name">${escape(row.name ?? '')}</span></td>
      <td class="num">${row.price == null ? '—' : row.price.toFixed(2)}</td>
      <td class="num"${coverageTitle ? ` title="${escape(coverageTitle)}"` : ''}><span class="scr-score is-${scoreTone(row.score)}">${row.score}</span></td>
      <td class="num">${percent(row.roe3)}${peerBadge(row, 'roe')}</td>
      <td class="num">${row.de == null ? '—' : row.de.toFixed(2)}${peerBadge(row, 'de')}</td>
      <td class="num"${specialTitle ? ` title="${escape(specialTitle)}"` : ''}>${percent(row.dividendYield)}${row.hasSpecialDividend ? `<i class="scr-flag" title="${escape(t('scr.special'))}">*</i>` : ''}${peerBadge(row, 'yield')}</td>
      <td class="num">${row.pe == null ? '—' : row.pe.toFixed(1)}${peerBadge(row, 'pe')}</td>
      <td class="num">${row.ddm.intrinsic == null ? '—' : row.ddm.intrinsic.toFixed(2)}</td>
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
  body.appendChild(peerBlock(detail));
  body.appendChild(chartBlock(detail));
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
    // Both growth rates run to 20%: a cyclical coming off a trough really can
    // grow that fast for a while, and refusing to express it just moves the
    // guesswork out of the model and into the reader's head.
    { key: 'g1', label: t('scr.g1'), min: 0, max: 20, step: 0.5,
      value: (state.overrides.g1 ?? ddm.g1) * 100, hint: t('scr.g1.hint') },
    { key: 'g2', label: t('scr.g2'), min: 0, max: 20, step: 0.25, value: state.overrides.g2 * 100,
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

  const actions = document.createElement('div');
  actions.className = 'scr-calc__actions';

  // A named pair, not a magic number: 5%/5% is the shape a reader reaches for
  // when they want to see the value with a flat, undemanding growth assumption.
  const flat = document.createElement('button');
  flat.type = 'button';
  flat.className = 'btn btn--sm';
  flat.textContent = t('scr.g1g2Five');
  flat.title = t('scr.g1g2Five.hint');
  flat.addEventListener('click', () => {
    state.overrides.g1 = 0.05;
    state.overrides.g2 = 0.05;
    refreshDetail(state, rerender);
  });
  actions.appendChild(flat);

  const reset = document.createElement('button');
  reset.type = 'button';
  reset.className = 'btn btn--sm';
  reset.textContent = t('scr.reset');
  reset.addEventListener('click', () => {
    state.overrides = { r: 0.09, g1: 0.05, g2: 0.05, years: 5 };
    refreshDetail(state, rerender);
  });
  actions.appendChild(reset);
  box.appendChild(actions);

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
      <div><span>${escape(t('scr.d0', { year: detail.dividendFy ?? '—' }))}</span><b>${money(ddm.d0)}</b></div>
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
/**
 * ROE and dividend-yield trend over the fiscal years we have statements for.
 *
 * The bands above already show P/E and P/BV; what is missing there is whether
 * profitability and the payout are holding up, which is the question a snapshot
 * cannot answer. Two series, two scales: ROE in percent on the left, the cash
 * yield on the price at each year end on the right.
 */
/**
 * The annual statement charts.
 *
 * The statements table below carries the same fiscal-year rows as numbers; this
 * grid is the shape a reader scans first — is profit growing, is the margin
 * holding, is the dividend still being paid. The income-statement lines come
 * from Yahoo and reach back four fiscal years, while the payment chart splits
 * the exchange ex-date record by the quarter the cash landed in, which reaches
 * further. Each chart says so rather than stretching a short history.
 */
/**
 * The annual statement charts.
 *
 * One bar per fiscal year. The shape is the point — is profit growing, is the
 * margin holding — and a pile of four quarters in every bar hides that shape
 * rather than showing it. The payment chart keeps its quarters, because there
 * the quarters are cash and cash adds up.
 */
function chartBlock(detail) {
  const box = document.createElement('div');
  box.appendChild(section(t('scr.chart'), t('scr.chartHint')));

  // The statement charts read the long annual history when the second source
  // has it and fall back to the four Yahoo years otherwise, so a name the long
  // source does not carry still draws.
  const years = detail.years ?? [];
  const long = detail.history?.years?.length ? detail.history.years : years;
  const labels = long.map((y) => y.fiscalYear);
  const dps = detail.dpsQuarterly ?? [];
  const unit = t('scr.chart.unit');
  const money = (v) => `${(v / 1e6).toFixed(0)}${unit}`;
  const percent = (v) => `${(v * 100).toFixed(1)}%`;
  const plainNumber = (v) => v.toFixed(2);

  const cells = [
    { label: t('scr.chart.netProfit'), values: long.map((y) => y.netIncome), color: '#a06cff', format: money },
    { label: t('scr.chart.revenue'), values: long.map((y) => y.revenue), color: '#2f7ff0', format: money },
    { label: t('scr.chart.eps'), values: long.map((y) => y.eps), color: '#1fb6d4', format: plainNumber },
    { label: t('scr.chart.npm'), values: long.map((y) => y.npm), color: '#e8418a', format: percent },
    { label: t('scr.chart.dps'), rows: dps, format: plainNumber },
    { label: t('scr.chart.de'), values: long.map((y) => y.de), color: '#f0a020', format: plainNumber },
  ];

  const grid = document.createElement('div');
  grid.className = 'scr-charts';
  for (const c of cells) {
    const cell = document.createElement('div');
    cell.className = 'scr-chart';
    cell.innerHTML = `<h4>${escape(c.label)}</h4><canvas height="150"></canvas>`;
    if (c.rows?.length) {
      const legend = document.createElement('div');
      legend.className = 'scr-chart__legend';
      legend.innerHTML = [
        ['--q1', 'Q1'], ['--q2', 'Q2'], ['--q3', 'Q3'], ['--q4', 'Q4'],
      ].map(([k, n]) => `<span><i style="background:var(${k})"></i>${escape(n)}</span>`).join('');
      cell.appendChild(legend);
    }
    grid.appendChild(cell);
    requestAnimationFrame(() => {
      const canvas = cell.querySelector('canvas');
      if (c.rows?.length) drawQuarterBars(canvas, c.rows, { stacked: true, format: c.format });
      else drawBars(canvas, { labels, values: c.values, color: c.color, format: c.format });
    });
  }
  box.appendChild(grid);
  return box;
}

/** One simple bar chart: gridlines, axis labels, a bar per year. */
function drawBars(canvas, { labels, values, color, format, showValues = false }) {
  if (!canvas) return;
  const dpr = window.devicePixelRatio || 1;
  const width = canvas.clientWidth || 300;
  const height = canvas.clientHeight || 150;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, width, height);

  const nums = values.filter((v) => Number.isFinite(v));
  if (!nums.length || !labels.length) return;

  const max = Math.max(...nums, 0) || 1;
  const span = max * 1.15;

  const style = getComputedStyle(document.documentElement);
  const line = style.getPropertyValue('--text-dim').trim() || '#888';
  ctx.font = '9px system-ui, sans-serif';
  ctx.textBaseline = 'middle';
  // The axis labels set the gutter: a clipped label is a wrong label.
  let gutter = 0;
  for (let i = 0; i <= 4; i += 1) {
    gutter = Math.max(gutter, ctx.measureText(format((span * i) / 4, true)).width);
  }
  const pad = {
    top: 14,
    right: 6,
    bottom: 20,
    left: Math.min(Math.max(30, Math.ceil(gutter) + 10), Math.round(width * 0.32)),
  };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const n = labels.length;
  const slot = plotW / n;
  const bw = Math.min(30, slot * 0.6);
  const y = (v) => pad.top + plotH - (v / span) * plotH;

  for (let i = 0; i <= 4; i += 1) {
    const v = (span * i) / 4;
    const yy = y(v);
    ctx.strokeStyle = line;
    ctx.globalAlpha = 0.15;
    ctx.setLineDash([2, 3]);
    ctx.beginPath();
    ctx.moveTo(pad.left, yy);
    ctx.lineTo(pad.left + plotW, yy);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.setLineDash([]);
    ctx.textAlign = 'right';
    ctx.fillText(format(v, true), pad.left - 4, yy);
  }

  values.forEach((v, i) => {
    if (!Number.isFinite(v)) return;
    const cx = pad.left + slot * (i + 0.5);
    const top = y(v);
    ctx.fillStyle = color;
    ctx.fillRect(cx - bw / 2, top, bw, pad.top + plotH - top);
    if (showValues) {
      ctx.fillStyle = line;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText(format(v, false), cx, top - 1);
    }
  });

  ctx.fillStyle = line;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  labels.forEach((l, i) => {
    ctx.fillText(String(l), pad.left + slot * (i + 0.5), pad.top + plotH + 4);
  });
}

/**
 * One bar per fiscal year, split by quarter.
 *
 * Stacked when the quarters are amounts that add up; side by side when they
 * are ratios, because a stack of margins means nothing. The ratio charts also
 * mark the year's own figure with a dot, so the quarters have something to
 * sit against.
 */
function drawQuarterBars(canvas, rows, { stacked, format }) {
  if (!canvas) return;
  const dpr = window.devicePixelRatio || 1;
  const width = canvas.clientWidth || 300;
  const height = canvas.clientHeight || 150;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, width, height);
  if (!rows?.length) return;

  const style = getComputedStyle(document.documentElement);
  const line = style.getPropertyValue('--text-dim').trim() || '#888';
  const colours = {
    q1: style.getPropertyValue('--q1').trim() || '#f5a623',
    q2: style.getPropertyValue('--q2').trim() || '#4a90d9',
    q3: style.getPropertyValue('--q3').trim() || '#4caf50',
    q4: style.getPropertyValue('--q4').trim() || '#9b59b6',
  };
  const keys = ['q1', 'q2', 'q3', 'q4'];

  // The scale is the stack's total when stacked, and the single quarter when
  // the quarters stand side by side.
  const heights = rows
    .flatMap((r) => (stacked ? [r.total] : keys.map((k) => r[k])))
    .filter((v) => Number.isFinite(v));
  if (!heights.length) return;
  const max = Math.max(...heights, 0) || 1;
  const span = max * 1.18;

  ctx.font = '9px system-ui, sans-serif';
  ctx.textBaseline = 'middle';
  // The axis labels decide how much room the plot gets: "2,242 ล้าน" is wider
  // than "0.18", and a clipped label is a wrong label.
  let gutter = 0;
  for (let i = 0; i <= 4; i += 1) {
    gutter = Math.max(gutter, ctx.measureText(format((span * i) / 4, true)).width);
  }
  const pad = {
    top: 14,
    right: 6,
    bottom: 20,
    left: Math.min(Math.max(30, Math.ceil(gutter) + 10), Math.round(width * 0.32)),
  };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const n = rows.length;
  const slot = plotW / n;
  const bw = stacked ? Math.min(26, slot * 0.62) : Math.min(10, (slot * 0.74) / 4);
  const y = (v) => pad.top + plotH - (v / span) * plotH;

  for (let i = 0; i <= 4; i += 1) {
    const v = (span * i) / 4;
    const yy = y(v);
    ctx.strokeStyle = line;
    ctx.globalAlpha = 0.15;
    ctx.setLineDash([2, 3]);
    ctx.beginPath();
    ctx.moveTo(pad.left, yy);
    ctx.lineTo(pad.left + plotW, yy);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.setLineDash([]);
    ctx.textAlign = 'right';
    ctx.fillText(format(v, true), pad.left - 4, yy);
  }

  rows.forEach((row, i) => {
    const cx = pad.left + slot * (i + 0.5);
    if (stacked) {
      let acc = 0;
      for (const k of keys) {
        const v = row[k];
        if (!Number.isFinite(v) || v <= 0) continue;
        const top = y(acc + v);
        ctx.fillStyle = colours[k];
        ctx.fillRect(cx - bw / 2, top, bw, (v / span) * plotH);
        acc += v;
      }
      if (Number.isFinite(row.total) && row.total > 0) {
        ctx.fillStyle = line;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillText(format(row.total, false), cx, y(acc) - 1);
      }
    } else {
      keys.forEach((k, j) => {
        const v = row[k];
        if (!Number.isFinite(v)) return;
        const x = cx - (bw * 4) / 2 + j * bw;
        const top = y(v);
        ctx.fillStyle = colours[k];
        ctx.fillRect(x, top, Math.max(1, bw - 1), pad.top + plotH - top);
      });
      if (Number.isFinite(row.annual)) {
        ctx.fillStyle = line;
        ctx.beginPath();
        ctx.arc(cx, y(row.annual), 2.6, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  });

  ctx.fillStyle = line;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  rows.forEach((r, i) => {
    ctx.fillText(String(r.year), pad.left + slot * (i + 0.5), pad.top + plotH + 4);
  });
}

/**
 * Where the name sits against its peers.
 *
 * The scorecard says whether the company clears the framework; this says how
 * it compares with the names it was screened with and with the names in its
 * own industry, which is the question a threshold cannot answer: ROE of 20% is
 * a different statement beside a bank than beside a property developer.
 */
function peerBlock(detail) {
  const box = document.createElement('div');
  box.appendChild(section(t('scr.peer'), t('scr.peerHint')));

  const peers = detail.peers;
  if (!peers) {
    const p = document.createElement('p');
    p.className = 'section__hint';
    p.textContent = t('scr.peer.none');
    box.appendChild(p);
    return box;
  }

  const sector = peers.sector ?? {};
  const wrap = document.createElement('div');
  wrap.className = 'scr-table-wrap';
  const table = document.createElement('table');
  table.className = 'scr-table scr-table--peers';
  table.innerHTML = `<thead><tr>
      <th>${escape(t('scr.peer.metric'))}</th>
      <th class="num">${escape(t('scr.peer.value'))}</th>
      <th class="num">${escape(t('scr.peer.universe', { n: peers.universe?.size ?? 0 }))}</th>
      <th class="num">${escape(sector.name
        ? t('scr.peer.sector', { name: sectorLabel(sector.name), n: sector.size ?? 0 })
        : t('scr.peer.noSector'))}</th>
    </tr></thead>`;
  const tbody = document.createElement('tbody');
  for (const metric of PEER_METRICS) {
    const u = peerPercent(detail, 'universe', metric.key);
    const s = peerPercent(detail, 'sector', metric.key);
    const say = (v) => (v == null ? '—' : t(metric.better === 'low' ? 'scr.peer.lowerShort' : 'scr.peer.higherShort', { n: v }));
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escape(t(metric.label))}</td>
      <td class="num">${escape(metric.value(detail))}</td>
      <td class="num">${escape(say(u))}</td>
      <td class="num">${escape(say(s))}</td>`;
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  wrap.appendChild(table);
  box.appendChild(wrap);
  return box;
}

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

    // The band's history is annual, but the right-hand edge is today's figure:
    // trailing earnings for the multiple, the latest quarter for book value.
    // Saying so in the header is cheaper than a footnote nobody reads.
    const nowLabel = t(key === 'pe' ? 'scr.band.nowPe' : 'scr.band.nowPbv');
    const now = band.current == null
      ? `${escape(nowLabel)} —`
      : `${escape(nowLabel)} ${band.current.toFixed(2)}` +
        (band.z == null ? '' : ` · ${escape(t('scr.band.z'))} ${band.z.toFixed(2)}σ`);

    // A band level at or below zero is not a multiple anyone can pay; printing
    // it invites reading "the stock is cheap below −19×".
    const lvl = (v) => (v > 0 ? v.toFixed(2) : '—');
    cell.innerHTML = `
      <h4>${escape(label)}
        <span>${now}</span></h4>
      <canvas height="150"></canvas>
      <table class="scr-band__levels">
        <tr><td>${escape(t('scr.band.plus2'))}</td><td>${lvl(levels.plus2)}</td></tr>
        <tr><td>${escape(t('scr.band.plus1'))}</td><td>${lvl(levels.plus1)}</td></tr>
        <tr><td>${escape(t('scr.band.mean'))}</td><td>${lvl(levels.mean)}</td></tr>
        <tr><td>${escape(t('scr.band.minus1'))}</td><td>${lvl(levels.minus1)}</td></tr>
        <tr><td>${escape(t('scr.band.minus2'))}</td><td>${lvl(levels.minus2)}</td></tr>
      </table>
      ${band.skipped ? `<p class="section__hint">${escape(t('scr.band.capped', { n: band.skipped, max: band.cap }))}</p>` : ''}`;
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

  const values = points.map((p) => p.value)
    .concat([levels.plus2, levels.minus2])
    .filter((v) => Number.isFinite(v) && v > 0);
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
    // A guide below zero has no place on a ratio chart; drawing it would only
    // stretch the axis to make room for a multiple that cannot exist.
    if (!(value > 0)) continue;
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
  if (current != null) {
    ctx.beginPath();
    ctx.arc(x(points.length - 1), y(current), 3, 0, Math.PI * 2);
    ctx.fill();
  }
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
    const dps = year.dps ?? year.dpsPaid ?? year.dpsStatement;
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