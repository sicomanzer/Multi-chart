/**
 * stdio JSON-RPC client for `tradingview-mcp`.
 *
 * The MCP server is a Python FastMCP process speaking JSON-RPC 2.0 over
 * stdin/stdout. This module owns its lifecycle:
 *   - spawn once, lazily, on first tool call
 *   - MCP handshake (initialize -> notifications/initialized)
 *   - newline-delimited JSON framing on stdout
 *   - request queue with per-request timeout, so a slow screener can't wedge
 *     the event loop or leak pending promises
 *   - auto-restart with backoff if the process dies
 *
 * stdout carries protocol frames only; Python's logging goes to stderr and is
 * kept out of the parser entirely (it is captured for diagnostics).
 */
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';
import { delimiter } from 'node:path';

const PROTOCOL_VERSION = '2024-11-05';

const DEFAULT_CONFIG = {
  // `python -m tradingview_mcp.server` avoids depending on a console script
  // being on PATH (pip installs it to a per-user Scripts dir on Windows).
  command: process.env.TVMCP_PYTHON || 'python',
  args: ['-m', 'tradingview_mcp.server'],
  cwd: process.cwd(),
  requestTimeoutMs: 60_000,
  maxQueue: 64,
  restartDelayMs: 2_000,
  maxRestartDelayMs: 30_000,
  maxStderrLines: 40,
};

/** Single error for every failure mode, with a machine-readable code. */
export class McpError extends Error {
  constructor(code, message, detail) {
    super(message);
    this.name = 'McpError';
    this.code = code;
    this.detail = detail;
  }
}

export class McpClient extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.child = null;
    this.ready = false;
    this.connected = false;
    this.lastError = null;
    this.lastStderr = [];
    this.toolCache = null;
    this.restartAttempts = 0;
    this.restartTimer = null;
    this.stopping = false;

    this.nextId = 1;
    this.pending = new Map();
    this.stdoutBuffer = '';
    this.queue = [];
    this.inFlight = 0;
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  /** Spawn if needed and complete the MCP handshake. Safe to call repeatedly. */
  async ensureStarted() {
    if (this.ready) return;
    if (this._starting) return this._starting;
    this._starting = this._start().finally(() => {
      this._starting = null;
    });
    return this._starting;
  }

  async _start() {
    this.stopping = false;
    const { command, args, cwd } = this.config;

    try {
      const child = spawn(command, args, {
        cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
        env: { ...process.env, PYTHONUNBUFFERED: '1' },
      });
      this.child = child;

      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk) => this._onStdout(chunk));
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (chunk) => this._onStderr(chunk));

      child.on('error', (err) => {
        this.lastError = `spawn failed: ${err.message}`;
        this.emit('status', this.status());
        this._failAllPending(new McpError('SPAWN_FAILED', this.lastError));
      });

      child.on('exit', (code, signal) => {
        this.connected = false;
        this.ready = false;
        this.child = null;
        if (this.stopping) return;
        const reason = `MCP server exited (code=${code}, signal=${signal})`;
        this.lastError = reason;
        this._failAllPending(new McpError('SERVER_EXITED', reason));
        this.emit('status', this.status());
        this._scheduleRestart();
      });

      await this._send('initialize', {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: 'multi-chart-trading-desk', version: '1.0.0' },
      });

      this._notify('notifications/initialized');
      this.connected = true;
      this.ready = true;
      this.restartAttempts = 0;
      this.lastError = null;
      this.emit('status', this.status());
      this._pump();
    } catch (err) {
      this.ready = false;
      this.connected = false;
      this.lastError = err.message;
      this.emit('status', this.status());
      throw err;
    }
  }

  _scheduleRestart() {
    if (this.stopping || this.restartTimer) return;
    const delay = Math.min(
      this.config.restartDelayMs * 2 ** this.restartAttempts,
      this.config.maxRestartDelayMs,
    );
    this.restartAttempts += 1;
    this.emit('status', this.status());
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      this.ensureStarted().catch(() => {
        /* _scheduleRestart already queued the next attempt via the exit path */
      });
    }, delay);
    this.restartTimer.unref?.();
  }

  async stop() {
    this.stopping = true;
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.restartTimer = null;
    this._failAllPending(new McpError('STOPPED', 'client stopped'));
    const child = this.child;
    this.child = null;
    this.ready = false;
    this.connected = false;
    if (child) {
      child.stdin?.end();
      child.kill();
    }
  }

  status() {
    return {
      connected: this.connected,
      command: `${this.config.command} ${this.config.args.join(' ')}`,
      pid: this.child?.pid ?? null,
      queued: this.queue.length,
      inFlight: this.inFlight,
      toolCount: this.toolCache?.length ?? null,
      restartAttempts: this.restartAttempts,
      lastError: this.lastError,
      stderr: this.lastStderr.slice(-5),
    };
  }

  // ── Framing ────────────────────────────────────────────────────────────────

  _onStdout(chunk) {
    this.stdoutBuffer += chunk;
    let nl;
    while ((nl = this.stdoutBuffer.indexOf('\n')) >= 0) {
      const line = this.stdoutBuffer.slice(0, nl).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(nl + 1);
      if (!line) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        // Not protocol traffic (shouldn't happen — stderr is separate).
        continue;
      }
      this._onMessage(msg);
    }
  }

  _onStderr(chunk) {
    for (const line of String(chunk).split(/\r?\n/)) {
      const t = line.trim();
      if (!t) continue;
      this.lastStderr.push(t);
      if (this.lastStderr.length > this.config.maxStderrLines) this.lastStderr.shift();
    }
  }

  _onMessage(msg) {
    if (msg.id === undefined || msg.id === null) return; // notification / server request we ignore
    const entry = this.pending.get(msg.id);
    if (!entry) return;

    if (msg.error) {
      entry.reject(new McpError('RPC_ERROR', msg.error.message || 'MCP error', msg.error.data));
    } else {
      entry.resolve(msg.result);
    }
  }

  _failAllPending(err) {
    for (const [, entry] of this.pending) entry.reject(err);
    this.pending.clear();
    for (const job of this.queue) job.reject(err);
    this.queue = [];
    this.inFlight = 0;
  }

  _send(method, params) {
    return new Promise((resolve, reject) => {
      const child = this.child;
      if (!child?.stdin?.writable) {
        reject(new McpError('NOT_CONNECTED', 'MCP server is not running'));
        return;
      }
      const id = this.nextId++;
      const payload = JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n';
      this.pending.set(id, { resolve, reject, timer: null });

      const timer = setTimeout(() => {
        if (!this.pending.has(id)) return;
        this.pending.delete(id);
        reject(new McpError('TIMEOUT', `${method} timed out after ${this.config.requestTimeoutMs}ms`));
      }, this.config.requestTimeoutMs);
      timer.unref?.();

      this.pending.get(id).timer = timer;
      child.stdin.write(payload, (err) => {
        if (!err) return;
        clearTimeout(timer);
        this.pending.delete(id);
        reject(new McpError('WRITE_FAILED', err.message));
      });
    });
  }

  _notify(method, params) {
    const child = this.child;
    if (!child?.stdin?.writable) return;
    try {
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
    } catch {
      /* process going away; the exit handler takes over */
    }
  }

  // ── Queue ──────────────────────────────────────────────────────────────────

  /**
   * Serialised request dispatch. MCP tool calls are IO-bound and the Python
   * server throttles some of them, so one-at-a-time keeps upstream happy and
   * makes rate-limit behaviour predictable.
   */
  _enqueue(fn) {
    return new Promise((resolve, reject) => {
      if (this.queue.length >= this.config.maxQueue) {
        reject(new McpError('QUEUE_FULL', 'too many queued MCP requests'));
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

  // ── Public API ─────────────────────────────────────────────────────────────

  async listTools({ refresh = false } = {}) {
    if (this.toolCache && !refresh) return this.toolCache;
    await this.ensureStarted();
    const result = await this._enqueue(() => this._send('tools/list', {}));
    this.toolCache = (result?.tools ?? []).map((t) => ({
      name: t.name,
      description: (t.description || '').split('\n')[0].trim(),
      params: Object.entries(t.inputSchema?.properties ?? {}).map(([id, spec]) => ({
        id,
        type: spec.type,
        required: (t.inputSchema?.required ?? []).includes(id),
        default: spec.default,
        description: spec.description ?? spec.title ?? '',
        enum: spec.enum,
      })),
    }));
    return this.toolCache;
  }

  /**
   * Invoke a tool. MCP returns `{content:[{type:'text',text:'<json>'}]}`;
   * servers built on this one also attach a structured `result` via
   * outputSchema, so prefer that and fall back to parsing the text blob.
   */
  async callTool(name, args = {}, { timeoutMs } = {}) {
    await this.ensureStarted();
    const prevTimeout = this.config.requestTimeoutMs;
    if (timeoutMs) this.config.requestTimeoutMs = timeoutMs;
    try {
      const res = await this._enqueue(() =>
        this._send('tools/call', { name, arguments: args }),
      );
      if (res?.isError) {
        throw new McpError('TOOL_ERROR', `${name} returned an error`, this._text(res));
      }
      return this._decode(res);
    } finally {
      this.config.requestTimeoutMs = prevTimeout;
    }
  }

  _text(res) {
    return (res?.content ?? [])
      .filter((c) => c.type === 'text')
      .map((c) => c.text)
      .join('\n');
  }

  _decode(res) {
    const structured = res?.structuredContent?.result;
    if (structured !== undefined) return structured;

    const text = this._text(res);
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      return text; // plain-text tool output (e.g. exchanges://list)
    }
  }

  /** Convenience wrapper for a health probe. Never throws. */
  async ping() {
    const started = Date.now();
    try {
      await this.callTool('yahoo_price', { symbol: 'AAPL' }, { timeoutMs: 20_000 });
      return { ok: true, ms: Date.now() - started };
    } catch (err) {
      return { ok: false, ms: Date.now() - started, error: err.message, code: err.code };
    }
  }
}

/** Best-effort resolution of the Python command at boot. */
export function detectPython() {
  const candidates = [];
  if (process.env.TVMCP_PYTHON) candidates.push(process.env.TVMCP_PYTHON);
  candidates.push('python', 'python3', 'py');

  const localPython = process.platform === 'win32'
    ? 'C:\\Python313\\python.exe'
    : '/usr/bin/python3';

  return candidates.find((c) => {
    if (c.includes(delimiter) || c.includes('/')) return existsSync(c);
    return true;
  }) ?? localPython;
}