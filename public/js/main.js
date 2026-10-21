/**
 * Bootstrap: wire the top bar, fetch boot data, hand control to the Board.
 *
 * Boot sequence (one round trip each, all in parallel):
 *   /api/meta       timeframes, exchanges, default settings
 *   /api/indicators the catalog every editor is generated from
 *   /api/workspaces saved boards (falls back to the server's starter board)
 *
 * The last-visited board id is kept in localStorage so a reload lands you back
 * where you were; the server copy remains the source of truth for the content.
 */
import { api } from './api.js';
import { Board } from './board.js';
import { toast, escape, askText } from './ui.js';
import {
  t, tp, localizeCatalog, localizeMetrics, toggleLang, getLang, timeString, tfLabel,
} from './i18n.js';
import { openIndicatorPicker } from './dialogs/indicator-dialog.js';
import { openWatchlists } from './dialogs/watchlist-dialog.js';
import { openOversoldList } from './dialogs/oversold-dialog.js';
import { openScreener } from './dialogs/screener-dialog.js';

const LOCAL_KEY = 'mctd:last-workspace';

/**
 * Zoom step. One click multiplies every chart's bar spacing by this, so "in"
 * means fewer, wider bars — the same feel as TradingView's wheel zoom, but
 * applied to the whole board at once.
 */
const ZOOM_IN = 1.25;
const ZOOM_OUT = 1 / ZOOM_IN;

/**
 * Value prefix that tells the board dropdown an option is a watchlist rather
 * than a board. Both live in the one `<select>` so a user can jump between a
 * layout and a saved symbol list without reaching for a second control.
 */
const WATCHLIST_PREFIX = 'wl:';

const el = {
  grid: document.getElementById('grid'),
  empty: document.getElementById('emptyState'),
  timeframeBar: document.getElementById('timeframeBar'),
  addChartBtn: document.getElementById('addChartBtn'),
  watchlistBtn: document.getElementById('watchlistBtn'),
  screenerBtn: document.getElementById('screenerBtn'),
  analyzeBtn: document.getElementById('analyzeBtn'),
  oversoldBtn: document.getElementById('oversoldBtn'),
  emptyAddBtn: document.getElementById('emptyAddBtn'),
  addIndicatorBtn: document.getElementById('addIndicatorBtn'),
  editIndicatorsBtn: document.getElementById('editIndicatorsBtn'),
  settingsBtn: document.getElementById('settingsBtn'),
  fitBtn: document.getElementById('fitBtn'),
  zoomInBtn: document.getElementById('zoomInBtn'),
  zoomOutBtn: document.getElementById('zoomOutBtn'),
  zoomResetBtn: document.getElementById('zoomResetBtn'),
  mcpBtn: document.getElementById('mcpBtn'),
  themeBtn: document.getElementById('themeBtn'),
  saveBtn: document.getElementById('saveBtn'),
  workspaceSelect: document.getElementById('workspaceSelect'),
  langBtn: document.getElementById('langBtn'),
  filterChip: document.getElementById('filterChip'),
  workspaceName: document.getElementById('workspaceName'),
  statusPill: document.getElementById('statusPill'),
  statCharts: document.getElementById('statCharts'),
  statIndicators: document.getElementById('statIndicators'),
  statLastTick: document.getElementById('statLastTick'),
  statLayout: document.getElementById('statLayout'),
  statSaved: document.getElementById('statSaved'),
};

async function boot() {
  const [meta, catalogRes, workspacesRes, metricsRes] = await Promise.all([
    api.meta(),
    api.indicators(),
    api.workspaces().catch(() => ({ workspaces: [] })),
    // Fundamentals are optional: if the sidecar is missing the board still works.
    api.fundamentalsMeta().catch(() => ({ metrics: [], defaults: [] })),
  ]);

  /**
   * Timeframe ids stay exactly as the server sent them — only the human-facing
   * `label` is swapped for the translated one, because the label also appears in
   * the timeframe buttons' tooltips and in two dialogs.
   */
  const timeframes = (meta.timeframes ?? []).map((tf) => ({
    ...tf,
    label: tfLabel(tf.id, tf.label),
  }));
  meta.timeframes = timeframes;

  const catalog = Object.fromEntries(catalogRes.indicators.map((i) => [i.type, i]));
  // Names, groups and parameter labels are ours to translate; every id, range
  // and default stays exactly as the server sent it.
  const localized = localizeCatalog(catalog, catalogRes.groups);
  const metricCatalog = localizeMetrics(metricsRes.metrics ?? []);
  const board = new Board({
    gridEl: el.grid,
    meta,
    catalog: localized.catalog,
    groups: localized.groups,
    metricCatalog,
    metricLabels: Object.fromEntries(metricCatalog.map((m) => [m.key, m])),
  });

  window.__board = board; // handy for poking at state in devtools

  wireBoardEvents(board);

  // Pick the board to open: last used if it still exists, else the newest.
  const lastId = localStorage.getItem(LOCAL_KEY);
  let target = workspacesRes.workspaces.find((w) => w.id === lastId)
    ?? workspacesRes.workspaces[0]
    ?? null;

  if (!target) {
    // No saved board yet: POST the server-side starter and use the result.
    const seeded = await api.saveWorkspace({ name: 'My board', charts: [], settings: meta.defaultSettings });
    target = { id: seeded.id };
  }
  await board.loadWorkspace(await api.workspace(target.id));

  // The top bar reads the loaded workspace (current timeframe, theme), so it is
  // wired only once a board is on screen.
  wireTopbar(board);
  await refreshWorkspaceList(board);

  // Intraday boards need their forming candles refreshed even without a
  // symbol/timeframe change, otherwise the last bar freezes.
  setInterval(() => {
    if (document.visibilityState === 'visible') board.refreshIntraday();
  }, 60_000);

  // Daily bars and up move once a session, but the forming bar still ticks, so
  // they need a pass of their own — at a much slower cadence than intraday, or
  // a 60-chart board would refetch all sixty bars every minute and the upstream
  // would throttle the lot.
  setInterval(() => {
    if (document.visibilityState === 'visible') board.refreshDaily();
  }, 300_000);

  // Auto-fit depends on the viewport, so recompute when it changes. Debounced:
  // dragging a window edge fires a burst of resizes.
  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => board.applyLayout(), 150);
  });

  // Persist on close so an in-flight edit is never lost to a refresh. `keepalive`
// lets the request finish while the page goes away.
  window.addEventListener('beforeunload', () => {
    board.unloading = true;
    board.flushSave();
  });

  // One deep probe at boot, purely so the pill can show a latency number.
  api.health(true)
    .then((h) => updateStatusPill(board, h))
    .catch(() => updateStatusPill(board, null));
}

function wireTopbar(board) {
  // Timeframe buttons, driven by /api/meta.
  for (const tf of board.meta.timeframes) {
    const btn = document.createElement('button');
    btn.className = 'tf-btn';
    btn.type = 'button';
    btn.textContent = tf.id;
    btn.title = tf.label;
    btn.dataset.tf = tf.id;
    btn.addEventListener('click', () => {
      const active = el.timeframeBar.querySelector('.is-active');
      if (active?.dataset.tf === tf.id) {
        // Clicking the current timeframe again reloads the data instead.
        board.loadAllCandles();
        return;
      }
      board.setTimeframeAll(tf.id);
      markTimeframe(tf.id);
    });
    el.timeframeBar.appendChild(btn);
  }
  markTimeframe(board.workspace.settings.defaultTimeframe);

  // The button names the language you would get by clicking it, which is the
  // only unambiguous label: "EN" beside an English UI reads as a state, not an
  // action.
  el.langBtn.textContent = getLang() === 'th' ? 'EN' : 'ไทย';
  el.langBtn.addEventListener('click', toggleLang);

  el.addChartBtn.addEventListener('click', () => board.openAddChart());
  el.emptyAddBtn.addEventListener('click', () => board.openAddChart());
  el.watchlistBtn.addEventListener('click', () =>
    openWatchlists({ board, onChanged: () => refreshWorkspaceList(board) }));
  el.screenerBtn.addEventListener('click', () => openScreener({ board }));
  // One company in full: the same dialog the screener opens for a row, with a
  // search box in front of it.
  el.analyzeBtn.addEventListener('click', () => openScreener({ board, mode: 'analyze' }));

  // The board re-publishes the oversold set whenever any chart rebuilds its
  // indicators. The button is only a summary — it says how many are under
  // water, and the dialog answers which ones.
  let oversoldHits = [];

  const paintOversold = (hits) => {
    oversoldHits = hits;
    const n = hits.length;
    el.oversoldBtn.hidden = n === 0;
    if (n === 0) return;
    // Thresholds can differ per chart, so name the highest line in play rather
    // than implying one number applies to the whole board.
    const line = Math.max(...hits.map((h) => h.threshold));
    el.oversoldBtn.textContent = t('oversold.chip', { n, line });
    el.oversoldBtn.title = hits
      .map((h) => `${h.symbol} RSI ${h.value.toFixed(1)} < ${h.threshold}`)
      .join('\n');
  };

  board.addEventListener('oversold', (event) => paintOversold(event.detail ?? []));

  // The board's first scan is queued during `loadWorkspace`, which finishes
  // before this listener exists, so seed the button from a scan of its own
  // rather than waiting a minute for the intraday tick to say anything.
  paintOversold(board.collectOversold());

  el.oversoldBtn.addEventListener('click', () => openOversoldList({ board, hits: oversoldHits }));

  el.filterChip.addEventListener('click', () => {
    board.clearFilter();
    toast(t('toast.showAll'), { type: 'info', timeout: 2200 });
  });
  el.settingsBtn.addEventListener('click', () => board.openSettings());
  el.mcpBtn.addEventListener('click', () => board.openMcp());

  el.fitBtn.addEventListener('click', () => {
    board.workspace.settings.layoutFit = 'auto';
    const result = board.applyLayout();
    board.commit();
    toast(result?.fits
      ? t('toast.fit.ok', { charts: result.charts, cols: result.cols, rows: result.rows })
      : t('toast.fit.no', { n: result?.charts ?? board.tiles.size }), {
      type: result?.fits ? 'success' : 'info',
      timeout: 2600,
    });
  });

  // One click zooms every chart on the board by the same ratio, so a board of
  // mixed timeframes stays readable together.
  el.zoomInBtn.addEventListener('click', () => board.zoomAll(ZOOM_IN));
  el.zoomOutBtn.addEventListener('click', () => board.zoomAll(ZOOM_OUT));
  el.zoomResetBtn.addEventListener('click', () => {
    board.fitAll();
    toast(t('toast.zoomReset'), { type: 'info', timeout: 1800 });
  });

  el.addIndicatorBtn.addEventListener('click', () => {
    openIndicatorPicker({
      catalog: board.catalog,
      groups: board.groups,
      current: [],
      onAdd: (type) => board.addIndicatorToAll(type),
    });
  });

  // One dialog, one indicator, every chart — the counterpart to "ƒx All", which
  // adds a study board-wide.
  el.editIndicatorsBtn.addEventListener('click', () => board.openBoardIndicatorEditor());

  el.themeBtn.addEventListener('click', () => {
    const next = board.workspace.settings.theme === 'dark' ? 'light' : 'dark';
    board.workspace.settings.theme = next;
    board.applyTheme(next);
    board.commit();
  });

  el.saveBtn.addEventListener('click', async () => {
    await board.flushSave({ force: true });
    toast(t('toast.saved'), { type: 'success', timeout: 2000 });
    await refreshWorkspaceList(board);
  });

  el.workspaceSelect.addEventListener('change', async () => {
    const raw = el.workspaceSelect.value;
    if (!raw) return;

    // One dropdown holds two kinds of thing: a board is a layout, a watchlist
    // is a set of symbols applied to whatever layout is on screen. The value
    // prefix says which was picked.
    const kind = raw.startsWith(WATCHLIST_PREFIX) ? 'watchlist' : 'board';
    const id = raw.slice(raw.indexOf(':') + 1);

    try {
      if (kind === 'watchlist') {
        const wl = await api.watchlist(id);
        const symbols = new Set(wl.symbols ?? []);
        if (!symbols.size) {
          toast(t('toast.wl.empty', { name: wl.name }), { type: 'info' });
        } else {
          board.setFilter(symbols, wl.name, wl.id);
          const onBoard = board.visibleCount();
          toast(onBoard
            ? tp('toast.wl.showing', onBoard, { name: wl.name })
            : t('toast.wl.none', { name: wl.name }),
            { type: onBoard ? 'success' : 'error', timeout: 5000 });
        }
        return;
      }

      if (id === board.workspace.id) {
        // Re-picking the board that is already loaded means "show me the whole
        // board". Without this the select would snap back to the watchlist
        // option and look like a dead control, because a filter is holding
        // the board option unticked.
        if (board.filterSymbols) {
          board.clearFilter();
          toast(t('toast.all', { n: board.tiles.size }), { type: 'info', timeout: 2400 });
        }
        // The filter event re-syncs the dropdown; nothing to do here.
        return;
      }
      const ws = await api.workspace(id);
      // A different board holds different charts; a filter carried over would
      // hide most of it for no reason the user asked for.
      if (board.filterSymbols) board.clearFilter();
      await board.loadWorkspace(ws);
      markTimeframe(ws.settings.defaultTimeframe);
      await refreshWorkspaceList(board);
    } catch (err) {
      toast(t('err.openKind', { kind: t(`err.kind.${kind}`), msg: err.message }), { type: 'error' });
      await refreshWorkspaceList(board);
    }
  });
}

function wireBoardEvents(board) {
  board.addEventListener('workspace', (e) => {
    const ws = e.detail;
    el.workspaceName.textContent = tp('top.nameCharts', ws.charts.length, { name: ws.name });
    el.empty.hidden = ws.charts.length > 0;
    markTimeframe(ws.settings.defaultTimeframe);
  });

  board.addEventListener('stats', (e) => {
    const { charts, indicators, symbols } = e.detail;
    el.statCharts.textContent = tp('stat.charts', charts);
    el.statIndicators.textContent = `${tp('stat.indicators', indicators)} · ${tp('stat.symbols', symbols)}`;
    el.empty.hidden = charts > 0;
  });

  board.addEventListener('quotes', (e) => {
    const ts = e.detail?.ts;
    if (!ts) return;
    const secs = Math.max(0, Math.round((Date.now() - ts) / 1000));
    el.statLastTick.textContent = t('stat.quotes', {
      t: secs < 2 ? t('stat.justNow') : t('stat.secsAgo', { n: secs }),
    });
  });

  board.addEventListener('status', () => updateStatusPill(board));
board.addEventListener('reidentified', (e) => {
    localStorage.setItem(LOCAL_KEY, e.detail);
    refreshWorkspaceList(board);
  });

  board.addEventListener('conflict', async (e) => {
    toast(t('toast.conflict'), {
      type: 'error', timeout: 6000,
    });
    const current = e.detail;
    if (!current) return;
    // Drop pending edits first so the reload is not immediately undone by a
    // queued autosave carrying the stale revision.
    await board.loadWorkspace(current);
    await refreshWorkspaceList(board);
  });
  board.addEventListener('zoom', (e) => {
    const { moved } = e.detail ?? {};
    // Dim the buttons when a click cannot move anything (already at the limit).
    const atLimit = moved === 0;
    el.zoomInBtn.classList.toggle('is-idle', atLimit);
    el.zoomOutBtn.classList.toggle('is-idle', atLimit);
  });

  board.addEventListener('layout', (e) => {
    const r = e.detail ?? {};
    if (r.fixed) {
      el.statLayout.textContent = t('stat.layoutFixed', { n: board.workspace.settings.columns });
      return;
    }
    if (!r.fits) {
      el.statLayout.textContent = t('stat.layoutCantFit', { n: r.charts ?? board.visibleCount() });
      return;
    }
    const size = `${Math.round(r.tileW)}×${Math.round(r.tileH)}px`;
    // "Compact" is not an apology — it says the board chose small tiles on
    // purpose so that everything stays on one screen, which is a different
    // situation from a board that overflowed and has to be scrolled.
    el.statLayout.textContent = t('stat.layoutFit', { cols: r.cols, rows: r.rows, size })
      + (r.compact ? t('stat.layoutCompact') : '');
  });

  // The filter chip appears only while a watchlist is narrowing the board, and
  // clearing it is one click — the hidden charts were never removed. The
  // dropdown has to follow too, or it keeps showing a list that is no longer
  // applied.
  board.addEventListener('filter', (e) => {
    const f = e.detail ?? {};
    el.filterChip.hidden = !f.name;
    if (f.name) {
      el.filterChip.querySelector('b').textContent = f.name;
      el.filterChip.querySelector('i').textContent = t('top.filterCount', { visible: f.visible, hidden: f.hidden });
    }
    refreshWorkspaceList(board);
  });

  board.addEventListener('stream', (e) => updateStatusPill(board, null, e.detail));
  board.addEventListener('change', () => {
    el.statSaved.textContent = t('stat.saving');
  });
  board.addEventListener('saved', () => {
    el.statSaved.textContent = t('stat.savedAt', { time: timeString() });
  });

  // Keyboard: `+`/`-` zoom the whole board, `0` resets it. Ignore the shortcut
  // while a dialog is open or the user is typing in a field.
  document.addEventListener('keydown', (e) => {
    if (e.key !== '+' && e.key !== '=' && e.key !== '-' && e.key !== '_' && e.key !== '0') return;
    if (document.querySelector('.modal')) return;
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

    if (e.key === '+' || e.key === '=') { board.zoomAll(ZOOM_IN); e.preventDefault(); }
    else if (e.key === '-' || e.key === '_') { board.zoomAll(ZOOM_OUT); e.preventDefault(); }
    else if (e.key === '0') { board.fitAll(); e.preventDefault(); }
  });

  // Escape leaves focus mode; it must not also close an open dialog, so the
  // dialog handles its own keydown first.
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (document.querySelector('.modal')) return;
    if (!board.focusedId) return;
    const tile = board.tiles.get(board.focusedId);
    if (tile) board.toggleFocus(tile);
  });
}

function markTimeframe(tf) {
  el.timeframeBar.querySelectorAll('.tf-btn').forEach((b) => {
    b.classList.toggle('is-active', b.dataset.tf === tf);
  });
}

function updateStatusPill(board, health = null, stream = null) {
  const mcp = health?.mcp ?? board.mcpStatus ?? {};
  const connected = mcp.connected ?? stream?.connected ?? false;
  const dot = el.statusPill.querySelector('.dot');
  const label = el.statusPill.querySelector('span');

  dot.classList.toggle('is-on', Boolean(connected));
  dot.classList.toggle('is-off', !connected);

  if (connected) {
    label.textContent = health?.mcp?.ping
      ? t('status.mcpPing', { ms: health.mcp.ping.ms })
      : t('status.mcpReady');
    el.statusPill.classList.remove('is-error');
  } else {
    label.textContent = mcp.lastError ? t('status.mcpOffline') : t('status.connecting');
    el.statusPill.classList.toggle('is-error', Boolean(mcp.lastError));
    el.statusPill.title = mcp.lastError ?? t('status.waiting');
  }
}

/**
 * Fill the board dropdown.
 *
 * Boards and watchlists share one `<select>`, separated into two `<optgroup>`s:
 * a board is a whole layout, a watchlist is a set of symbols applied to the
 * layout already on screen. Keeping them in one place is the point — otherwise
 * switching between "the grid I built" and "these twenty names" costs a trip to
 * a different dialog.
 *
 * The selection follows state rather than the other way round: whichever board
 * is loaded stays ticked, and a watchlist is ticked only while its filter is
 * actually applied.
 */
async function refreshWorkspaceList(board) {
  try {
    // Both are needed; a failure on the watchlist side must not blank the board
    // list, which is the control people actually use to switch layouts.
    const [boardData, listData] = await Promise.all([
      api.workspaces(),
      api.watchlists().catch(() => ({ watchlists: [] })),
    ]);
    const { workspaces } = boardData;
    const watchlists = listData.watchlists ?? [];

    el.workspaceSelect.innerHTML = '';

    const boardGroup = document.createElement('optgroup');
    boardGroup.label = t('ws.boards');
    for (const ws of workspaces) {
      const opt = document.createElement('option');
      opt.value = ws.id;
      opt.textContent = `${ws.name} (${ws.chartCount})`;
      opt.selected = !board.filterSymbols && ws.id === board.workspace?.id;
      boardGroup.appendChild(opt);
    }
    el.workspaceSelect.appendChild(boardGroup);

    if (watchlists.length) {
      const listGroup = document.createElement('optgroup');
      listGroup.label = t('ws.watchlists');
      for (const wl of watchlists) {
        const opt = document.createElement('option');
        opt.value = `${WATCHLIST_PREFIX}${wl.id}`;
        opt.textContent = `${wl.name} (${wl.count})`;
        opt.selected = wl.id === board.filterListId;
        listGroup.appendChild(opt);
      }
      el.workspaceSelect.appendChild(listGroup);
    }

    // Rename / duplicate / delete live behind the select, so the list stays
    // focused on navigation.
    if (el.workspaceSelect.options.length > 1 || workspaces.length) {
      let actions = el.workspaceSelect.parentElement.querySelector('.ws-actions');
      if (!actions) {
        actions = document.createElement('div');
        actions.className = 'ws-actions';
        actions.innerHTML = `
          <button class="btn btn--ghost" data-act="rename" title="${escape(t('ws.renameHint'))}">${escape(t('ws.rename'))}</button>
          <button class="btn btn--ghost" data-act="duplicate" title="${escape(t('ws.copyHint'))}">${escape(t('ws.copy'))}</button>
          <button class="btn btn--ghost" data-act="delete" title="${escape(t('ws.deleteHint'))}">${escape(t('ws.delete'))}</button>
        `;
        el.workspaceSelect.parentElement.appendChild(actions);

        // No `window.prompt` / `window.confirm` here. They are blocked outright
        // in plenty of contexts, and a blocked one returns null instead of
        // throwing — so `if (!name) return;` turned Rename into a button that
        // did nothing, with nothing on screen to explain why. See the same fix
        // in dialogs/watchlist-dialog.js.
        let armedDelete = false;

        actions.addEventListener('click', async (e) => {
          const act = e.target.dataset?.act;
          const id = board.workspace?.id;
          if (!act || !id) return;
          const del = actions.querySelector('[data-act="delete"]');
          try {
            if (act === 'rename') {
              const name = await askText({
                title: t('ws.renameTitle'),
                value: board.workspace.name,
                submitLabel: t('common.save'),
              });
              if (!name) return;
              await api.patchWorkspace(id, { name });
              await board.loadWorkspace(await api.workspace(id));
            } else if (act === 'duplicate') {
              const copy = await fetch(`/api/workspaces/${id}/duplicate`, { method: 'POST' });
              const ws = await copy.json();
              await board.loadWorkspace(ws);
            } else if (act === 'delete') {
              // Two clicks rather than a confirmation dialog: deleting a board
              // is not recoverable, and arming is explicit without depending on
              // a dialog that may not be able to open.
              if (!armedDelete) {
                armedDelete = true;
                del.textContent = t('ws.confirmDelete');
                del.classList.add('is-armed');
                setTimeout(() => {
                  armedDelete = false;
                  del.textContent = t('ws.delete');
                  del.classList.remove('is-armed');
                }, 4000);
                return;
              }
              await api.deleteWorkspace(id);
              const { workspaces } = await api.workspaces();
              const next = workspaces[0];
              if (!next) {
                const seeded = await api.saveWorkspace({ name: 'My board', charts: [], settings: board.meta.defaultSettings });
                await board.loadWorkspace(seeded);
              } else {
                await board.loadWorkspace(await api.workspace(next.id));
              }
              toast(t('ws.deleted'), { type: 'info' });
            }
            await refreshWorkspaceList(board);
          } catch (err) {
            toast(err.message, { type: 'error' });
          }
        });
      }
    }
  } catch (err) {
    console.warn('[boot] workspace list failed', err);
  }
}

boot().catch((err) => {
  console.error(err);
  document.body.insertAdjacentHTML('afterbegin', `
    <div class="fatal">
      <h2>${escape(t('err.bootTitle'))}</h2>
      <p>${escape(err.message)}</p>
      <p class="section__hint">${t('err.bootBody')}</p>
    </div>
  `);
});