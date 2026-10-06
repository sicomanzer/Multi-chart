/**
 * Board settings dialog: layout, theme, polling, cross-chart behaviour.
 */
import { modal, section, selectField, checkbox, escape } from '../ui.js';

export function openBoardSettings({ settings, meta, mcpStatus, metricCatalog = [], onSave, onRefreshRatios }) {
  const next = { ...settings };
  next.footerMetrics = [...(settings.footerMetrics ?? [])];
  let read = () => ({ ...next, footerMetrics: [...next.footerMetrics] });

  const POLL_CHOICES = [
    { value: '5', label: '5 seconds (aggressive)' },
    { value: '10', label: '10 seconds' },
    { value: '20', label: '20 seconds (default)' },
    { value: '30', label: '30 seconds' },
    { value: '60', label: '60 seconds (relaxed)' },
    { value: '120', label: '2 minutes (background)' },
  ];

  modal({
    title: 'Board settings',
    subtitle: 'Applies to every chart on this board.',
    size: 'md',
    render(body) {
      body.appendChild(section('Layout', 'Auto fit sizes the grid so every chart is visible without scrolling.'));
      const layout = document.createElement('div');
      layout.className = 'form-grid';
      layout.appendChild(selectField('Board sizing', next.layoutFit ?? 'auto', [
        { value: 'auto', label: 'Auto fit to screen' },
        { value: 'fixed', label: 'Fixed columns (scroll if needed)' },
      ], (v) => { next.layoutFit = v; }));
      layout.appendChild(selectField('Columns', String(next.columns), [1, 2, 3, 4, 5, 6].map((n) => ({
        value: String(n), label: `${n} column${n > 1 ? 's' : ''}`,
      })), (v) => { next.columns = Number(v); }));
      layout.appendChild(selectField('Theme', next.theme, [
        { value: 'dark', label: 'Dark' },
        { value: 'light', label: 'Light' },
      ], (v) => { next.theme = v; }));
      layout.appendChild(selectField('Default timeframe', next.defaultTimeframe,
        meta.timeframes.map((t) => ({ value: t.id, label: `${t.id} — ${t.label}` })),
        (v) => { next.defaultTimeframe = v; }));
      layout.appendChild(selectField('Default chart style', next.candleStyle, [
        { value: 'candles', label: 'Candles' },
        { value: 'bars', label: 'OHLC bars' },
        { value: 'line', label: 'Line' },
        { value: 'area', label: 'Area' },
        { value: 'baseline', label: 'Baseline' },
      ], (v) => { next.candleStyle = v; }));
      body.appendChild(layout);

      body.appendChild(section('Chart footer', 'The strip under each chart: valuation ratios, indicator values, or both.'));
      const footer = document.createElement('div');
      footer.className = 'form-grid';
      footer.appendChild(selectField('Show', next.footerMode ?? 'both', [
        { value: 'fundamentals', label: 'Fundamentals only (P/E, P/BV, D/E, yield)' },
        { value: 'indicators', label: 'Indicator values only' },
        { value: 'both', label: 'Both (ratios on top, indicators below)' },
      ], (v) => {
        next.footerMode = v;
        metricsWrap.hidden = v === 'indicators';
      }));

      const refreshBtn = document.createElement('button');
      refreshBtn.className = 'btn';
      refreshBtn.type = 'button';
      refreshBtn.textContent = 'Refresh ratios now';
      refreshBtn.title = 'Bypass the 30-minute cache and re-query the screener';
      refreshBtn.addEventListener('click', async () => {
        refreshBtn.disabled = true;
        refreshBtn.textContent = 'Refreshing…';
        await onRefreshRatios?.();
        refreshBtn.disabled = false;
        refreshBtn.textContent = 'Refresh ratios now';
      });
      const refreshField = document.createElement('div');
      refreshField.className = 'field';
      refreshField.innerHTML = '<span class="field__label">Fundamentals</span>';
      refreshField.appendChild(refreshBtn);

      const metricsWrap = document.createElement('div');
      metricsWrap.className = 'field';
      metricsWrap.hidden = next.footerMode === 'indicators';
      metricsWrap.innerHTML = '<span class="field__label">Which ratios</span>';
      const chips = document.createElement('div');
      chips.className = 'chip-row';
      for (const metric of metricCatalog) {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'chip chip--toggle';
        chip.textContent = metric.label;
        chip.title = metric.hint ?? metric.key;
        chip.dataset.key = metric.key;
        if (next.footerMetrics.includes(metric.key)) chip.classList.add('is-on');
        chip.addEventListener('click', () => {
          const at = next.footerMetrics.indexOf(metric.key);
          if (at >= 0) next.footerMetrics.splice(at, 1);
          else next.footerMetrics.push(metric.key);
          chip.classList.toggle('is-on');
        });
        chips.appendChild(chip);
      }
      if (!metricCatalog.length) chips.innerHTML = '<span class="section__hint">Metric list unavailable</span>';
      metricsWrap.appendChild(chips);

      footer.appendChild(metricsWrap);
      footer.appendChild(refreshField);
      body.appendChild(footer);

      body.appendChild(section('Live data', 'Quotes are pushed by the server over SSE; the MCP screener is polled once per interval for the whole board.'));
      const live = document.createElement('div');
      live.className = 'form-grid';
      live.appendChild(selectField('Quote poll interval', String(next.pollSeconds), POLL_CHOICES, (v) => { next.pollSeconds = Number(v); }));
      live.appendChild(checkbox('Live quotes (turn off to freeze the board)', next.liveQuotes, (v) => { next.liveQuotes = v; }));
      live.appendChild(checkbox('Mirror crosshair across every chart', next.syncCrosshair, (v) => { next.syncCrosshair = v; }));
      live.appendChild(checkbox('Link zoom/pan between charts', next.syncTimeScale, (v) => { next.syncTimeScale = v; }));
      live.appendChild(checkbox('Show grid lines', next.showGrid, (v) => { next.showGrid = v; }));
      live.appendChild(checkbox('Show last-price marker inside the chart', next.showWatermark, (v) => { next.showWatermark = v; }));
      body.appendChild(live);

      body.appendChild(section('Connection'));
      const status = document.createElement('pre');
      status.className = 'code-block';
      status.textContent = JSON.stringify(mcpStatus ?? {}, null, 2);
      body.appendChild(status);

      read = () => ({ ...next, footerMetrics: [...next.footerMetrics] });
    },
    footer(foot, { close }) {
      foot.innerHTML = `
        <span class="spacer"></span>
        <button class="btn" data-close>Cancel</button>
        <button class="btn btn--primary" data-act="save">Save</button>
      `;
      foot.querySelector('[data-act="save"]').addEventListener('click', () => {
        onSave(read());
        close();
      });
    },
  });
}