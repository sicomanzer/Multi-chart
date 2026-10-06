/**
 * Chart settings dialog: symbol, timeframe, rendering style, price levels.
 *
 * Symbol entry is deliberately forgiving — `CPF`, `SET:CPF` and `CPF.BK` all
 * resolve to the same TradingView symbol server-side, and the resolved form is
 * echoed back so the user sees what will actually be requested.
 */
import { modal, section, selectField, checkbox, escape } from '../ui.js';
import { api } from '../api.js';

const CHART_TYPES = [
  { value: 'candles', label: 'Candles' },
  { value: 'heikin', label: 'Heikin Ashi' },
  { value: 'bars', label: 'OHLC bars' },
  { value: 'line', label: 'Line' },
  { value: 'area', label: 'Area' },
  { value: 'baseline', label: 'Baseline' },
];

export function openChartSettings({
  config, meta, catalog, indicators, onChange, onLoad, onEditIndicator,
}) {
  let symbol = config.symbol;
  let timeframe = config.timeframe;
  let chartType = config.chartType;
  let logScale = config.logScale;
  let autoscale = config.autoscale !== false;
  const levels = (config.priceLines ?? []).map((l) => ({ ...l }));
  let read = () => ({ symbol, timeframe, chartType, logScale, autoscale, priceLines: levels });

  modal({
    title: 'Chart settings',
    subtitle: `${symbol} · ${timeframe}`,
    size: 'md',
    render(body) {
      // ── Instrument ──────────────────────────────────────────────────────────
      body.appendChild(section('Instrument'));

      const symbolRow = document.createElement('div');
      symbolRow.className = 'row';
      const symbolInput = document.createElement('input');
      symbolInput.className = 'input';
      symbolInput.spellcheck = false;
      symbolInput.autocomplete = 'off';
      symbolInput.value = symbol;
      const searchBtn = document.createElement('button');
      searchBtn.className = 'btn';
      searchBtn.textContent = 'Search SET';
      symbolRow.append(symbolInput, searchBtn);

      const hint = document.createElement('p');
      hint.className = 'section__hint';
      hint.textContent = 'Accepts CPF, SET:CPF or CPF.BK.';

      const results = document.createElement('div');
      results.className = 'symbol-results';

      body.append(symbolRow, hint, results);

      const resolve = async (value) => {
        try {
          const r = await api.resolveSymbol(value);
          if (r.symbol) {
            symbol = r.symbol;
            hint.textContent = `Resolves to ${r.symbol} → ${r.yahooSymbol ?? 'n/a'}`;
            hint.classList.remove('is-error');
            return true;
          }
        } catch { /* fall through to the error path */ }
        hint.textContent = `Could not resolve "${value}".`;
        hint.classList.add('is-error');
        return false;
      };

      symbolInput.addEventListener('change', () => resolve(symbolInput.value));

      searchBtn.addEventListener('click', async () => {
        results.innerHTML = '<p class="section__hint">Searching…</p>';
        try {
          const data = await api.symbols(symbolInput.value || '', 'thailand', 30);
          results.innerHTML = '';
          if (!data.results.length) {
            results.innerHTML = '<p class="section__hint">No match. Type a ticker directly instead.</p>';
            return;
          }
          for (const row of data.results) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'symbol-row';
            btn.innerHTML = `
              <b>${escape(row.display)}</b>
              <span>${escape(row.name)}</span>
              <em>${row.price ?? '—'}</em>
              <i class="${(row.changePercent ?? 0) >= 0 ? 'is-up' : 'is-down'}">${row.changePercent == null ? '' : `${row.changePercent >= 0 ? '+' : ''}${row.changePercent.toFixed(2)}%`}</i>
            `;
            btn.addEventListener('click', () => {
              symbol = row.symbol;
              symbolInput.value = row.symbol;
              results.innerHTML = '';
              resolve(row.symbol);
            });
            results.appendChild(btn);
          }
        } catch (err) {
          results.innerHTML = `<p class="section__hint is-error">${escape(err.message)}</p>`;
        }
      });

      // ── Timeframe ───────────────────────────────────────────────────────────
      body.appendChild(section('Timeframe'));
      const tfGrid = document.createElement('div');
      tfGrid.className = 'tf-grid';
      for (const tf of meta.timeframes) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `tf-btn${tf.id === timeframe ? ' is-active' : ''}`;
        btn.textContent = tf.id;
        btn.title = tf.label;
        btn.addEventListener('click', () => {
          timeframe = tf.id;
          tfGrid.querySelectorAll('.tf-btn').forEach((b) => b.classList.remove('is-active'));
          btn.classList.add('is-active');
        });
        tfGrid.appendChild(btn);
      }
      body.appendChild(tfGrid);

      // ── Rendering ───────────────────────────────────────────────────────────
      body.appendChild(section('Rendering'));
      const renderGrid = document.createElement('div');
      renderGrid.className = 'form-grid';
      renderGrid.append(
        selectField('Style', chartType, CHART_TYPES, (v) => { chartType = v; }),
        checkbox('Logarithmic price scale', logScale, (v) => { logScale = v; }),
        checkbox('Auto-fit on data change', autoscale, (v) => { autoscale = v; }),
      );
      body.appendChild(renderGrid);

      // ── Indicators ──────────────────────────────────────────────────────────
      body.appendChild(section('Indicators', 'Click a row to edit its parameters.'));
      const list = document.createElement('div');
      list.className = 'mini-list';
      if (!indicators.length) {
        list.innerHTML = '<p class="section__hint">No indicators on this chart yet.</p>';
      } else {
        for (const inst of indicators) {
          const def = catalog[inst.type];
          const row = document.createElement('button');
          row.type = 'button';
          row.className = 'mini-row';
          row.innerHTML = `
            <b>${escape(def?.short ?? inst.type.toUpperCase())}</b>
            <span>${escape(inst.placement === 'pane' ? 'own pane' : 'overlay')}</span>
            <span class="${inst.enabled === false ? 'is-muted' : 'is-up'}">${inst.enabled === false ? 'disabled' : 'on'}</span>
          `;
          row.addEventListener('click', () => {
            document.querySelector('.modal:last-of-type [data-close]')?.click();
            onEditIndicator?.(inst.id);
          });
          list.appendChild(row);
        }
      }
      body.appendChild(list);

      // ── Price levels ────────────────────────────────────────────────────────
      body.appendChild(section('Price levels', 'Horizontal lines drawn on the price chart.'));
      const levelsHost = document.createElement('div');
      levelsHost.className = 'levels';
      body.appendChild(levelsHost);

      const drawLevels = () => {
        levelsHost.innerHTML = '';
        levels.forEach((level, index) => {
          const row = document.createElement('div');
          row.className = 'levels__row';
          row.innerHTML = `
            <input type="number" step="any" data-f="value" placeholder="Price" title="Price level">
            <input type="text" data-f="title" placeholder="Label" maxlength="16" title="Axis label">
            <input type="color" data-f="color" title="Colour">
            <select data-f="style" title="Style">
              <option value="solid">solid</option>
              <option value="dashed">dashed</option>
              <option value="dotted">dotted</option>
            </select>
            <button class="btn btn--ghost" data-act="del" title="Remove">✕</button>
          `;
          row.querySelector('[data-f="value"]').value = level.value ?? '';
          row.querySelector('[data-f="title"]').value = level.title ?? '';
          row.querySelector('[data-f="color"]').value = level.color ?? '#f7a600';
          row.querySelector('[data-f="style"]').value = level.style ?? 'solid';
          row.addEventListener('input', (e) => {
            const key = e.target.dataset.f;
            if (!key) return;
            levels[index][key] = key === 'value' ? Number(e.target.value) : e.target.value;
          });
          row.querySelector('[data-act="del"]').addEventListener('click', () => {
            levels.splice(index, 1);
            drawLevels();
          });
          levelsHost.appendChild(row);
        });
        const add = document.createElement('button');
        add.className = 'btn';
        add.type = 'button';
        add.textContent = '+ Add level';
        add.addEventListener('click', () => {
          levels.push({ value: null, title: '', color: '#f7a600', style: 'dashed' });
          drawLevels();
        });
        levelsHost.appendChild(add);
      };
      drawLevels();

      read = () => ({
        symbol,
        timeframe,
        chartType,
        logScale,
        autoscale,
        priceLines: levels.filter((l) => Number.isFinite(Number(l.value)) && l.value !== '' && l.value !== null),
      });
    },
    footer(foot, { close }) {
      foot.innerHTML = `
        <span class="spacer"></span>
        <button class="btn" data-close>Cancel</button>
        <button class="btn btn--primary" data-act="apply">Apply</button>
      `;
      foot.querySelector('[data-act="apply"]').addEventListener('click', () => {
        const next = read();
        close();
        onChange(next);
        if (next.symbol !== config.symbol
          || next.timeframe !== config.timeframe
          || next.chartType !== config.chartType) {
          onLoad?.();
        }
      });
    },
  });
}