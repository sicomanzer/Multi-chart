/**
 * Watchlist persistence.
 *
 * A watchlist is a named bag of symbols, deliberately separate from a board:
 *
 *   board      — a laid-out grid of charts, one workspace of many
 *   watchlist  — just the tickers, reusable across every board
 *
 * The point is to keep a research list ("AI", "dividend", "what I am watching")
 * somewhere that does not depend on how the grid happens to be arranged today,
 * and to be able to dump one onto a board in a single click.
 *
 * Storage is the same shape as `workspace-store.js` — one JSON file, atomic
 * tmp+rename, debounced writes — so the two stores behave identically from the
 * operator's side and a corrupt file degrades the same way.
 *
 * Unlike boards there is deliberately **no cap on how many lists may exist**:
 * a list costs one name and a few dozen short strings, and trimming the oldest
 * would quietly destroy research work. The number of symbols inside one list is
 * bounded instead, because a list has to stay loadable onto a board.
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { uniqueSymbols } from './symbols.js';

/**
 * Ceiling on one list's length.
 *
 * The board itself tops out at 60 charts, so anything past this is unreachable
 * in one click anyway; the bound exists to keep a single saved file from
 * growing past the 2 MB JSON body limit the API accepts.
 */
export const MAX_SYMBOLS_PER_LIST = 500;

const SAVE_DEBOUNCE_MS = 400;

const newId = (prefix) =>
  `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * A ticker the board could actually draw.
 *
 * `normalizeSymbol` is deliberately permissive: it strips whitespace and
 * prefixes an exchange so that whatever somebody types resolves to something
 * the caller can answer a query about. That is right for a search box and
 * wrong for a *saved* list, where `42` and `{}` would be stored as `SET:42`
 * and `SET:[OBJECTOBJECT]` and quietly pollute a list the user believes is
 * clean. A leading `^` is allowed, for index symbols.
 */
const TICKER_RE = /^\^?[A-Z0-9][A-Z0-9._-]{0,31}$/;

/**
 * Turn whatever arrived from the network into a list of usable canonical
 * symbols.
 *
 * Two things happen here that `normalizeSymbol` alone does not do:
 *
 *  - every entry is split, because callers send either `['SCB', 'KBANK']` or
 *    `['SCB, KBANK']` and the stored result should not depend on which;
 *  - entries that are not ticker-shaped are dropped rather than mangled.
 *
 * The split is on commas, semicolons and line breaks only — deliberately not
 * on spaces. Splitting on whitespace fragments a malformed phrase into pieces
 * that each look like a ticker: `not a ticker!!` became `SET:NOT` and
 * `SET:A`, two entries nobody asked for, and no way to tell them from a real
 * pair typed as `AAPL MSFT`. A saved list should hold what was typed or
 * nothing, so a space inside an entry is a rejected entry rather than two
 * accepted ones. The UI hint says "separated by commas" for the same reason.
 */
function cleanSymbols(raw) {
  const entries = Array.isArray(raw) ? raw : [raw];
  const parts = [];
  for (const entry of entries) {
    if (typeof entry !== 'string') continue;
    for (const part of entry.split(/[,;\n\r]+/)) {
      const ticker = part.trim().toUpperCase();
      if (ticker) parts.push(ticker);
    }
  }
  return uniqueSymbols(parts.filter((s) => {
    const bare = s.includes(':') ? s.slice(s.indexOf(':') + 1) : s;
    return TICKER_RE.test(bare);
  }));
}

/**
 * Repair a list coming from the file or the network.
 *
 * Every field is untrusted: symbols go through the same normaliser the board
 * uses, so `CPF`, `SET:CPF` and `cpf.bk` collapse to one entry rather than
 * three, and anything unparseable is dropped instead of poisoning the list.
 *
 * `truncated` is reported rather than applied silently — the caller surfaces
 * it, because quietly losing 40 tickers is worse than saying so.
 */
export function sanitizeWatchlist(input, { fallbackName = 'Watchlist' } = {}) {
  const raw = isPlainObject(input) ? input : {};
  const normalised = cleanSymbols(
    Array.isArray(raw.symbols) ? raw.symbols.slice(0, MAX_SYMBOLS_PER_LIST * 2) : raw.symbols,
  );

  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : newId('wl'),
    name: String(raw.name ?? fallbackName).slice(0, 80) || fallbackName,
    createdAt: Number.isFinite(raw.createdAt) ? raw.createdAt : Date.now(),
    updatedAt: Date.now(),
    symbols: normalised.slice(0, MAX_SYMBOLS_PER_LIST),
    truncated: normalised.length > MAX_SYMBOLS_PER_LIST,
  };
}

export class WatchlistStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.watchlists = new Map();
    this.writeTimer = null;
    this.writing = null;
    this.dirty = false;
  }

  async load() {
    try {
      const text = await readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(text);
      const list = Array.isArray(parsed) ? parsed : (parsed.watchlists ?? []);
      for (const entry of list) {
        const wl = sanitizeWatchlist(entry);
        this.watchlists.set(wl.id, wl);
      }
    } catch (err) {
      // A missing file is the normal first-run case and is not worth a warning;
      // anything else is, because it means an existing list may have been lost.
      if (err.code !== 'ENOENT') {
        console.warn(`[watchlist] could not read ${this.filePath}: ${err.message}`);
      }
    }
    return this.list();
  }

  list() {
    return [...this.watchlists.values()]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((w) => ({
        id: w.id,
        name: w.name,
        count: w.symbols.length,
        updatedAt: w.updatedAt,
        // A short preview so the picker can show what a list is without
        // shipping every symbol of every list to the browser.
        preview: w.symbols.slice(0, 6),
      }));
  }

  get(id) {
    return this.watchlists.get(id) ?? null;
  }

  create({ name, symbols } = {}) {
    const wl = sanitizeWatchlist({ name, symbols });
    this.watchlists.set(wl.id, wl);
    this._scheduleWrite();
    return wl;
  }

  /**
   * @param {string} id
   * @param {object} patch
   * @param {object} [opts]
   * @param {boolean} [opts.merge] fold onto the stored list instead of
   *   replacing it. Mirrors the PATCH semantics the board store uses — a
   *   partial body must not be read as "this list has no symbols".
   */
  save(id, patch, { merge = false } = {}) {
    const existing = this.watchlists.get(id);
    if (!existing) return null;

    const base = merge
      ? { ...existing, ...patch, symbols: patch.symbols ?? existing.symbols }
      : patch;

    const wl = sanitizeWatchlist({ ...base, id: existing.id, createdAt: existing.createdAt });
    this.watchlists.set(wl.id, wl);
    this._scheduleWrite();
    return wl;
  }

  /** Add tickers, ignoring ones already present. Returns the counts. */
  addSymbols(id, rawSymbols) {
    const existing = this.watchlists.get(id);
    if (!existing) return null;

    const before = existing.symbols;
    // Count against what actually survived cleaning, not the raw entry count —
    // otherwise `['SCB, KBANK']` would be reported as one request that produced
    // two symbols, or as a bogus "skipped" when it did not.
    const requested = cleanSymbols(rawSymbols).filter((s) => !before.includes(s));
    const room = Math.max(0, MAX_SYMBOLS_PER_LIST - before.length);
    const accepted = requested.slice(0, room);

    if (accepted.length) {
      const wl = sanitizeWatchlist({
        ...existing,
        id: existing.id,
        symbols: [...before, ...accepted],
      });
      this.watchlists.set(wl.id, wl);
      this._scheduleWrite();
    }

    return {
      watchlist: this.watchlists.get(id),
      added: accepted.length,
      skipped: requested.length - accepted.length,
      // "Nothing went in and something was asked for" — the list is at its cap.
      full: accepted.length === 0 && requested.length > 0,
    };
  }

  removeSymbols(id, rawSymbols) {
    const existing = this.watchlists.get(id);
    if (!existing) return null;

    const drop = new Set(cleanSymbols(rawSymbols));
    const kept = existing.symbols.filter((s) => !drop.has(s));

    const wl = sanitizeWatchlist({ ...existing, id: existing.id, symbols: kept });
    this.watchlists.set(wl.id, wl);
    this._scheduleWrite();
    return { watchlist: wl, removed: existing.symbols.length - kept.length };
  }

  remove(id) {
    const removed = this.watchlists.delete(id);
    if (removed) this._scheduleWrite();
    return removed;
  }

  duplicate(id) {
    const existing = this.watchlists.get(id);
    if (!existing) return null;
    const copy = sanitizeWatchlist({
      ...existing,
      id: undefined,
      name: `${existing.name} copy`.slice(0, 80),
    });
    copy.id = newId('wl');
    this.watchlists.set(copy.id, copy);
    this._scheduleWrite();
    return copy;
  }

  /**
   * Seed a list from the tickers already on a board, so the first list is one
   * click away rather than an exercise in retyping fifteen symbols.
   */
  fromSymbols(symbols, name) {
    const tickers = cleanSymbols(symbols);
    const base = tickers.length ? tickers[0].split(':')[0] : 'SET';
    const generated = name?.trim() || `${base} board ${new Date().toISOString().slice(0, 10)}`;
    return this.create({ name: generated, symbols: tickers });
  }

  summary() {
    const lists = [...this.watchlists.values()];
    return {
      file: this.filePath,
      lists: lists.length,
      symbols: new Set(lists.flatMap((w) => w.symbols)).size,
      // Deliberately not capped, so the UI can say "no limit".
      maxLists: null,
      maxSymbolsPerList: MAX_SYMBOLS_PER_LIST,
    };
  }

  // ── Persistence ────────────────────────────────────────────────────────────

  _scheduleWrite() {
    this.dirty = true;
    if (this.writeTimer) return;
    this.writeTimer = setTimeout(() => {
      this.writeTimer = null;
      this.flush().catch((err) => console.warn(`[watchlist] write failed: ${err.message}`));
    }, SAVE_DEBOUNCE_MS);
    this.writeTimer.unref?.();
  }

  async flush() {
    if (!this.dirty) return;
    if (this.writing) return this.writing;

    this.dirty = false;
    const payload = JSON.stringify(
      { version: 1, watchlists: [...this.watchlists.values()] },
      null,
      2,
    );

    this.writing = (async () => {
      await mkdir(dirname(this.filePath), { recursive: true });
      const tmp = `${this.filePath}.${Date.now()}.tmp`;
      await writeFile(tmp, payload, 'utf8');
      await rename(tmp, this.filePath); // atomic on the same volume
    })().finally(() => {
      this.writing = null;
    });

    return this.writing;
  }
}