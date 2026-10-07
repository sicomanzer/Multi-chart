/**
 * Board: the multi-chart desk.
 *
 * Owns the workspace model (charts + indicators + global settings), the tile
 * lifecycle, data loading, the live quote subscription, cross-chart syncing and
 * persistence. Everything user-facing routes through here, so the UI modules
 * stay dumb renderers.
 *
 * Data flow:
 *   workspace -> tiles -> POST /api/candles (batched per timeframe)
 *   SSE /api/stream -> quotes -> tile.setQuote -> in-place last-bar update
 *   edits -> workspace -> (debounced) POST /api/workspaces
 */
import { api } from './api.js';
import { ChartTile } from './chart-tile.js';
import { QuoteStream } from './stream.js';
import { modal, section, escape, toast, selectField, checkbox } from './ui.js';
import {
  openIndicatorPicker, openIndicatorEditor, openBoardIndicatorPicker,
} from './dialogs/indicator-dialog.js';
import { openChartSettings } from './dialogs/chart-dialog.js';
import { openBoardSettings } from './dialogs/board-settings-dialog.js';
import { openMcpConsole } from './dialogs/mcp-console.js';

const AUTOSAVE_MS = 900;
const LOCAL_KEY = 'mctd:last-workspace';

/** Must match the board's padding/gap in app.css, or the fit maths drifts. */
const GRID_GAP = 8;
const GRID_PAD = 8;
const MIN_TILE_W = 240;
const MIN_TILE_H = 150;
/** Width-to-height a chart reads best at: a little wider than tall. */
const TARGET_ASPECT = 1.45;

/**
 * Do two indicator instances carry the same settings?
 *
 * Key order must not matter — the catalog's defaults are built as an object, so
 * two instances built the same way can serialise in a different order. Numbers
 * are compared as numbers so `14` from a number input and `14` loaded from JSON
 * are not treated as different.
 */
function sameParams(a, b) {
  const ka = Object.keys(a ?? {}).sort();
  const kb = Object.keys(b ?? {}).sort();
  if (ka.length !== kb.length || ka.some((k, i) => k !== kb[i])) return false;
  return ka.every((k) => {
    const va = a[k];
    const vb = b[k];
    if (typeof va === 'number' || typeof vb === 'number') return Number(va) === Number(vb);
    return va === vb;
  });
}

export class Board extends EventTarget {
  constructor({ gridEl, meta, catalog, groups, metricLabels, metricCatalog }) {
    super();
    this.gridEl = gridEl;
    this.meta = meta;
    this.catalog = catalog;      // type -> definition
    this.groups = groups;        // ordered group names
    this.metricLabels = metricLabels ?? {}; // fundamentals: key -> { label, hint }
    this.metricCatalog = metricCatalog ?? [];

    this.workspace = null;
    this.tiles = new Map();      // chartId -> ChartTile
    this.mcpStatus = null;
    this.focusedId = null;
    this.syncing = false;        // guards crosshair / time-scale echo loops
    this.saveTimer = null;
    this.dirty = false;          // unsaved local edits pending an autosave
    this.symbolSearch = '';

    this.stream = new QuoteStream({
      onQuotes: (payload) => this._onQuotes(payload),
      onStatus: (status) => {
        // The SSE `hello` frame wraps the connection info; later `status`
        // frames are the bare MCP status.
        this.mcpStatus = status?.mcp ?? status;
        this.dispatchEvent(new CustomEvent('status', { detail: this.mcpStatus }));
      },
    });
    this.stream.addEventListener('open', () => this.dispatchEvent(new CustomEvent('stream', { detail: { connected: true } })));
    this.stream.addEventListener('error', () => this.dispatchEvent(new CustomEvent('stream', { detail: { connected: false } })));
  }

  // ── Workspace lifecycle ────────────────────────────────────────────────────

  async loadWorkspace(ws, { persist = true } = {}) {
    // Persist pending edits of the board we are leaving, but only if there are
    // any — and never overwrite a revision the server has moved past.
    await this.flushSave();
    this.dirty = false;
    this.teardownTiles();

    this.workspace = ws;
    this.applyTheme(ws.settings.theme);
    this.render();

    if (persist) localStorage.setItem(LOCAL_KEY, ws.id);
    await this.loadAllCandles();
    this.stream.start();
    this.resubscribe();
    // Fundamentals are a slow-moving extra: one request, cached server-side.
    this.refreshFundamentals().catch(() => {});

    this.dispatchEvent(new CustomEvent('workspace', { detail: ws }));
  }

  snapshot() {
    if (!this.workspace) return null;
    return {
      ...this.workspace,
      // The revision this client started from. The server rejects the write if
      // something else has saved since, which is what stops an idle tab from
      // clobbering edits made elsewhere.
      baseRevision: this.workspace.revision ?? null,
      settings: { ...this.workspace.settings },
      charts: [...this.tiles.values()].map((t) => t.snapshot()),
      updatedAt: Date.now(),
    };
  }

  /** Rebuild the in-memory workspace from the live tiles (catches stray edits). */
  commit({ persist = true } = {}) {
    const next = this.snapshot();
    if (!next) return;
    // Keep the revision we loaded; the server bumps it when the write lands.
    this.workspace = { ...next, revision: this.workspace.revision ?? 0 };
    if (persist) {
      this.dirty = true;
      this.scheduleSave();
    }
    this.dispatchEvent(new CustomEvent('change', { detail: this.workspace }));
  }

  scheduleSave() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.flushSave(), AUTOSAVE_MS);
  }

  async flushSave({ force = false } = {}) {
    clearTimeout(this.saveTimer);
    this.saveTimer = null;
    // Nothing pending: staying silent here matters. Saving unconditionally on
    // unload is what used to clobber edits made from another tab or the CLI.
    if (!this.dirty && !force) return;

    const ws = this.snapshot();
    if (!ws) return;
    try {
      const saved = await api.saveWorkspace(ws, { keepalive: this.unloading });
      // The server mints a new id when the board we were editing no longer
      // exists there; adopt it so the next save updates the same board.
      if (saved?.id && saved.id !== this.workspace.id) {
        this.workspace.id = saved.id;
        this.dispatchEvent(new CustomEvent('reidentified', { detail: saved.id }));
      }
      if (Number.isFinite(saved?.revision)) this.workspace.revision = saved.revision;
      this.dirty = false;
      this.dispatchEvent(new CustomEvent('saved', { detail: saved ?? ws }));
    } catch (err) {
      if (err.code === 'REVISION_CONFLICT') {
        // The board changed underneath us (another tab, or the CLI). Reload the
        // server's copy instead of silently overwriting someone's work.
        this.dirty = false;
        this.dispatchEvent(new CustomEvent('conflict', { detail: err.current }));
        return;
      }
      console.warn('[board] autosave failed', err);
      toast(`Could not save layout: ${err.message}`, { type: 'error' });
    }
  }

  // ── Tiles ──────────────────────────────────────────────────────────────────

  /** Build one tile for a chart config and append it to the grid. */
  _mountTile(config) {
    const host = document.createElement('section');
    host.className = 'tile-host';
    this.gridEl.appendChild(host);

    const tile = new ChartTile(host, {
      ...config,
      settings: this.workspace.settings,
    }, this.catalog, {
      getTheme: () => this.workspace.settings.theme,
      metricLabels: this.metricLabels,
      onAddIndicator: (t) => this.addIndicator(t),
      onEditChart: (t) => this.editChart(t),
      onFocus: (t) => this.toggleFocus(t),
      onRemove: (t) => this.removeChart(t),
      onEditIndicator: (t, id) => this.editIndicator(t, id),
      onCrosshair: (t, param) => this._onCrosshair(t, param),
      onTimeClick: (t, time) => this._onTimeClick(t, time),
    });

    this.tiles.set(config.id, tile);
    return tile;
  }

  render() {
    this.gridEl.innerHTML = '';
    this.tiles.clear();

    for (const config of this.workspace.charts) this._mountTile(config);

    this.gridEl.classList.toggle('is-empty', this.tiles.size === 0);
    this.updateFooterStats();
    this.linkTimeScales();
    this.applyLayout();
  }

  teardownTiles() {
    for (const tile of this.tiles.values()) tile.destroy();
    this.tiles.clear();
  }

  chartConfig(chartId) {
    return this.workspace.charts.find((c) => c.id === chartId) ?? null;
  }

  // ── Data ───────────────────────────────────────────────────────────────────

  async loadAllCandles() {
    const configs = [...this.tiles.values()].map((t) => t.config);
    if (!configs.length) return;

    // Group by timeframe so one POST covers every chart sharing it.
    const byTimeframe = new Map();
    for (const c of configs) {
      if (!byTimeframe.has(c.timeframe)) byTimeframe.set(c.timeframe, []);
      byTimeframe.get(c.timeframe).push(c);
    }

    for (const tile of this.tiles.values()) tile.setLoading(true);

    const jobs = [...byTimeframe.entries()].map(async ([timeframe, group]) => {
      const symbols = [...new Set(group.map((c) => c.symbol))];
      try {
        const data = await api.candlesBatch(symbols, timeframe);
        for (const c of group) {
          const tile = this.tiles.get(c.id);
          const payload = data[c.symbol];
          if (!tile) continue;
          if (payload?.error) {
            tile.setError(`${c.symbol}: ${payload.error}`);
          } else {
            tile.setBars(payload);
          }
        }
      } catch (err) {
        for (const c of group) this.tiles.get(c.id)?.setError(err.message);
      }
    });

    await Promise.all(jobs);
    for (const tile of this.tiles.values()) tile.setLoading(false);
  }

  async loadCandleFor(tile) {
    tile.setLoading(true);
    tile.setError('');
    try {
      const payload = await api.candles(tile.config.symbol, tile.config.timeframe);
      tile.setBars(payload);
    } catch (err) {
      tile.setError(`${tile.config.symbol}: ${err.message}`);
    } finally {
      tile.setLoading(false);
    }
  }

  /** Refresh only the intraday tiles — daily+ bars barely move intraday. */
  async refreshIntraday() {
    const intraday = ['1m', '5m', '15m', '30m', '1h', '4h'];
    const jobs = [...this.tiles.values()]
      .filter((t) => intraday.includes(t.config.timeframe))
      .map((t) => this.loadCandleFor(t).catch(() => {}));
    if (jobs.length) await Promise.all(jobs);
  }

  /**
   * Pull fundamentals for every symbol on the board and hand them to the tiles.
   *
   * One request for the whole board, deduped by symbol, and the server caches
   * for 30 minutes — so switching boards or adding a chart costs nothing. A
   * failure here is non-fatal: the strip says so and the board carries on.
   */
  async refreshFundamentals({ refresh = false } = {}) {
    const symbols = [...new Set([...this.tiles.values()].map((t) => t.config.symbol))];
    if (symbols.length === 0) return null;
    if ((this.config?.settings ?? this.workspace?.settings)?.footerMode === 'indicators') return null;

    for (const tile of this.tiles.values()) tile.setFundamentals(null, { pending: true });

    let result;
    try {
      result = await api.fundamentals(symbols, {
        metrics: this.workspace.settings.footerMetrics,
        refresh,
      });
    } catch (err) {
      for (const tile of this.tiles.values()) tile.setFundamentals(null, { pending: false });
      this.dispatchEvent(new CustomEvent('fundamentals', { detail: { error: err.message } }));
      return null;
    }

    for (const tile of this.tiles.values()) {
      tile.setFundamentals(result.data?.[tile.config.symbol] ?? null, { pending: false });
    }
    this.dispatchEvent(new CustomEvent('fundamentals', { detail: result }));
    return result;
  }

  // ── Live quotes ────────────────────────────────────────────────────────────

  resubscribe() {
    if (!this.workspace?.settings.liveQuotes) {
      this.stream.subscribe([], 60_000);
      return;
    }
    const symbols = [...new Set([...this.tiles.values()].map((t) => t.config.symbol))];
    this.stream.subscribe(symbols, Math.max(3, this.workspace.settings.pollSeconds) * 1000);
  }

  _onQuotes(payload) {
    // Per-tile isolation: one chart throwing must not stop the rest of the
    // board from updating.
    for (const [symbol, quote] of Object.entries(payload.quotes ?? {})) {
      for (const tile of this.tiles.values()) {
        if (tile.config.symbol !== symbol) continue;
        try {
          tile.setQuote(quote);
        } catch (err) {
          console.warn(`[board] ${symbol} quote render failed`, err);
        }
      }
    }
    for (const err of payload.errors ?? []) {
      if (err.symbol === this.symbolSearch) return;
      console.warn('[board] quote issue', err);
    }
    this.dispatchEvent(new CustomEvent('quotes', { detail: payload }));
  }

  // ── Chart mutations ────────────────────────────────────────────────────────

  addChart({ symbol, timeframe, indicators = [] } = {}) {
    const id = `ch_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
    const settings = this.workspace.settings;
    const config = {
      id,
      symbol: symbol ?? this.defaultSymbol(),
      timeframe: timeframe ?? settings.defaultTimeframe,
      chartType: settings.candleStyle,
      logScale: false,
      autoscale: true,
      priceLines: [],
      indicators,
    };
    this.workspace.charts.push(config);
    // Mount only the new chart: re-rendering the whole grid would blank every
    // other tile's candles until they were refetched.
    const tile = this._mountTile(config);
    this.gridEl.classList.toggle('is-empty', this.tiles.size === 0);
    this.updateFooterStats();
    this.applyLayout();
    this.loadCandleFor(tile);
    this.refreshFundamentals().catch(() => {});
    this.resubscribe();
    this.commit();
    return id;
  }

  removeChart(tile) {
    this.workspace.charts = this.workspace.charts.filter((c) => c.id !== tile.config.id);
    if (this.focusedId === tile.config.id) this.focusedId = null;
    tile.destroy();
    this.tiles.delete(tile.config.id);
    this.gridEl.classList.toggle('is-empty', this.tiles.size === 0);
    this.applyLayout();
    this.resubscribe();
    this.commit();
  }

  /** Global timeframe switch across every tile. */
  setTimeframeAll(timeframe) {
    // `workspace.charts` is the source of truth `render()` rebuilds tiles from,
    // so the switch has to happen there — not only on the live tile objects.
    for (const config of this.workspace.charts) config.timeframe = timeframe;
    this.workspace.settings.defaultTimeframe = timeframe;
    this.render();
    this.loadAllCandles();
    this.commit();
  }

  /**
   * Update one chart in both places it lives.
   *
   * `workspace.charts` is what `render()` rebuilds tiles from, while the tile
   * holds the live copy. Editing only one of them loses the change the next time
   * the board re-renders, so every mutation goes through here.
   */
  patchChart(chartId, patch) {
    const config = this.chartConfig(chartId);
    const tile = this.tiles.get(chartId);
    if (config) Object.assign(config, patch);
    if (tile) {
      // A different instrument or timeframe is a different chart: give it the
      // default full-range view again.
      if (patch.symbol || patch.timeframe) tile.zoomSpacing = null;
      Object.assign(tile.config, patch);
      tile.render();
    }
    if (patch.symbol) this.resubscribe();
    this.commit();
  }

  // ── Zoom every chart at once ──────────────────────────────────────────────

  /**
   * Zoom the whole board. `factor` > 1 means "in" (fewer, wider bars).
   *
   * Every tile gets the same *ratio*, not the same absolute spacing: a chart
   * showing 40 bars and one showing 400 both step by 25%, so the board stays
   * visually consistent without flattening the detail views. `min` matches the
   * chart's own `minBarSpacing`, otherwise a click would report success while
   * the library silently clamped it.
   */
  zoomAll(factor) {
    const MIN = 0.5;
    const MAX = 80;
    let moved = 0;
    for (const tile of this.tiles.values()) {
      if (tile.zoom(factor, { min: MIN, max: MAX })) moved += 1;
    }
    this.dispatchEvent(new CustomEvent('zoom', { detail: { factor, moved } }));
    return moved;
  }

  /** Drop every chart back to its full loaded range. */
  fitAll() {
    for (const tile of this.tiles.values()) tile.fitContent();
    this.dispatchEvent(new CustomEvent('zoom', { detail: { factor: null, moved: this.tiles.size } }));
  }

  updateChartConfig(chartId, patch) {
    if (!this.chartConfig(chartId)) return;
    this.patchChart(chartId, patch);
  }

  toggleFocus(tile) {
    const host = tile.host;
    if (this.focusedId === tile.config.id) {
      this.focusedId = null;
      host.classList.remove('is-focused');
      this.gridEl.classList.remove('has-focus');
    } else {
      for (const other of this.tiles.values()) other.host.classList.remove('is-focused');
      this.focusedId = tile.config.id;
      host.classList.add('is-focused');
      this.gridEl.classList.add('has-focus');
    }
    this.dispatchEvent(new CustomEvent('focus', { detail: { chartId: this.focusedId } }));
  }

  // ── Indicators ─────────────────────────────────────────────────────────────

  addIndicator(tile) {
    openIndicatorPicker({
      catalog: this.catalog,
      groups: this.groups,
      current: tile.config.indicators,
      onAdd: (type) => {
        const def = this.catalog[type];
        const instance = {
          id: `ind_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 4)}`,
          type,
          enabled: true,
          placement: def.placement,
          params: Object.fromEntries(def.params.map((p) => [p.id, p.default])),
          paneHeight: def.defaultPaneHeight ?? 110,
        };
        this.patchChart(tile.config.id, {
          indicators: [...tile.config.indicators, instance],
        });
      },
    });
  }

  editIndicator(tile, indicatorId) {
    const instance = tile.config.indicators.find((i) => i.id === indicatorId);
    if (!instance) return;

    const replace = (next) => this.patchChart(tile.config.id, { indicators: next });

    openIndicatorEditor({
      catalog: this.catalog,
      instance,
      onSave: (patch) => {
        Object.assign(instance, patch);
        replace([...tile.config.indicators]);
      },
      onDelete: () => {
        replace(tile.config.indicators.filter((i) => i.id !== indicatorId));
      },
      onToggle: () => {
        instance.enabled = instance.enabled === false;
        replace([...tile.config.indicators]);
      },
    });
  }

  /** Apply an indicator to every chart at once (board-wide "add to all"). */
  async addIndicatorToAll(type) {
    const def = this.catalog[type];
    for (const tile of this.tiles.values()) {
      const instance = {
        id: `ind_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 4)}_${tile.config.id.slice(-3)}`,
        type,
        enabled: true,
        placement: def.placement,
        params: Object.fromEntries(def.params.map((p) => [p.id, p.default])),
        paneHeight: def.defaultPaneHeight ?? 110,
      };
      this.patchChart(tile.config.id, { indicators: [...tile.config.indicators, instance] });
    }
    toast(`${def.name} added to ${this.tiles.size} chart${this.tiles.size === 1 ? '' : 's'}`);
  }

  /**
   * Every indicator type on the board, with how many charts carry it.
   *
   * `differing` counts the charts whose parameters do not match the first
   * instance's, which is what a board-wide edit would overwrite.
   */
  indicatorUsage() {
    const byType = new Map();
    for (const tile of this.tiles.values()) {
      for (const instance of tile.config.indicators ?? []) {
        const entry = byType.get(instance.type) ?? { type: instance.type, charts: 0, differing: 0, first: instance };
        entry.charts += 1;
        if (entry.first !== instance && !sameParams(entry.first.params, instance.params)) entry.differing += 1;
        byType.set(instance.type, entry);
      }
    }
    // Most widely used first: on a board where every chart has RSI, that is the
    // one people want.
    return [...byType.values()].sort((a, b) => b.charts - a.charts || a.type.localeCompare(b.type));
  }

  /** Toolbar entry point: pick an indicator, then edit it everywhere at once. */
  openBoardIndicatorEditor() {
    openBoardIndicatorPicker({
      catalog: this.catalog,
      usage: this.indicatorUsage(),
      totalCharts: this.tiles.size,
      onPick: (type) => this.editIndicatorOnAll(type),
    });
  }

  /**
   * Edit one indicator type across every chart that has it.
   *
   * Charts without the indicator are left alone — this changes settings, it does
   * not add studies. Use "ƒx All" for that.
   */
  editIndicatorOnAll(type) {
    const targets = [];
    for (const tile of this.tiles.values()) {
      const instance = (tile.config.indicators ?? []).find((i) => i.type === type);
      if (instance) targets.push({ tile, instance });
    }
    if (!targets.length) {
      toast(`No chart on this board has ${this.catalog[type]?.name ?? type}`, { type: 'info' });
      return;
    }

    const template = targets[0].instance;
    const differing = targets.filter(({ instance }) => !sameParams(template.params, instance.params)).length;
    const missing = this.tiles.size - targets.length;

    const writeAll = (mutate) => {
      for (const { tile, instance } of targets) {
        mutate(instance);
        this.patchChart(tile.config.id, { indicators: [...tile.config.indicators] });
      }
    };

    openIndicatorEditor({
      catalog: this.catalog,
      instance: template,
      scope: { charts: targets.length, differing },
      onSave: (patch) => {
        writeAll((instance) => Object.assign(instance, patch));
        const tail = missing ? ` · ${missing} chart${missing === 1 ? '' : 's'} without it left alone` : '';
        toast(`${this.catalog[type]?.name ?? type} updated on ${targets.length} chart${targets.length === 1 ? '' : 's'}${tail}`);
      },
      onDelete: () => {
        for (const { tile } of targets) {
          const kept = (tile.config.indicators ?? []).filter((i) => i.type !== type);
          this.patchChart(tile.config.id, { indicators: kept });
        }
        toast(`${this.catalog[type]?.name ?? type} removed from ${targets.length} chart${targets.length === 1 ? '' : 's'}`);
      },
      onToggle: () => {
        const enable = template.enabled === false;
        writeAll((instance) => { instance.enabled = enable; });
        toast(`${this.catalog[type]?.name ?? type} ${enable ? 'enabled' : 'disabled'} on ${targets.length} chart${targets.length === 1 ? '' : 's'}`);
      },
    });
  }

  // ── Dialogs ────────────────────────────────────────────────────────────────

  editChart(tile) {
    openChartSettings({
      // A shallow copy: the dialog compares its `config` snapshot against the
      // edited values to decide whether a data reload is needed, so handing it
      // the live object would make that comparison always false.
      config: { ...tile.config, indicators: tile.config.indicators },
      meta: this.meta,
      catalog: this.catalog,
      indicators: tile.config.indicators,
      onChange: (next) => this.patchChart(tile.config.id, next),
      onLoad: () => this.loadCandleFor(tile),
      onEditIndicator: (id) => this.editIndicator(tile, id),
    });
  }

  openSettings() {
    openBoardSettings({
      settings: this.workspace.settings,
      meta: this.meta,
      mcpStatus: this.mcpStatus,
      metricCatalog: this.metricCatalog ?? [],
      onRefreshRatios: () => this.refreshFundamentals({ refresh: true }),
      onSave: (settings) => {
        const previous = this.workspace.settings;
        const metricsChanged = (previous.footerMetrics ?? []).join(',') !== (settings.footerMetrics ?? []).join(',');
        const modeChanged = previous.footerMode !== settings.footerMode;
        this.workspace.settings = settings;
        if (previous.theme !== settings.theme) this.applyTheme(settings.theme);
        if (settings.layoutFit === 'fixed' && previous.columns !== settings.columns) {
          this.setColumns(settings.columns);
        }
        // Columns only matter in fixed mode; auto mode sizes the grid itself.
        if (previous.layoutFit !== settings.layoutFit) {
          if (settings.layoutFit === 'auto') this.applyLayout();
          else {
            this.gridEl.classList.remove('is-fit');
            this.gridEl.style.removeProperty('--row-h');
            this.setColumns(settings.columns);
          }
        }
        this.render();
        this.loadAllCandles();
        this.resubscribe();
        this.commit();
        // A different metric selection needs a different upstream query; the
        // server cache is keyed by symbol, so ask with the new list.
        if (metricsChanged || (modeChanged && settings.footerMode !== 'indicators')) {
          this.refreshFundamentals().catch(() => {});
        }
      },
    });
  }

  openMcp() {
    const focused = this.focusedId ? this.chartConfig(this.focusedId) : null;
    openMcpConsole({ symbol: focused?.symbol ?? this.defaultSymbol() });
  }

  openAddChart() {
    // Controls are hoisted into the closure so both the body (search results)
    // and the footer (Create) can reach them.
    const input = document.createElement('input');
    input.className = 'input';
    input.placeholder = 'CPF, SET:CPF, NASDAQ:AAPL…';
    input.spellcheck = false;

    const tfField = selectField('Timeframe', this.workspace.settings.defaultTimeframe,
      this.meta.timeframes.map((t) => ({ value: t.id, label: t.id })), () => {});

    const rsiField = checkbox('RSI(14) in its own pane', true, () => {});
    let resolved = '';

    modal({
      title: 'New chart',
      subtitle: 'Add a symbol to the board.',
      size: 'md',
      // Arrow functions: a method shorthand would rebind `this` to the options
      // object instead of the Board.
      render: (body) => {
        body.appendChild(section('Symbol'));
        const row = document.createElement('div');
        row.className = 'row';
        const searchBtn = document.createElement('button');
        searchBtn.className = 'btn';
        searchBtn.textContent = 'Search SET';
        row.append(input, searchBtn);

        const results = document.createElement('div');
        results.className = 'symbol-results';

        body.append(row, results);
        body.appendChild(section('Timeframe'));
        body.appendChild(tfField);
        body.appendChild(section('Start with'));
        body.appendChild(rsiField);

        body.appendChild(section('Recent on this board'));
        const recentHost = document.createElement('div');
        recentHost.className = 'chip-row';
        const recent = [...this.tiles.values()].map((t) => t.config.symbol);
        for (const sym of recent.slice(0, 30)) {
          const chip = document.createElement('button');
          chip.className = 'chip';
          chip.type = 'button';
          chip.textContent = sym.split(':')[1];
          chip.title = sym;
          chip.addEventListener('click', () => { input.value = sym; resolved = sym; });
          recentHost.appendChild(chip);
        }
        if (!recent.length) recentHost.innerHTML = '<p class="section__hint">Nothing on the board yet.</p>';
        body.appendChild(recentHost);

        const runSearch = async () => {
          results.innerHTML = '<p class="section__hint">Searching…</p>';
          try {
            const data = await api.symbols(input.value || '', 'thailand', 30);
            results.innerHTML = '';
            if (!data.results.length) {
              results.innerHTML = `<p class="section__hint">No screener match. Typing <code>${escape(input.value || 'CPF')}</code> directly still works.</p>`;
              return;
            }
            for (const hit of data.results) {
              const btn = document.createElement('button');
              btn.type = 'button';
              btn.className = 'symbol-row';
              btn.innerHTML = `<b>${escape(hit.display)}</b><span>${escape(hit.name)}</span>
                <em>${hit.price ?? '—'}</em>
                <i class="${(hit.changePercent ?? 0) >= 0 ? 'is-up' : 'is-down'}">${hit.changePercent == null ? '' : `${hit.changePercent >= 0 ? '+' : ''}${hit.changePercent.toFixed(2)}%`}</i>`;
              btn.addEventListener('click', () => {
                input.value = hit.symbol;
                resolved = hit.symbol;
                results.innerHTML = '';
              });
              results.appendChild(btn);
            }
          } catch (err) {
            results.innerHTML = `<p class="section__hint is-error">${escape(err.message)}</p>`;
          }
        };

        searchBtn.addEventListener('click', runSearch);
        input.addEventListener('input', () => { resolved = input.value.trim(); });
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') runSearch(); });
      },
      footer: (foot, { close }) => {
        foot.innerHTML = `
          <span class="section__hint">Exchanges: ${escape((this.meta.exchanges ?? []).slice(0, 6).join(', '))}…</span>
          <span class="spacer"></span>
          <button class="btn" data-close>Cancel</button>
          <button class="btn btn--primary" data-act="create">Add chart</button>
        `;
        foot.querySelector('[data-act="create"]').addEventListener('click', () => {
          const raw = (resolved || input.value).trim();
          if (!raw) {
            toast('Type a ticker first', { type: 'error' });
            return;
          }
          const timeframe = tfField.querySelector('select').value;
          const indicators = rsiField.querySelector('input').checked
            ? [{
              id: `ind_${Date.now().toString(36)}`,
              type: 'rsi',
              enabled: true,
              placement: 'pane',
              params: Object.fromEntries(this.catalog.rsi.params.map((p) => [p.id, p.default])),
              paneHeight: 100,
            }]
            : [];
          close();
          this.addChart({ symbol: raw, timeframe, indicators });
        });
      },
    });
  }

  // ── Cross-chart behaviour ──────────────────────────────────────────────────

  /**
   * Mirror a crosshair from one tile to the others.
   *
   * The hovered `seriesData` map belongs to the source chart's series objects,
   * so it cannot be replayed on another chart. Instead each tile resolves the
   * same timestamp against its own bars and parks its crosshair on that bar —
   * which is what "read this timestamp everywhere" is actually worth.
   */
  _onCrosshair(source, param) {
    if (!this.workspace.settings.syncCrosshair || this.syncing) return;
    if (!param?.time) return;

    this.syncing = true;
    try {
      for (const tile of this.tiles.values()) {
        if (tile === source) continue;
        tile.syncCrosshair(param.time);
      }
    } finally {
      this.syncing = false;
    }
  }

  /** Clicking a bar jumps every other chart's crosshair to the same time. */
  _onTimeClick(tile, time) {
    if (!this.workspace.settings.syncCrosshair) return;
    this._onCrosshair(tile, { time });
  }

  /**
   * Optional linked zoom. Handlers are stored per tile and torn down before
   * re-linking, because `render()` rebuilds every tile from scratch.
   */
  linkTimeScales() {
    for (const [id, entry] of this.timeScaleLinks ?? []) {
      try { entry.chart.timeScale().unsubscribeVisibleLogicalRangeChange(entry.handler); } catch { /* gone */ }
    }
    this.timeScaleLinks = [];

    if (!this.workspace?.settings?.syncTimeScale) return;

    const tiles = [...this.tiles.values()];
    if (tiles.length < 2) return;

    for (const tile of tiles) {
      const chart = tile.chart;
      const handler = (range) => {
        if (this.syncing || !range) return;
        this.syncing = true;
        try {
          for (const other of tiles) {
            if (other === tile) continue;
            try { other.chart.timeScale().setVisibleLogicalRange(range); } catch { /* range out of bounds */ }
          }
        } finally {
          this.syncing = false;
        }
      };
      chart.timeScale().subscribeVisibleLogicalRangeChange(handler);
      this.timeScaleLinks.push([tile.config.id, { chart, handler }]);
    }
  }

  // ── Appearance ─────────────────────────────────────────────────────────────

  applyTheme(theme) {
    document.documentElement.dataset.theme = theme === 'light' ? 'light' : 'dark';
    for (const tile of this.tiles.values()) tile.applyTheme(theme);
  }

  setColumns(columns) {
    this.gridEl.style.setProperty('--columns', String(columns));
  }

  /**
   * Size the grid so every chart is visible without scrolling.
   *
   * Picks the column count whose resulting tile is closest to a readable
   * aspect ratio for the space available, then sets an explicit row height so
   * the last row is never clipped. Falls back to scrolling when the charts
   * simply cannot be shown legibly at this viewport size — the caller is told
   * through the returned result so the footer can say so.
   */
  fitToViewport() {
    const count = this.tiles.size;
    if (count === 0) {
      this.gridEl.classList.remove('is-fit');
      return null;
    }

    const gap = GRID_GAP;
    const width = this.gridEl.clientWidth || window.innerWidth;
    const height = this.gridEl.clientHeight || window.innerHeight;

    let best = null;
    for (let cols = 1; cols <= Math.min(8, count); cols += 1) {
      const rows = Math.ceil(count / cols);
      const tileW = (width - 2 * GRID_PAD - (cols - 1) * gap) / cols;
      const tileH = (height - 2 * GRID_PAD - (rows - 1) * gap) / rows;
      if (tileW < MIN_TILE_W || tileH < MIN_TILE_H) continue;

      // Prefer tiles a bit wider than tall, and prefer fewer wasted cells in
      // the final row (5 charts in 4 columns leaves a hole).
      const aspectPenalty = Math.abs(tileW / tileH - TARGET_ASPECT);
      const holePenalty = ((cols * rows) - count) / count * 0.35;
      const smallPenalty = (tileW < 240 ? 0.6 : 0) + (tileH < 190 ? 0.6 : 0);
      const score = aspectPenalty + holePenalty + smallPenalty;
      if (!best || score < best.score) best = { cols, rows, tileW, tileH, score };
    }

    if (!best) {
      // Too many charts for this screen: keep the saved column count and scroll.
      this.gridEl.classList.remove('is-fit');
      this.setColumns(this.workspace.settings.columns);
      return { fits: false, charts: count };
    }

    this.setColumns(best.cols);
    this.gridEl.classList.add('is-fit');
    // Sub-pixel rows: fractional CSS heights make the last row spill under the
    // scrollbar, so round down and leave a pixel of slack.
    this.gridEl.style.setProperty('--row-h', `${Math.floor(best.tileH)}px`);
    this.gridEl.style.setProperty('--columns', String(best.cols));
    return { fits: true, ...best, charts: count };
  }

  /** Recompute the layout now and whenever the window changes size. */
  applyLayout() {
    let result;
    if (this.workspace?.settings?.layoutFit === 'auto') {
      result = this.fitToViewport() ?? {};
    } else {
      this.gridEl.classList.remove('is-fit');
      this.gridEl.style.removeProperty('--row-h');
      this.setColumns(this.workspace.settings.columns);
      result = { fits: false, fixed: true, charts: this.tiles.size };
    }
    // Both branches report, so the footer never shows a stale layout.
    this.dispatchEvent(new CustomEvent('layout', { detail: result }));
    return result;
  }

  defaultSymbol() {
    const first = this.workspace?.charts?.[0]?.symbol;
    return first ?? 'SET:CPF';
  }

  updateFooterStats() {
    const count = this.tiles.size;
    const indicators = [...this.tiles.values()]
      .reduce((n, t) => n + t.config.indicators.length, 0);
    this.dispatchEvent(new CustomEvent('stats', {
      detail: { charts: count, indicators, symbols: new Set([...this.tiles.values()].map((t) => t.config.symbol)).size },
    }));
  }
}