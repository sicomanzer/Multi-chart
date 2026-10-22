/**
 * Board settings dialog: layout, theme, polling, cross-chart behaviour.
 */
import { modal, section, selectField, checkbox, escape, toast } from '../ui.js';
import { t, tp, tfLabel } from '../i18n.js';
import { api } from '../api.js';

export function openBoardSettings({ settings, meta, mcpStatus, metricCatalog = [], onSave, onRefreshRatios, onSnapshotHistory, historyStatus = null }) {
  const next = { ...settings };
  next.footerMetrics = [...(settings.footerMetrics ?? [])];
  let read = () => ({ ...next, footerMetrics: [...next.footerMetrics] });

  // How much of a series exists yet. Worth saying plainly: in the first weeks
  // this is one row per symbol, and no trend feature can honestly run on it.
  const renderHistoryNote = (node, status) => {
    if (!status) {
      node.textContent = t('common.loading');
      return;
    }
    const { symbols = 0, days = 0, lastDate = null } = status;
    if (days === 0) {
      node.textContent = t('bs.histEmpty');
      return;
    }
    const tracked = status.tracked?.length ?? 0;
    node.textContent = `${tp('stat.symbols', symbols)} × ${tracked} ${t('bs.ratios')}, ${tp('bs.days', days)}`
      + t('bs.since', { since: status.since ?? '—', last: lastDate ?? '—' })
      + (days < 30 ? t('bs.histShort') : '.');
  };

  const POLL_CHOICES = [
    { value: '5', label: t('poll.5') },
    { value: '10', label: t('poll.10') },
    { value: '20', label: t('poll.20') },
    { value: '30', label: t('poll.30') },
    { value: '60', label: t('poll.60') },
    { value: '120', label: t('poll.120') },
  ];

  modal({
    title: t('bs.title'),
    subtitle: t('bs.sub'),
    size: 'md',
    render(body) {
      body.appendChild(section(t('bs.layout'), t('bs.layoutHint')));
      const layout = document.createElement('div');
      layout.className = 'form-grid';
      layout.appendChild(selectField(t('bs.sizing'), next.layoutFit ?? 'auto', [
        { value: 'auto', label: t('bs.auto') },
        { value: 'fixed', label: t('bs.fixed') },
      ], (v) => { next.layoutFit = v; }));
      layout.appendChild(selectField(t('bs.columns'), String(next.columns), [1, 2, 3, 4, 5].map((n) => ({
        value: String(n), label: tp('bs.columnsN', n),
      })), (v) => { next.columns = Number(v); }));
      layout.appendChild(selectField(t('bs.theme'), next.theme, [
        { value: 'dark', label: t('bs.dark') },
        { value: 'light', label: t('bs.light') },
      ], (v) => { next.theme = v; }));
      layout.appendChild(selectField(t('bs.defaultTf'), next.defaultTimeframe,
        meta.timeframes.map((tf) => ({ value: tf.id, label: `${tf.id} — ${tfLabel(tf.id, tf.label)}` })),
        (v) => { next.defaultTimeframe = v; }));
      layout.appendChild(selectField(t('bs.defaultStyle'), next.candleStyle, [
        { value: 'candles', label: t('style.candles') },
        { value: 'bars', label: t('style.bars') },
        { value: 'line', label: t('style.line') },
        { value: 'area', label: t('style.area') },
        { value: 'baseline', label: t('style.baseline') },
      ], (v) => { next.candleStyle = v; }));
      body.appendChild(layout);

      body.appendChild(section(t('bs.footer'), t('bs.footerHint')));
      const footer = document.createElement('div');
      footer.className = 'form-grid';
      footer.appendChild(selectField(t('bs.show'), next.footerMode ?? 'both', [
        { value: 'fundamentals', label: t('bs.footerFund') },
        { value: 'indicators', label: t('bs.footerInd') },
        { value: 'both', label: t('bs.footerBoth') },
      ], (v) => {
        next.footerMode = v;
        metricsWrap.hidden = v === 'indicators';
      }));

      const refreshBtn = document.createElement('button');
      refreshBtn.className = 'btn';
      refreshBtn.type = 'button';
      refreshBtn.textContent = t('bs.refresh');
      refreshBtn.title = t('bs.refreshHint');
      refreshBtn.addEventListener('click', async () => {
        refreshBtn.disabled = true;
        refreshBtn.textContent = t('bs.refreshing');
        await onRefreshRatios?.();
        refreshBtn.disabled = false;
        refreshBtn.textContent = t('bs.refresh');
      });
      const refreshField = document.createElement('div');
      refreshField.className = 'field';
      refreshField.innerHTML = `<span class="field__label">${escape(t('bs.fundamentals'))}</span>`;
      refreshField.appendChild(refreshBtn);

      // What the history file holds, and a way to fill today's gap by hand.
      // Recording is automatic; this is only here so the series is not an
      // invisible thing the app does on its own.
      const historyField = document.createElement('div');
      historyField.className = 'field';
      historyField.innerHTML = `<span class="field__label">${escape(t('bs.history'))}</span>`;
      const historyNote = document.createElement('p');
      historyNote.className = 'section__hint';
      historyField.appendChild(historyNote);
      const snapshotBtn = document.createElement('button');
      snapshotBtn.className = 'btn';
      snapshotBtn.type = 'button';
      snapshotBtn.textContent = t('bs.record');
      snapshotBtn.title = t('bs.recordHint');
      snapshotBtn.addEventListener('click', async () => {
        snapshotBtn.disabled = true;
        snapshotBtn.textContent = t('bs.recording');
        // The returned summary is the fresh one; the dialog's own copy of
        // `historyStatus` was captured when it opened.
        const result = await onSnapshotHistory?.();
        renderHistoryNote(historyNote, result?.summary ?? null);
        snapshotBtn.disabled = false;
        snapshotBtn.textContent = t('bs.record');
      });
      historyField.appendChild(snapshotBtn);
      renderHistoryNote(historyNote, historyStatus);
      body.appendChild(historyField);

      // The reader's own work, carried out by hand.
      //
      // The container's filesystem is wiped on every deploy, so the boards, the
      // lists and the names being followed are worth taking with you. One file
      // holds all of it; importing replaces what is there.
      const backupField = document.createElement('div');
      backupField.className = 'field';
      backupField.innerHTML = `<span class="field__label">${escape(t('bs.backup'))}</span>`;
      const backupNote = document.createElement('p');
      backupNote.className = 'section__hint';
      backupNote.textContent = t('bs.backupHint');
      backupField.appendChild(backupNote);

      const exportBtn = document.createElement('button');
      exportBtn.className = 'btn';
      exportBtn.type = 'button';
      exportBtn.textContent = t('bs.backupExport');
      exportBtn.addEventListener('click', async () => {
        exportBtn.disabled = true;
        try {
          const data = await api.backup();
          const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `multi-chart-backup-${new Date().toISOString().slice(0, 10)}.json`;
          a.click();
          URL.revokeObjectURL(url);
        } catch (err) {
          toast(t('bs.backupFailed', { msg: err.message }), { type: 'error' });
        } finally {
          exportBtn.disabled = false;
        }
      });

      const importBtn = document.createElement('button');
      importBtn.className = 'btn';
      importBtn.type = 'button';
      importBtn.textContent = t('bs.backupImport');
      const importInput = document.createElement('input');
      importInput.type = 'file';
      importInput.accept = 'application/json,.json';
      importInput.hidden = true;
      importInput.addEventListener('change', async () => {
        const file = importInput.files?.[0];
        if (!file) return;
        importBtn.disabled = true;
        try {
          const data = JSON.parse(await file.text());
          await api.restoreBackup(data);
          toast(t('bs.backupRestored'), { type: 'success' });
          // The boards and the lists have changed underneath the app.
          window.location.reload();
        } catch (err) {
          toast(t('bs.backupFailed', { msg: err.message }), { type: 'error' });
          importBtn.disabled = false;
        }
      });
      importBtn.addEventListener('click', () => importInput.click());

      backupField.append(exportBtn, importBtn, importInput);
      body.appendChild(backupField);

      const metricsWrap = document.createElement('div');
      metricsWrap.className = 'field';
      metricsWrap.hidden = next.footerMode === 'indicators';
      metricsWrap.innerHTML = `<span class="field__label">${escape(t('bs.whichRatios'))}</span>`;
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
      if (!metricCatalog.length) chips.innerHTML = `<span class="section__hint">${escape(t('bs.metricsMissing'))}</span>`;
      metricsWrap.appendChild(chips);

      footer.appendChild(metricsWrap);
      footer.appendChild(refreshField);
      body.appendChild(footer);

      body.appendChild(section(t('bs.live'), t('bs.liveHint')));
      const live = document.createElement('div');
      live.className = 'form-grid';
      live.appendChild(selectField(t('bs.poll'), String(next.pollSeconds), POLL_CHOICES, (v) => { next.pollSeconds = Number(v); }));
      live.appendChild(checkbox(t('bs.liveQuotes'), next.liveQuotes, (v) => { next.liveQuotes = v; }));
      live.appendChild(checkbox(t('bs.syncCrosshair'), next.syncCrosshair, (v) => { next.syncCrosshair = v; }));
      live.appendChild(checkbox(t('bs.syncTimeScale'), next.syncTimeScale, (v) => { next.syncTimeScale = v; }));
      live.appendChild(checkbox(t('bs.showGrid'), next.showGrid, (v) => { next.showGrid = v; }));
      live.appendChild(checkbox(t('bs.showWatermark'), next.showWatermark, (v) => { next.showWatermark = v; }));
      body.appendChild(live);

      body.appendChild(section(t('bs.alert'), t('bs.alertHint')));
      const alert = document.createElement('div');
      alert.className = 'form-grid';
      alert.appendChild(checkbox(
        t('bs.alertCheck'),
        next.oversoldAlert !== false,
        (v) => { next.oversoldAlert = v; },
      ));
      body.appendChild(alert);

      body.appendChild(section(t('bs.connection')));
      const status = document.createElement('pre');
      status.className = 'code-block';
      status.textContent = JSON.stringify(mcpStatus ?? {}, null, 2);
      body.appendChild(status);

      read = () => ({ ...next, footerMetrics: [...next.footerMetrics] });
    },
    footer(foot, { close }) {
      foot.innerHTML = `
        <span class="spacer"></span>
        <button class="btn" data-close>${escape(t('common.cancel'))}</button>
        <button class="btn btn--primary" data-act="save">${escape(t('common.save'))}</button>
      `;
      foot.querySelector('[data-act="save"]').addEventListener('click', () => {
        onSave(read());
        close();
      });
    },
  });
}