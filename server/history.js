/**
 * Daily history of the fundamentals ratios.
 *
 * A value-investing screen needs *trends*, not a snapshot: "is ROE holding up",
 * "is this P/E cheap against its own five years", "did the reason I bought still
 * hold". The screener only ever hands out the current value, so the series has
 * to be built by keeping it. Nothing here can be recovered later — a metric we
 * did not record on day one is gone — which is the whole reason it starts now.
 *
 * Storage is newline-delimited JSON, one record per symbol per day, appended and
 * never rewritten:
 *   {"d":"2026-10-08","s":"SET:TU","p":12.5,"pe":10.26,"pbv":1.05,...}
 * Append-only means a crash mid-write can lose the tail and nothing else, there
 * is no whole-file rewrite to fail, and the file stays greppable. The volume is
 * trivial: 15 symbols a day is about 5,500 lines a year.
 *
 * Two writers (two browser tabs, or the CLI) can both append the same
 * symbol/date; the later line wins on load. That is the intended behaviour — the
 * numbers are the same, and a duplicate is cheaper than a lock.
 */
import { mkdir, readFile, appendFile, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';

/** Refuse to grow without bound: ~30 MB is a decade of daily snapshots. */
const MAX_BYTES = 30 * 1024 * 1024;

/** Local calendar day, not UTC — a snapshot at 08:00 in Bangkok is that day. */
const today = () => {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

export class FundamentalsHistory {
  constructor(filePath) {
    this.filePath = filePath;
    /** @type {Map<string, object>} key `symbol|date` -> point */
    this.points = new Map();
    this.symbols = new Set();
    this.loaded = false;
    this.lastError = null;
    this.appended = 0;
    this.skipped = 0;
  }

  async load() {
    try {
      const text = await readFile(this.filePath, 'utf8');
      let bad = 0;
      for (const line of text.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const rec = JSON.parse(trimmed);
          if (rec?.s && rec?.d) this._index(rec);
          else bad += 1;
        } catch {
          bad += 1;                       // a torn tail line; ignore and carry on
        }
      }
      if (bad) console.warn(`[history] skipped ${bad} unreadable line(s) in ${this.filePath}`);
    } catch (err) {
      if (err.code !== 'ENOENT') {
        this.lastError = err.message;
        console.warn(`[history] could not read ${this.filePath}: ${err.message}`);
      }
    }
    this.loaded = true;
    return this;
  }

  _index(rec) {
    this.points.set(`${rec.s}|${rec.d}`, rec);
    this.symbols.add(rec.s);
  }

  /**
   * Record today's ratios for these symbols.
   *
   * Only fills gaps: a symbol already recorded for today is left alone, so a
   * board refresh every 30 minutes does not write 48 copies of the same numbers.
   * `force` overwrites today's entry instead, which is what the manual button
   * wants — ratios change when a company reports, and that is worth capturing.
   *
   * @param {object} data symbol -> { pe: {value, kind}, price, ... }
   * @param {object} opts { metrics: string[], force?: boolean, date?: string }
   */
  async record(data, { metrics = [], force = false, date = today() } = {}) {
    if (!this.loaded) await this.load();
    const day = date;
    const lines = [];
    let written = 0;
    let skipped = 0;

    for (const [symbol, row] of Object.entries(data ?? {})) {
      const key = `${symbol}|${day}`;
      if (!force && this.points.has(key)) { skipped += 1; continue; }

      const point = { d: day, s: symbol };
      // Price rides along because every ratio here is price-relative: keeping the
      // price lets a later run restate the multiples without a second source.
      if (typeof row.price === 'number' && Number.isFinite(row.price)) point.p = row.price;
      for (const key_ of metrics) {
        const cell = row[key_];
        const value = cell && typeof cell === 'object' ? cell.value : cell;
        if (typeof value === 'number' && Number.isFinite(value)) point[key_] = value;
      }
      if (Object.keys(point).length <= 2) { skipped += 1; continue; } // no numbers at all

      lines.push(JSON.stringify(point));
      this._index(point);
      written += 1;
    }

    this.appended += written;
    this.skipped += skipped;
    if (lines.length === 0) return { written: 0, skipped };

    try {
      await mkdir(dirname(this.filePath), { recursive: true });
      await this._guardSize();
      await appendFile(this.filePath, `${lines.join('\n')}\n`, 'utf8');
    } catch (err) {
      // Recording is a background nicety; a failed write must not take the
      // board down, and the in-memory copy would lie about what is on disk.
      this.lastError = err.message;
      console.warn(`[history] append failed: ${err.message}`);
      return { written: 0, skipped, error: err.message };
    }
    return { written, skipped };
  }

  async _guardSize() {
    try {
      const info = await stat(this.filePath);
      if (info.size <= MAX_BYTES) return;
      console.warn(`[history] ${this.filePath} is ${(info.size / 1048576).toFixed(1)} MB; consider pruning`);
    } catch { /* does not exist yet */ }
  }

  /**
   * One symbol's series, oldest first.
   *
   * `metrics` narrows the returned fields; omit it for everything recorded.
   */
  series(symbol, { from, to, metrics } = {}) {
    const rows = [];
    for (const [key, rec] of this.points) {
      if (!key.startsWith(`${symbol}|`)) continue;
      if (from && rec.d < from) continue;
      if (to && rec.d > to) continue;
      const point = { date: rec.d };
      for (const [field, value] of Object.entries(rec)) {
        if (field === 'd' || field === 's') continue;
        if (metrics && !metrics.includes(field)) continue;
        point[field] = value;
      }
      rows.push(point);
    }
    return rows.sort((a, b) => a.date.localeCompare(b.date));
  }

  /** Latest recorded point per symbol, for "what did I last see". */
  latest() {
    const out = {};
    for (const rec of this.points.values()) {
      const prev = out[rec.s];
      if (!prev || rec.d > prev.date) out[rec.s] = { date: rec.d, ...stripMeta(rec) };
    }
    return out;
  }

  summary() {
    const days = new Set();
    for (const rec of this.points.values()) days.add(rec.d);
    const sorted = [...days].sort();
    const perSymbol = {};
    for (const rec of this.points.values()) perSymbol[rec.s] = (perSymbol[rec.s] ?? 0) + 1;
    return {
      file: this.filePath,
      symbols: this.symbols.size,
      symbolList: [...this.symbols].sort(),
      points: this.points.size,
      days: sorted.length,
      since: sorted[0] ?? null,
      lastDate: sorted.at(-1) ?? null,
      perSymbol,
      lastError: this.lastError,
    };
  }
}

const stripMeta = (rec) => {
  const { d, s, ...rest } = rec;
  return rest;
};
