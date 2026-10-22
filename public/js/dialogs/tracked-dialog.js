/**
 * The names being followed.
 *
 * A screen gives a shortlist and then the reader is on their own: the shortlist
 * is a list of tickers, and a ticker does not remember why it was looked at or
 * what it cost to look. This page is the other half of the screen — each name
 * with the reason it was worth looking at, the numbers it had that day, and
 * where those numbers are now.
 *
 * The trend is read from the daily history file, so it fills in as the days go
 * by rather than being invented here: with one day recorded there is nothing to
 * draw, and the page says so instead of drawing a straight line and calling it
 * a trend.
 */
import { modal, escape, section, toast } from '../ui.js';
import { t, tp } from '../i18n.js';
import { api } from '../api.js';
import { openScreener } from './screener-dialog.js';

const percent = (v, digits = 1) =>
  (v == null || !Number.isFinite(v) ? '—' : `${(v * 100).toFixed(digits)}%`);
const number = (v, digits = 2) =>
  (v == null || !Number.isFinite(v) ? '—' : v.toFixed(digits));

const STATUSES = ['watching', 'bought', 'sold'];

export function openTracked({ board } = {}) {
  const state = { rows: [], loading: true, error: null, saving: {} };
  let render = () => {};

  const handle = modal({
    title: t('trk.title'),
    subtitle: t('trk.hint'),
    size: 'xl',
    render: (body) => {
      render = () => paint(body, state, board, render);
      render();
    },
    footer: (foot) => {
      foot.innerHTML = `<span class="spacer"></span>
        <button class="btn" data-close>${escape(t('common.close'))}</button>`;
    },
  });

  load(state, render);
  return handle;
}

async function load(state, render) {
  state.loading = true;
  render();
  try {
    const res = await api.tracked();
    const entries = res.tracked ?? [];
    // Each name's numbers now, and the series recorded for it.
    const rows = await Promise.all(entries.map(async (entry) => {
      const [detail, history] = await Promise.all([
        api.screenerStock(entry.symbol).catch(() => null),
        api.fundamentalsHistory(entry.symbol).catch(() => ({ points: [] })),
      ]);
      return { entry, detail, points: history?.points ?? [] };
    }));
    state.rows = rows;
    state.error = null;
  } catch (err) {
    state.error = err;
  } finally {
    state.loading = false;
    render();
  }
}

function paint(body, state, board, render) {
  body.classList.add('trk-body');

  if (state.error) {
    const box = document.createElement('p');
    box.className = 'section__hint is-error';
    box.textContent = t('trk.err', { msg: state.error.message });
    body.appendChild(box);
    return;
  }

  body.appendChild(addRow(state, render));

  if (state.loading) {
    const p = document.createElement('p');
    p.className = 'section__hint';
    p.textContent = t('common.loading');
    body.appendChild(p);
    return;
  }

  if (!state.rows.length) {
    const p = document.createElement('p');
    p.className = 'section__hint';
    p.textContent = t('trk.empty');
    body.appendChild(p);
    return;
  }

  for (const row of state.rows) body.appendChild(entryCard(row, state, board, render));
}

function addRow(state, render) {
  const row = document.createElement('div');
  row.className = 'trk-add';

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'input';
  input.placeholder = t('trk.addPlaceholder');
  input.spellcheck = false;

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn btn--primary';
  button.textContent = t('trk.add');

  const add = async () => {
    const raw = input.value.trim();
    if (!raw) return;
    button.disabled = true;
    try {
      // The numbers the name is added at are kept, so the page can show what
      // has changed since rather than only what is true now.
      const detail = await api.screenerStock(raw).catch(() => null);
      await api.addTracked({
        symbol: raw,
        name: detail?.name ?? '',
        at: {
          price: detail?.price ?? null,
          pe: detail?.pe ?? null,
          yield: detail?.dividendYield ?? null,
          score: detail?.score ?? null,
          intrinsic: detail?.ddm?.intrinsic ?? null,
        },
      });
      input.value = '';
      toast(t('trk.added', { symbol: raw.toUpperCase() }), { type: 'success' });
      await load(state, render);
    } catch (err) {
      toast(t('trk.addFailed', { msg: err.message }), { type: 'error' });
      button.disabled = false;
    }
  };
  button.addEventListener('click', add);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } });

  const hint = document.createElement('span');
  hint.className = 'section__hint';
  hint.textContent = t('trk.addHint');

  row.append(input, button, hint);
  return row;
}

function entryCard({ entry, detail, points }, state, board, render) {
  const card = document.createElement('div');
  card.className = 'trk-card';

  const head = document.createElement('div');
  head.className = 'trk-card__head';
  const name = document.createElement('div');
  name.innerHTML = `<b>${escape(entry.symbol.split(':')[1] ?? entry.symbol)}</b>
    <span>${escape(entry.name ?? detail?.name ?? '')}</span>`;
  head.appendChild(name);

  const status = document.createElement('div');
  status.className = 'trk-card__status';
  for (const s of STATUSES) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = `chip chip--toggle${entry.status === s ? ' is-on' : ''}`;
    chip.textContent = t(`trk.status.${s}`);
    chip.addEventListener('click', async () => {
      try {
        await api.updateTracked(entry.id, { status: s });
        entry.status = s;
        render();
      } catch (err) {
        toast(t('trk.saveFailed', { msg: err.message }), { type: 'error' });
      }
    });
    status.appendChild(chip);
  }
  head.appendChild(status);
  card.appendChild(head);

  // The numbers now, against the numbers the day the name went in.
  const figures = document.createElement('div');
  figures.className = 'trk-card__figures';
  const now = {
    score: detail?.score ?? null,
    pe: detail?.pe ?? null,
    yield: detail?.dividendYield ?? null,
    intrinsic: detail?.ddm?.intrinsic ?? null,
    mos: detail?.ddm?.mos ?? null,
  };
  const was = entry.at ?? {};
  const figure = (label, value, before, fmt) => {
    const cell = document.createElement('div');
    cell.className = 'trk-fig';
    const changed = value != null && before != null && Number.isFinite(value) && Number.isFinite(before)
      && before !== 0
      ? (value - before) / Math.abs(before)
      : null;
    cell.innerHTML = `<span class="trk-fig__label">${escape(label)}</span>
      <span class="trk-fig__value">${escape(fmt(value))}</span>
      <span class="trk-fig__was">${before == null ? '' : `${escape(t('trk.was'))} ${escape(fmt(before))}`}${
  changed == null ? '' : ` <i class="${changed > 0 ? 'is-up' : 'is-down'}">${changed > 0 ? '+' : ''}${(changed * 100).toFixed(0)}%</i>`}</span>`;
    return cell;
  };
  figures.append(
    figure(t('trk.score'), now.score, was.score, (v) => (v == null ? '—' : String(v))),
    figure(t('trk.pe'), now.pe, was.pe, (v) => (v == null ? '—' : `${number(v, 1)}x`)),
    figure(t('trk.yield'), now.yield, was.yield, (v) => percent(v)),
    figure(t('trk.intrinsic'), now.intrinsic, was.intrinsic, (v) => number(v, 2)),
    // The margin of safety is published as a percentage already.
    figure(t('trk.mos'), now.mos, null, (v) => (v == null ? '—' : `${v.toFixed(0)}%`)),
  );
  card.appendChild(figures);

  // The reason. This is the part a ticker cannot remember.
  const note = document.createElement('textarea');
  note.className = 'input trk-card__note';
  note.rows = 2;
  note.placeholder = t('trk.notePlaceholder');
  note.value = entry.note ?? '';
  const saveNote = document.createElement('button');
  saveNote.type = 'button';
  saveNote.className = 'btn btn--sm';
  saveNote.textContent = t('trk.save');
  saveNote.addEventListener('click', async () => {
    saveNote.disabled = true;
    try {
      await api.updateTracked(entry.id, { note: note.value });
      entry.note = note.value;
      toast(t('trk.saved'), { type: 'success', timeout: 2000 });
    } catch (err) {
      toast(t('trk.saveFailed', { msg: err.message }), { type: 'error' });
    } finally {
      saveNote.disabled = false;
    }
  });
  const noteRow = document.createElement('div');
  noteRow.className = 'trk-card__notes';
  noteRow.append(note, saveNote);
  card.appendChild(noteRow);

  // The recorded series: the multiple and the yield since the name went in.
  const chart = document.createElement('div');
  chart.className = 'trk-card__chart';
  const usable = points.filter((p) => Number.isFinite(p.pe) || Number.isFinite(p.dividendYield));
  if (usable.length >= 2) {
    const canvas = document.createElement('canvas');
    canvas.height = 90;
    chart.appendChild(canvas);
    requestAnimationFrame(() => drawSeries(canvas, usable));
  } else {
    const p = document.createElement('p');
    p.className = 'section__hint';
    p.textContent = t('trk.noTrend');
    chart.appendChild(p);
  }
  card.appendChild(chart);

  const foot = document.createElement('div');
  foot.className = 'trk-card__foot';
  const added = document.createElement('span');
  added.className = 'section__hint';
  added.textContent = t('trk.addedOn', { date: new Date(entry.addedAt).toLocaleDateString() });
  foot.appendChild(added);

  const actions = document.createElement('div');
  actions.className = 'trk-card__actions';
  if (board) {
    const onBoard = document.createElement('button');
    onBoard.type = 'button';
    onBoard.className = 'btn btn--sm';
    onBoard.textContent = t('trk.openAnalysis');
    onBoard.addEventListener('click', () => {
      // The same page the screener opens for a row.
      openScreener({ board, symbol: entry.symbol });
    });
    actions.appendChild(onBoard);
  }
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'btn btn--sm';
  remove.textContent = t('trk.remove');
  remove.addEventListener('click', async () => {
    try {
      await api.removeTracked(entry.id);
      toast(t('trk.removed'), { type: 'info' });
      await load(state, render);
    } catch (err) {
      toast(t('trk.saveFailed', { msg: err.message }), { type: 'error' });
    }
  });
  actions.appendChild(remove);
  foot.appendChild(actions);
  card.appendChild(foot);

  return card;
}

/**
 * The multiple and the yield since the name went in.
 *
 * Two series on one chart, each with its own scale: the multiple is a ratio
 * that can be anywhere and the yield is a percentage, and putting them on one
 * scale would make the yield a flat line.
 */
function drawSeries(canvas, points) {
  const dpr = window.devicePixelRatio || 1;
  const width = canvas.clientWidth || 320;
  const height = canvas.clientHeight || 90;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, width, height);

  const style = getComputedStyle(document.documentElement);
  const dim = style.getPropertyValue('--text-dim').trim() || '#888';
  const accent = style.getPropertyValue('--accent').trim() || '#2f6df6';
  const up = style.getPropertyValue('--up').trim() || '#26a69a';

  const pad = { top: 8, right: 46, bottom: 16, left: 6 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const pes = points.map((p) => p.pe).filter((v) => Number.isFinite(v));
  const yields = points.map((p) => p.dividendYield).filter((v) => Number.isFinite(v));
  if (!pes.length && !yields.length) return;
  const peMax = Math.max(...pes, 0) * 1.15 || 1;
  const yMax = Math.max(...yields, 0.01) * 1.15 || 0.01;
  const n = points.length;
  const x = (i) => pad.left + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW);

  ctx.font = '9px system-ui, sans-serif';
  ctx.textBaseline = 'middle';

  const line = (values, max, colour, format, labelOffset = 0) => {
    ctx.strokeStyle = colour;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    let started = false;
    values.forEach((v, i) => {
      if (!Number.isFinite(v)) { started = false; return; }
      const y = pad.top + plotH - (v / max) * plotH;
      if (!started) { ctx.moveTo(x(i), y); started = true; }
      else ctx.lineTo(x(i), y);
    });
    ctx.stroke();
    const last = values.map((v, i) => ({ v, i })).reverse().find((x2) => Number.isFinite(x2.v));
    if (last) {
      ctx.fillStyle = colour;
      ctx.textAlign = 'left';
      ctx.fillText(format(last.v), pad.left + plotW + 4,
        pad.top + plotH - (last.v / max) * plotH + labelOffset);
    }
  };
  line(points.map((p) => p.pe), peMax, accent, (v) => `${v.toFixed(1)}x`);
  // The yield's label sits a little lower, so the two do not print on top of
  // each other when the lines end at the same height.
  line(points.map((p) => p.dividendYield), yMax, up, (v) => `${(v * 100).toFixed(1)}%`, 9);

  ctx.fillStyle = dim;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText(points[0].date, pad.left, pad.top + plotH + 3);
  ctx.fillText(points[n - 1].date, pad.left + plotW, pad.top + plotH + 3);
}
