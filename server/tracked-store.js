/**
 * The names being followed.
 *
 * A screen gives a shortlist; this is what happens next. A name goes in with the
 * reason it was worth looking at, and the list remembers it — with the score,
 * the multiple and the yield it had that day, so a reader can see months later
 * whether the case still holds or the price has run away from it.
 *
 * Written like the boards: a JSON file, atomic writes, debounced. The file is
 * tracked in the repository, so the list a reader leaves behind is the list
 * their successor opens.
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { normalizeSymbol } from './symbols.js';

const MAX_TRACKED = 200;
const SAVE_DEBOUNCE_MS = 400;

const STATUSES = new Set(['watching', 'bought', 'sold']);

const newId = () => `tr_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

const finiteOrNull = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);

/**
 * One entry, rebuilt from scratch.
 *
 * The shape is the persistence contract: a field is only kept if it is written
 * here, so a note that is not in this list is not a note that survives a
 * restart.
 */
function sanitizeEntry(raw) {
  const symbol = normalizeSymbol(raw?.symbol);
  if (!symbol) return null;
  return {
    id: typeof raw?.id === 'string' && raw.id ? raw.id : newId(),
    symbol,
    name: String(raw?.name ?? '').slice(0, 120),
    note: String(raw?.note ?? '').slice(0, 600),
    status: STATUSES.has(raw?.status) ? raw.status : 'watching',
    addedAt: Number.isFinite(raw?.addedAt) ? raw.addedAt : Date.now(),
    updatedAt: Date.now(),
    // What the numbers were the day it went in, so the list can show what has
    // changed since and not only what is true now.
    at: {
      price: finiteOrNull(raw?.at?.price),
      pe: finiteOrNull(raw?.at?.pe),
      yield: finiteOrNull(raw?.at?.yield),
      score: finiteOrNull(raw?.at?.score),
      intrinsic: finiteOrNull(raw?.at?.intrinsic),
    },
  };
}

export class TrackedStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.entries = new Map();
    this.writeTimer = null;
    this.writing = null;
  }

  async load() {
    try {
      const text = await readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(text);
      const list = Array.isArray(parsed) ? parsed : (parsed.tracked ?? []);
      for (const entry of list) {
        const clean = sanitizeEntry(entry);
        if (clean) this.entries.set(clean.id, clean);
      }
    } catch (err) {
      if (err.code !== 'ENOENT') {
        console.warn(`[tracked] could not read ${this.filePath}: ${err.message}`);
      }
    }
    return this.list();
  }

  list() {
    return [...this.entries.values()]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((e) => ({ ...e }));
  }

  /** The whole records, for a backup file. */
  all() {
    return [...this.entries.values()].map((e) => ({ ...e }));
  }

  get(id) {
    return this.entries.get(id) ?? null;
  }

  /** The entry for a symbol, if it is already on the list. */
  findBySymbol(symbol) {
    const norm = normalizeSymbol(symbol);
    if (!norm) return null;
    for (const entry of this.entries.values()) {
      if (entry.symbol === norm) return entry;
    }
    return null;
  }

  save(input) {
    const existing = input?.id ? this.entries.get(input.id) : null;
    const entry = sanitizeEntry({
      ...(existing ?? {}),
      ...input,
      id: existing?.id ?? input?.id,
      addedAt: existing?.addedAt ?? input?.addedAt,
    });
    if (!entry) return null;
    this.entries.set(entry.id, entry);
    this._trim();
    this._scheduleWrite();
    return entry;
  }

  update(id, patch) {
    const existing = this.entries.get(id);
    if (!existing) return null;
    return this.save({ ...existing, ...patch, id });
  }

  remove(id) {
    const removed = this.entries.delete(id);
    if (removed) this._scheduleWrite();
    return removed;
  }

  /** Replace the whole list — used when a backup file is imported. */
  replaceAll(entries) {
    this.entries.clear();
    for (const raw of entries ?? []) {
      const clean = sanitizeEntry(raw);
      if (clean) this.entries.set(clean.id, clean);
    }
    this._scheduleWrite();
    return this.list();
  }

  _trim() {
    while (this.entries.size > MAX_TRACKED) {
      const oldest = [...this.entries.values()].sort((a, b) => a.updatedAt - b.updatedAt)[0];
      if (!oldest) break;
      this.entries.delete(oldest.id);
    }
  }

  _scheduleWrite() {
    if (this.writeTimer) clearTimeout(this.writeTimer);
    this.writeTimer = setTimeout(() => {
      this.writeTimer = null;
      this._write().catch((err) => console.warn(`[tracked] write failed: ${err.message}`));
    }, SAVE_DEBOUNCE_MS);
    this.writeTimer.unref?.();
  }

  async _write() {
    if (this.writing) {
      await this.writing;
    }
    const payload = { version: 1, tracked: this.all() };
    this.writing = (async () => {
      await mkdir(dirname(this.filePath), { recursive: true });
      const tmp = `${this.filePath}.tmp`;
      await writeFile(tmp, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
      await rename(tmp, this.filePath);
    })();
    try {
      await this.writing;
    } finally {
      this.writing = null;
    }
  }
}
