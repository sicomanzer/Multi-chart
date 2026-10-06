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
import { toast, escape } from './ui.js';
import { openIndicatorPicker } from './dialogs/indicator-dialog.js';

const LOCAL_KEY = 'mctd:last-workspace';

/**
 * Zoom step. One click multiplies every chart's bar spacing by this, so "in"
 * means fewer, wider bars — the same feel as TradingView's wheel zoom, but
 * applied to the whole board at once.
 */
const ZOOM_IN = 1.25;
const ZOOM_OUT = 1 / ZOOM_IN;

const el = {
  grid: document.getElementById('grid'),
  empty: document.getElementById('emptyState'),
  timeframeBar: document.getElementById('timeframeBar'),
  addChartBtn: document.getElementById('addChartBtn'),
  emptyAddBtn: document.getElementById('emptyAddBtn'),
  addIndicatorBtn: document.getElementById('addIndicatorBtn'),
  settingsBtn: document.getElementById('settingsBtn'),
  fitBtn: document.getElementById('fitBtn'),
  zoomInBtn: document.getElementById('zoomInBtn'),
  zoomOutBtn: document.getElementById('zoomOutBtn'),
  zoomResetBtn: document.getElementById('zoomResetBtn'),
  mcpBtn: document.getElementById('mcpBtn'),
  themeBtn: document.getElementById('themeBtn'),
  saveBtn: document.getElementById('saveBtn'),
  workspaceSelect: document.getElementById('workspaceSelect'),
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

  const catalog = Object.fromEntries(catalogRes.indicators.map((i) => [i.type, i]));
  const metricCatalog = metricsRes.metrics ?? [];
  const board = new Board({
    gridEl: el.grid,
    meta,
    catalog,
    groups: catalogRes.groups,
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

  el.addChartBtn.addEventListener('click', () => board.openAddChart());
  el.emptyAddBtn.addEventListener('click', () => board.openAddChart());
  el.settingsBtn.addEventListener('click', () => board.openSettings());
  el.mcpBtn.addEventListener('click', () => board.openMcp());

  el.fitBtn.addEventListener('click', () => {
    board.workspace.settings.layoutFit = 'auto';
    const result = board.applyLayout();
    board.commit();
    toast(result?.fits
      ? `Fitted ${result.charts} charts in ${result.cols} × ${result.rows}`
      : `${result?.charts ?? board.tiles.size} charts will not fit legibly — scrolling instead`, {
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
    toast('Zoom reset to the full range', { type: 'info', timeout: 1800 });
  });

  el.addIndicatorBtn.addEventListener('click', () => {
    openIndicatorPicker({
      catalog: board.catalog,
      groups: board.groups,
      current: [],
      onAdd: (type) => board.addIndicatorToAll(type),
    });
  });

  el.themeBtn.addEventListener('click', () => {
    const next = board.workspace.settings.theme === 'dark' ? 'light' : 'dark';
    board.workspace.settings.theme = next;
    board.applyTheme(next);
    board.commit();
  });

  el.saveBtn.addEventListener('click', async () => {
    await board.flushSave({ force: true });
    toast('Board saved', { type: 'success', timeout: 2000 });
    await refreshWorkspaceList(board);
  });

  el.workspaceSelect.addEventListener('change', async () => {
    const id = el.workspaceSelect.value;
    if (!id || id === board.workspace.id) return;
    try {
      const ws = await api.workspace(id);
      await board.loadWorkspace(ws);
      markTimeframe(ws.settings.defaultTimeframe);
      await refreshWorkspaceList(board);
    } catch (err) {
      toast(`Could not open board: ${err.message}`, { type: 'error' });
    }
  });
}

function wireBoardEvents(board) {
  board.addEventListener('workspace', (e) => {
    const ws = e.detail;
    el.workspaceName.textContent = `${ws.name} · ${ws.charts.length} chart${ws.charts.length === 1 ? '' : 's'}`;
    el.empty.hidden = ws.charts.length > 0;
    markTimeframe(ws.settings.defaultTimeframe);
  });

  board.addEventListener('stats', (e) => {
    const { charts, indicators, symbols } = e.detail;
    el.statCharts.textContent = `${charts} chart${charts === 1 ? '' : 's'}`;
    el.statIndicators.textContent = `${indicators} indicator${indicators === 1 ? '' : 's'} · ${symbols} symbol${symbols === 1 ? '' : 's'}`;
    el.empty.hidden = charts > 0;
  });

  board.addEventListener('quotes', (e) => {
    const ts = e.detail?.ts;
    if (!ts) return;
    const secs = Math.max(0, Math.round((Date.now() - ts) / 1000));
    el.statLastTick.textContent = `quotes: ${secs < 2 ? 'just now' : `${secs}s ago`}`;
  });

  board.addEventListener('status', () => updateStatusPill(board));
board.addEventListener('reidentified', (e) => {
    localStorage.setItem(LOCAL_KEY, e.detail);
    refreshWorkspaceList(board);
  });

  board.addEventListener('conflict', async (e) => {
    toast('This board was changed in another tab or by the CLI — reloading it', {
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
      el.statLayout.textContent = `${board.workspace.settings.columns} columns · scrolling`;
      return;
    }
    el.statLayout.textContent = r.fits
      ? `fit: ${r.cols} × ${r.rows} · ${Math.round(r.tileW)}×${Math.round(r.tileH)}px`
      : `${r.charts ?? board.tiles.size} charts · too many to fit, scrolling`;
  });

  board.addEventListener('stream', (e) => updateStatusPill(board, null, e.detail));
  board.addEventListener('change', () => {
    el.statSaved.textContent = 'saving…';
  });
  board.addEventListener('saved', () => {
    el.statSaved.textContent = `saved ${new Date().toLocaleTimeString()}`;
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
      ? `mcp · ${health.mcp.ping.ms}ms`
      : 'mcp ready';
    el.statusPill.classList.remove('is-error');
  } else {
    label.textContent = mcp.lastError ? `mcp offline` : 'connecting…';
    el.statusPill.classList.toggle('is-error', Boolean(mcp.lastError));
    el.statusPill.title = mcp.lastError ?? 'waiting for the MCP server';
  }
}

async function refreshWorkspaceList(board) {
  try {
    const { workspaces } = await api.workspaces();
    el.workspaceSelect.innerHTML = '';
    for (const ws of workspaces) {
      const opt = document.createElement('option');
      opt.value = ws.id;
      opt.textContent = `${ws.name} (${ws.chartCount})`;
      opt.selected = ws.id === board.workspace?.id;
      el.workspaceSelect.appendChild(opt);
    }

    // Rename / duplicate / delete live behind the select, so the list stays
    // focused on navigation.
    if (el.workspaceSelect.options.length > 1 || workspaces.length) {
      let actions = el.workspaceSelect.parentElement.querySelector('.ws-actions');
      if (!actions) {
        actions = document.createElement('div');
        actions.className = 'ws-actions';
        actions.innerHTML = `
          <button class="btn btn--ghost" data-act="rename" title="Rename this board">Rename</button>
          <button class="btn btn--ghost" data-act="duplicate" title="Duplicate this board">Copy</button>
          <button class="btn btn--ghost" data-act="delete" title="Delete this board">Delete</button>
        `;
        el.workspaceSelect.parentElement.appendChild(actions);

        actions.addEventListener('click', async (e) => {
          const act = e.target.dataset?.act;
          const id = board.workspace?.id;
          if (!act || !id) return;
          try {
            if (act === 'rename') {
              const name = prompt('Board name', board.workspace.name);
              if (!name) return;
              await api.patchWorkspace(id, { name });
              await board.loadWorkspace(await api.workspace(id));
            } else if (act === 'duplicate') {
              const copy = await fetch(`/api/workspaces/${id}/duplicate`, { method: 'POST' });
              const ws = await copy.json();
              await board.loadWorkspace(ws);
            } else if (act === 'delete') {
              if (!confirm(`Delete board "${board.workspace.name}"?`)) return;
              await api.deleteWorkspace(id);
              const { workspaces } = await api.workspaces();
              const next = workspaces[0];
              if (!next) {
                const seeded = await api.saveWorkspace({ name: 'My board', charts: [], settings: board.meta.defaultSettings });
                await board.loadWorkspace(seeded);
              } else {
                await board.loadWorkspace(await api.workspace(next.id));
              }
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
      <h2>Could not start the desk</h2>
      <p>${escape(err.message)}</p>
      <p class="section__hint">Check that the API is running on the same origin and that
      <code>tradingview-mcp-server</code> is installed for your Python.</p>
    </div>
  `);
});