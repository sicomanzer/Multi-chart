/**
 * Workspace persistence.
 *
 * A workspace is the whole board: global settings plus every chart tile and its
 * indicator instances. Saved to a JSON file so a layout survives a browser
 * wipe, a second monitor, or a colleague asking "what was that grid called?".
 *
 * Writes are atomic (tmp file + rename) and debounced — the editor fires a
 * save on every keystroke-ish change and we don't want 40 disk writes a second.
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { INDICATORS, sanitizeParams, defaultParams } from './indicator-catalog.js';
import { normalizeSymbol } from './symbols.js';
import { TIMEFRAMES, DEFAULT_TIMEFRAME } from './market.js';

const MAX_WORKSPACES = 40;
const SAVE_DEBOUNCE_MS = 400;

export const DEFAULT_SETTINGS = {
  theme: 'dark',
  columns: 4,
  // 'auto'  — pick columns and row height so every chart fits the viewport
  // 'fixed' — honour `columns` and let the board scroll
  layoutFit: 'auto',
  // What the strip under each chart shows.
  //   'fundamentals' — P/E, P/BV, D/E, dividend yield
  //   'indicators'   — live indicator values (click to edit)
  //   'both'         — fundamentals line, indicators line
  footerMode: 'both',
  // Which fundamentals to display, in order.
  footerMetrics: ['pe', 'pbv', 'de', 'dividendYield'],
  defaultTimeframe: DEFAULT_TIMEFRAME,
  pollSeconds: 20,
  liveQuotes: true,
  syncCrosshair: true,
  syncTimeScale: false,
  showGrid: true,
  showWatermark: false,
  priceFormat: 'auto',
  candleStyle: 'candles',
  confirmClose: true,
};

export const DEFAULT_INDICATOR_INSTANCE = (type) => ({
  id: null, // filled by the store
  type,
  enabled: true,
  placement: undefined, // inherits the catalog default when absent
  params: defaultParams(type),
});

const newId = (prefix) =>
  `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * Repair anything structurally wrong. Saved layouts travel through localStorage
 * and JSON files, so treat every field as untrusted: a missing key falls back to
 * a default, a bad indicator type is dropped, an out-of-range period is clamped
 * by `sanitizeParams`.
 */
export function sanitizeWorkspace(input, { fallbackName = 'Workspace' } = {}) {
  const raw = isPlainObject(input) ? input : {};
  const settings = { ...DEFAULT_SETTINGS };

  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    const v = raw.settings?.[key];
    if (v === undefined || v === null) continue;
    if (typeof DEFAULT_SETTINGS[key] === 'boolean') settings[key] = Boolean(v);
    else if (typeof DEFAULT_SETTINGS[key] === 'number') {
      const n = Number(v);
      if (Number.isFinite(n)) settings[key] = Math.min(200, Math.max(1, Math.round(n)));
    } else settings[key] = String(v);
  }
  settings.columns = Math.min(6, Math.max(1, settings.columns));
  settings.layoutFit = settings.layoutFit === 'fixed' ? 'fixed' : 'auto';
  settings.footerMode = ['fundamentals', 'indicators', 'both'].includes(settings.footerMode)
    ? settings.footerMode
    : 'both';
  settings.footerMetrics = Array.isArray(raw.settings?.footerMetrics)
    ? raw.settings.footerMetrics.filter((m) => typeof m === 'string').slice(0, 8)
    : DEFAULT_SETTINGS.footerMetrics;
  if (!TIMEFRAMES[settings.defaultTimeframe]) settings.defaultTimeframe = DEFAULT_TIMEFRAME;

  const charts = (Array.isArray(raw.charts) ? raw.charts : []).slice(0, 60).flatMap((c) => {
    const symbol = normalizeSymbol(c?.symbol);
    if (!symbol) return [];
    const tf = TIMEFRAMES[c?.timeframe] ? c.timeframe : settings.defaultTimeframe;

    const indicators = (Array.isArray(c?.indicators) ? c.indicators : [])
      .slice(0, 24)
      .flatMap((inst) => {
        const def = INDICATORS.find((d) => d.type === inst?.type);
        if (!def) return [];
        return [{
          id: typeof inst.id === 'string' ? inst.id : newId('ind'),
          type: def.type,
          enabled: inst.enabled !== false,
          placement: inst.placement === 'overlay' || inst.placement === 'pane'
            ? inst.placement
            : def.placement,
          params: sanitizeParams(def.type, inst.params),
        }];
      });

    return [{
      id: typeof c?.id === 'string' ? c.id : newId('ch'),
      symbol,
      timeframe: tf,
      chartType: ['candles', 'bars', 'line', 'area', 'baseline', 'heikin'].includes(c?.chartType)
        ? c.chartType
        : settings.candleStyle,
      logScale: Boolean(c?.logScale),
      autoscale: c?.autoscale !== false,
      indicators,
    }];
  });

  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : newId('ws'),
    name: String(raw.name ?? fallbackName).slice(0, 80) || fallbackName,
    createdAt: Number.isFinite(raw.createdAt) ? raw.createdAt : Date.now(),
    updatedAt: Date.now(),
    // Optimistic-concurrency token: a client sends the revision it started from
    // and the server refuses the write if something else moved it on. Without
    // this, a browser tab left open overnight silently clobbers edits made from
    // the CLI or another machine.
    revision: Number.isFinite(raw.revision) ? raw.revision : 0,
    settings,
    charts,
  };
}

/** Starter board: a handful of liquid names on the default exchange. */
export function starterWorkspace(exchange = 'SET') {
  const picks = exchange === 'SET'
    ? ['CPF', 'PTT', 'KBANK', 'ADVANC', 'AOT', 'KCE', 'GUNKUL', 'BANPU']
    : ['AAPL', 'MSFT', 'NVDA', 'TSLA', 'AMD', 'TSM', 'AMZN', 'META'];

  return sanitizeWorkspace({
    name: `${exchange} board`,
    settings: { ...DEFAULT_SETTINGS, defaultTimeframe: '1w' },
    charts: picks.map((symbol) => ({
      symbol: `${exchange}:${symbol}`,
      timeframe: '1w',
      indicators: [{ type: 'rsi', params: { length: 14 } }],
    })),
  });
}

export class WorkspaceStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.workspaces = new Map();
    this.writeTimer = null;
    this.writing = null;
    this.dirty = false;
  }

  async load() {
    try {
      const text = await readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(text);
      const list = Array.isArray(parsed) ? parsed : (parsed.workspaces ?? []);
      for (const entry of list) {
        const ws = sanitizeWorkspace(entry);
        this.workspaces.set(ws.id, ws);
      }
    } catch (err) {
      if (err.code !== 'ENOENT') {
        console.warn(`[workspace] could not read ${this.filePath}: ${err.message}`);
      }
    }

    if (this.workspaces.size === 0) {
      const seed = starterWorkspace();
      this.workspaces.set(seed.id, seed);
      this._scheduleWrite();
    }
    return this.list();
  }

  list() {
    return [...this.workspaces.values()]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((w) => ({
        id: w.id,
        name: w.name,
        chartCount: w.charts.length,
        updatedAt: w.updatedAt,
        settings: w.settings,
      }));
  }

  get(id) {
    return this.workspaces.get(id) ?? null;
  }

  /**
   * Persist a workspace.
   *
   * `baseRevision` is the revision the client had when it started editing.
   * A mismatch means someone else saved in the meantime, so the write is
   * rejected with `{ conflict: true, current }` and the caller (the HTTP layer)
   * answers 409 — the client then reloads instead of overwriting.
   */
  save(input, { id, baseRevision } = {}) {
    const existing = id ? this.workspaces.get(id) : null;

    if (existing && baseRevision !== undefined && baseRevision !== null
      && Number(baseRevision) !== existing.revision) {
      return { conflict: true, current: existing };
    }

    const ws = sanitizeWorkspace({
      ...input,
      id: existing?.id ?? input?.id,
      createdAt: existing?.createdAt,
      revision: existing ? existing.revision + 1 : 0,
    });

    this.workspaces.set(ws.id, ws);
    this._trim();
    this._scheduleWrite();
    return ws;
  }

  /** Patch one workspace without touching its charts. */
  update(id, patch) {
    const existing = this.workspaces.get(id);
    if (!existing) return null;
    return this.save({ ...existing, ...patch }, { id });
  }

  rename(id, name) {
    const existing = this.workspaces.get(id);
    if (!existing) return null;
    return this.save({ ...existing, name }, { id });
  }

  remove(id) {
    const removed = this.workspaces.delete(id);
    if (removed) this._scheduleWrite();
    return removed;
  }

  duplicate(id) {
    const existing = this.workspaces.get(id);
    if (!existing) return null;
    const copy = sanitizeWorkspace({
      ...existing,
      id: undefined,
      name: `${existing.name} copy`.slice(0, 80),
    });
    copy.id = newId('ws');
    this.workspaces.set(copy.id, copy);
    this._scheduleWrite();
    return copy;
  }

  _trim() {
    while (this.workspaces.size > MAX_WORKSPACES) {
      const oldest = [...this.workspaces.values()]
        .sort((a, b) => a.updatedAt - b.updatedAt)[0];
      if (!oldest) break;
      this.workspaces.delete(oldest.id);
    }
  }

  _scheduleWrite() {
    this.dirty = true;
    if (this.writeTimer) return;
    this.writeTimer = setTimeout(() => {
      this.writeTimer = null;
      this.flush().catch((err) => console.warn(`[workspace] write failed: ${err.message}`));
    }, SAVE_DEBOUNCE_MS);
    this.writeTimer.unref?.();
  }

  /** Serialise writes so concurrent flushes can't interleave on the same file. */
  async flush() {
    if (!this.dirty) return;
    if (this.writing) return this.writing;

    this.dirty = false;
    const payload = JSON.stringify(
      { version: 1, workspaces: [...this.workspaces.values()] },
      null,
      2,
    );

    this.writing = (async () => {
      const dir = dirname(this.filePath);
      const tmp = join(dir, `.${Date.now()}.tmp`);
      await mkdir(dir, { recursive: true });
      await writeFile(tmp, payload, 'utf8');
      await rename(tmp, this.filePath); // atomic on same volume
    })().finally(() => {
      this.writing = null;
    });

    return this.writing;
  }
}