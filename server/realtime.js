/**
 * Realtime hub.
 *
 * Clients register the symbols they currently display (one entry per chart
 * tile, so a symbol shown four times is fetched once). Every poll tick the hub
 * asks the MCP for all registered quotes and pushes one message per client,
 * trimmed to that client's own symbol set.
 *
 * The polling interval is per-client: a board can sit at 5s while it is being
 * studied and back off to 60s when the tab is hidden. The hub therefore keeps a
 * single loop running at the fastest interval any client asked for, and skips
 * clients whose subscription hasn't expired yet.
 */
import { EventEmitter } from 'node:events';
import { uniqueSymbols } from './symbols.js';

const DEFAULT_TTL = 20_000;
const MIN_INTERVAL = 3_000;

export class RealtimeHub extends EventEmitter {
  /**
   * @param {object} opts
   * @param {import('./mcp-client.js').McpClient} opts.mcp
   * @param {(symbols:string[]) => Promise<{quotes:object, errors:Array}>} opts.fetchQuotes
   */
  constructor({ mcp, fetchQuotes, onError }) {
    super();
    this.mcp = mcp;
    this.fetchQuotes = fetchQuotes;
    this.onError = onError ?? (() => {});
    /** @type {Map<string, {symbols:Set<string>, nextPollAt:number, intervalMs:number, meta:object}>} */
    this.clients = new Map();
    this.timer = null;
    this.currentInterval = null;
    this.polling = false;
    this.lastQuotes = {};
    this.lastTickAt = 0;
    this.tickCount = 0;
    this.errorCount = 0;
  }

  register(id, { symbols, intervalMs, meta }) {
    const interval = Math.max(MIN_INTERVAL, Number(intervalMs) || DEFAULT_TTL);
    const list = uniqueSymbols(symbols ?? []);
    this.clients.set(id, {
      symbols: new Set(list),
      intervalMs: interval,
      nextPollAt: 0, // poll immediately on join
      meta: meta ?? {},
    });
    this._reschedule();
    return this.status();
  }

  update(id, { symbols, intervalMs, meta }) {
    const existing = this.clients.get(id);
    if (!existing) return this.register(id, { symbols, intervalMs, meta });
    if (Array.isArray(symbols)) existing.symbols = new Set(uniqueSymbols(symbols));
    if (intervalMs) existing.intervalMs = Math.max(MIN_INTERVAL, Number(intervalMs));
    if (meta) existing.meta = { ...existing.meta, ...meta };
    this._reschedule();
    return this.status();
  }

  unregister(id) {
    this.clients.delete(id);
    this._reschedule();
  }

  _fastestInterval() {
    let fastest = null;
    for (const client of this.clients.values()) {
      if (fastest === null || client.intervalMs < fastest) fastest = client.intervalMs;
    }
    return fastest;
  }

  _reschedule() {
    const fastest = this._fastestInterval();
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.currentInterval = fastest;
    if (fastest === null) return;

    this.timer = setInterval(() => {
      this.tick().catch((err) => this.onError(err));
    }, Math.max(500, Math.floor(fastest / 2)));
    this.timer.unref?.();
    // Poll the joining client right away instead of waiting a full interval.
    this.tick().catch((err) => this.onError(err));
  }

  async tick(now = Date.now()) {
    if (this.polling) return; // a slow screener must not stack requests
    this.polling = true;
    try {
      const due = [...this.clients.entries()].filter(([, c]) => c.nextPollAt <= now);
      if (due.length === 0) return;

      const symbols = uniqueSymbols([...due.flatMap(([, c]) => [...c.symbols])]);
      if (symbols.length === 0) {
        for (const [, c] of due) c.nextPollAt = now + c.intervalMs;
        return;
      }

      const { quotes, errors } = await this.fetchQuotes(symbols);

      for (const [id, client] of due) {
        client.nextPollAt = now + client.intervalMs;
      }
      this.lastQuotes = quotes;
      this.lastTickAt = now;
      this.tickCount += 1;
      if (errors?.length) this.errorCount += 1;

      // Only ship rows this client actually displays.
      for (const [id, client] of this.clients) {
        const rows = {};
        for (const [sym, q] of Object.entries(quotes)) {
          if (client.symbols.has(sym)) rows[sym] = q;
        }
        this.emit('quotes', id, {
          type: 'quotes',
          quotes: rows,
          errors: errors?.filter((e) => client.symbols.has(e.symbol)) ?? [],
          ts: now,
        });
      }
      this.emit('tick', { symbols, quotes, errors });
    } finally {
      this.polling = false;
    }
  }

  status() {
    return {
      clients: this.clients.size,
      watchedSymbols: uniqueSymbols(
        [...this.clients.values()].flatMap((c) => [...c.symbols]),
      ).length,
      intervalMs: this.currentInterval,
      lastTickAt: this.lastTickAt,
      tickCount: this.tickCount,
      errorCount: this.errorCount,
    };
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.clients.clear();
  }
}