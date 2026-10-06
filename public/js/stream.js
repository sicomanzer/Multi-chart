/**
 * Realtime quote stream (Server-Sent Events).
 *
 * The browser subscribes with the symbols currently on screen. The server polls
 * the MCP screener on a shared loop and pushes only the rows this client
 * displayed, so a 24-chart board costs the same upstream as a 3-chart one.
 *
 * The client owns its own subscription state and re-subscribes whenever the
 * visible symbol set changes (debounced), and backs the interval off to 2
 * minutes while the tab is hidden.
 */
const HIDDEN_INTERVAL_MS = 120_000;

export class QuoteStream extends EventTarget {
  constructor({ onQuotes, onStatus } = {}) {
    super();
    this.clientId = `web-${Math.random().toString(36).slice(2, 10)}`;
    this.symbols = new Set();
    this.intervalMs = 20_000;
    this.source = null;
    this.onQuotes = onQuotes ?? (() => {});
    this.onStatus = onStatus ?? (() => {});
    this.lastTickAt = 0;
    this.connected = false;
    this._debounce = null;
  }

  start() {
    if (this.source) return;
    document.addEventListener('visibilitychange', this._onVisibility);
    this._open();
  }

  stop() {
    document.removeEventListener('visibilitychange', this._onVisibility);
    this.source?.close();
    this.source = null;
    this.connected = false;
  }

  _onVisibility = () => {
    if (document.visibilityState === 'hidden') this._reconnect(HIDDEN_INTERVAL_MS);
    else this._reconnect(this.intervalMs);
  };

  /** Replace the watched set. Debounced: the board edits symbols in bursts. */
  subscribe(symbols, intervalMs = this.intervalMs) {
    this.symbols = new Set(symbols);
    this.intervalMs = intervalMs;
    clearTimeout(this._debounce);
    this._debounce = setTimeout(() => this._reconnect(), 400);
  }

  _reconnect(intervalMs = this.intervalMs) {
    if (intervalMs !== this.intervalMs) this.intervalMs = intervalMs;
    this.source?.close();
    this.source = null;
    this._open();
  }

  _open() {
    const params = new URLSearchParams({
      clientId: this.clientId,
      symbols: JSON.stringify([...this.symbols]),
      intervalMs: String(this.intervalMs),
    });
    // SSE has no built-in reconnect parameters we control; the server sends
    // `retry:`, and the browser retries the same URL, which still carries the
    // subscription we need.
    const es = new EventSource(`/api/stream?${params}`);
    this.source = es;

    es.addEventListener('open', () => {
      this.connected = true;
      this._emit('open');
    });

    es.addEventListener('hello', (e) => {
      this.connected = true;
      try { this.onStatus(JSON.parse(e.data)); } catch { /* ignore */ }
    });

    es.addEventListener('quotes', (e) => {
      let payload;
      try { payload = JSON.parse(e.data); } catch { return; }
      this.lastTickAt = payload.ts ?? Date.now();
      this.onQuotes(payload);
      this._emit('tick');
    });

    es.addEventListener('status', (e) => {
      try { this.onStatus(JSON.parse(e.data)); } catch { /* ignore */ }
    });

    es.addEventListener('error', () => {
      this.connected = false;
      this._emit('error');
      // EventSource auto-reconnects, but only if the stream was closed cleanly;
      // on a hard drop it needs an explicit re-open after the retry window.
      if (es.readyState === EventSource.CLOSED) {
        setTimeout(() => {
          if (!this.source) this._open();
        }, 3000);
      }
    });
  }

  _emit(name, detail = {}) {
    this.dispatchEvent(new CustomEvent(name, { detail }));
  }
}