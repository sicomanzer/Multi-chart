/**
 * Fundamentals client for the Python sidecar in `fundamentals.py`.
 *
 * Same shape as the MCP client — long-lived process, newline-delimited JSON,
 * request queue, timeouts, restart on death — because fundamentals are
 * re-fetched whenever the board changes and paying pandas' import cost each
 * time would make the UI feel broken.
 *
 * Caching: values only move when a company reports, so per-symbol entries are
 * held for `TTL_MS`. A board of 20 charts therefore costs one upstream request
 * on load and none afterwards until the cache expires or the user refreshes.
 */
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SIDECAR = join(HERE, 'fundamentals.py');

const DEFAULTS = {
  command: process.env.TVMCP_PYTHON || 'python',
  args: [],
  requestTimeoutMs: 30_000,
  ttlMs: 30 * 60 * 1000, // 30 minutes
  maxQueue: 8,
  restartDelayMs: 3_000,
};

/**
 * Metrics the UI knows how to label and format, in a sensible default order.
 *
 * Ratios and percentages only — the endpoint's absolute-currency columns
 * (EPS, DPS, market cap) come back scaled wrong, so they are not offered. See
 * the note on METRICS in fundamentals.py.
 */
export const METRIC_CATALOG = [
  { key: 'pe', label: 'P/E', hint: 'price / trailing earnings' },
  { key: 'pbv', label: 'P/BV', hint: 'price / book value' },
  { key: 'de', label: 'D/E', hint: 'total debt / equity' },
  { key: 'dividendYield', label: 'Y%', hint: 'dividend yield' },
  { key: 'roe', label: 'ROE', hint: 'return on equity' },
  { key: 'roa', label: 'ROA', hint: 'return on assets' },
  { key: 'ps', label: 'P/S', hint: 'price / sales' },
  { key: 'evEbitda', label: 'EV/EBITDA', hint: 'enterprise value / EBITDA' },
  { key: 'currentRatio', label: 'Curr.R', hint: 'current ratio' },
];

export const DEFAULT_METRICS = ['pe', 'pbv', 'de', 'dividendYield'];

const METRICS_KEYS = new Set(METRIC_CATALOG.map((m) => m.key));

export class FundamentalsClient extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = { ...DEFAULTS, ...config };
    this.child = null;
    this.ready = false;
    this.buffer = '';
    this.nextId = 1;
    this.pending = new Map();
    this.queue = [];
    this.inFlight = 0;
    this.cache = new Map(); // symbol -> { value, expires }
    this.stopping = false;
    this.lastError = null;
    this.restartTimer = null;
    this.stderr = [];
  }

  get available() {
    return existsSync(SIDECAR);
  }

  status() {
    return {
      available: this.available,
      ready: this.ready,
      pid: this.child?.pid ?? null,
      cached: this.cache.size,
      queued: this.queue.length,
      inFlight: this.inFlight,
      lastError: this.lastError,
      stderr: this.stderr.slice(-3),
    };
  }

  // ── process lifecycle ──────────────────────────────────────────────────────

  async ensureStarted() {
    if (this.ready) return;
    if (this._starting) return this._starting;
    if (!this.available) {
      throw new Error(`sidecar not found at ${SIDECAR}`);
    }
    this._starting = this._start().finally(() => { this._starting = null; });
    return this._starting;
  }

  async _start() {
    this.stopping = false;
    const child = spawn(this.config.command, [...this.config.args, SIDECAR], {
      cwd: join(HERE, '..'),
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      env: { ...process.env, PYTHONUNBUFFERED: '1' },
    });
    this.child = child;

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => this._onStdout(chunk));
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
      for (const line of String(chunk).split(/\r?\n/)) {
        const t = line.trim();
        if (!t) continue;
        this.stderr.push(t);
        if (this.stderr.length > 20) this.stderr.shift();
      }
    });

    child.on('error', (err) => {
      this.lastError = `spawn failed: ${err.message}`;
      this.ready = false;
      this._failAll(new Error(this.lastError));
    });

    child.on('exit', (code) => {
      this.ready = false;
      this.child = null;
      this._failAll(new Error(`fundamentals sidecar exited (code=${code})`));
      if (!this.stopping) this._scheduleRestart();
    });

    this.ready = true;
    this.lastError = null;
  }

  _scheduleRestart() {
    if (this.stopping || this.restartTimer) return;
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      this.ensureStarted().catch(() => {});
    }, this.config.restartDelayMs);
    this.restartTimer.unref?.();
  }

  async stop() {
    this.stopping = true;
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.restartTimer = null;
    this._failAll(new Error('fundamentals client stopped'));
    const child = this.child;
    this.child = null;
    this.ready = false;
    if (child) {
      try { child.stdin?.write(JSON.stringify({ cmd: 'quit' }) + '\n'); } catch { /* gone */ }
      child.stdin?.end();
      child.kill();
    }
  }

  // ── framing ────────────────────────────────────────────────────────────────

  _onStdout(chunk) {
    this.buffer += chunk;
    let nl;
    while ((nl = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, nl).trim();
      this.buffer = this.buffer.slice(nl + 1);
      if (!line) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { continue; }
      const entry = this.pending.get(msg.id);
      if (!entry) continue;
      this.pending.delete(msg.id);
      clearTimeout(entry.timer);
      if (msg.error) entry.reject(new Error(msg.error));
      else entry.resolve(msg.data ?? {});
    }
  }

  _failAll(err) {
    for (const [, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(err);
    }
    this.pending.clear();
    for (const job of this.queue) job.reject(err);
    this.queue = [];
    this.inFlight = 0;
  }

  _enqueue(fn) {
    return new Promise((resolve, reject) => {
      if (this.queue.length >= this.config.maxQueue) {
        reject(new Error('fundamentals queue full'));
        return;
      }
      this.queue.push({ fn, resolve, reject });
      this._pump();
    });
  }

  _pump() {
    while (this.inFlight === 0 && this.queue.length > 0) {
      const job = this.queue.shift();
      this.inFlight += 1;
      Promise.resolve()
        .then(job.fn)
        .then(job.resolve, job.reject)
        .finally(() => {
          this.inFlight -= 1;
          this._pump();
        });
    }
  }

  _send(payload) {
    return new Promise((resolve, reject) => {
      const child = this.child;
      if (!child?.stdin?.writable) {
        reject(new Error('fundamentals sidecar is not running'));
        return;
      }
      const id = this.nextId++;
      const timer = setTimeout(() => {
        if (!this.pending.has(id)) return;
        this.pending.delete(id);
        reject(new Error('fundamentals request timed out'));
      }, this.config.requestTimeoutMs);
      timer.unref?.();

      this.pending.set(id, { resolve, reject, timer });
      child.stdin.write(JSON.stringify({ id, ...payload }) + '\n', (err) => {
        if (!err) return;
        clearTimeout(timer);
        this.pending.delete(id);
        reject(err);
      });
    });
  }

  // ── public API ─────────────────────────────────────────────────────────────

  /**
   * Fundamentals for a set of TradingView symbols.
   *
   * Cache entries are keyed by symbol but only reusable when they already
   * contain every requested metric — the payload shape depends on what was
   * asked for, so a 4-metric fetch must not satisfy an 8-metric request.
   *
   * @param {string[]} symbols e.g. ['SET:PTT', 'SET:SCB']
   * @param {object} opts { metrics?: string[], refresh?: boolean }
   * @returns {Promise<{data: object, cached: string[], fetched: string[], missing: string[]}>}
   */
  async get(symbols, { metrics = DEFAULT_METRICS, refresh = false } = {}) {
    const wanted = [...new Set(symbols.map((s) => String(s).toUpperCase()))];
    const requested = [...new Set(metrics)].filter((m) => METRICS_KEYS.has(m));
    const result = { data: {}, cached: [], fetched: [], missing: [], source: 'tradingview-screener' };
    if (wanted.length === 0) return result;

    const stale = [];
    for (const symbol of wanted) {
      const hit = this.cache.get(symbol);
      const usable = !refresh
        && hit
        && Date.now() <= hit.expires
        && requested.every((m) => m in hit.value);
      if (usable) {
        result.data[symbol] = hit.value;
        result.cached.push(symbol);
      } else {
        stale.push(symbol);
      }
    }
    if (stale.length === 0) return result;

    try {
      await this.ensureStarted();
      const raw = await this._enqueue(() => this._send({ symbols: stale, metrics: requested }));

      for (const [symbol, value] of Object.entries(raw ?? {})) {
        this.cache.set(symbol, { value, expires: Date.now() + this.config.ttlMs });
        if (wanted.includes(symbol)) result.data[symbol] = value;
        // Also index the base ticker so a board row keyed `SET:PTT.R` resolves.
        const base = symbol.split('.')[0];
        if (base !== symbol && wanted.includes(base)) result.data[base] = value;
        if (stale.includes(symbol)) result.fetched.push(symbol);
      }
      result.missing = wanted.filter((s) => !result.data[s]);
    } catch (err) {
      this.lastError = err.message;
      // A sidecar failure must never take the board down: report it and let the
      // tiles render without fundamentals.
      result.error = err.message;
      result.missing = wanted;
    }
    return result;
  }

  clearCache() {
    this.cache.clear();
  }
}