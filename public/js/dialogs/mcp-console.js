/**
 * MCP console: run any of the tradingview-mcp tools from the browser.
 *
 * The board only needs two of them (`stock_prices` behind the quote stream),
 * but the server exposes the whole 37-tool surface through a passthrough route.
 * This panel is how you reach the rest — screeners, technical analysis,
 * backtests, sentiment, news — without leaving the dashboard.
 *
 * Argument forms are generated from the tool's advertised input schema.
 */
import { modal, escape, toast } from '../ui.js';
import { api } from '../api.js';
import { t, timeString, getLang } from '../i18n.js';

/**
 * How often the status panel refreshes while the dialog is open.
 *
 * It is a real refresh, not a repaint: the health call includes the MCP ping,
 * so the latency and the connection state are measured rather than remembered.
 * Twenty seconds is slow enough not to compete with a screen run and fast
 * enough that a source that went quiet is visible while the reader is looking.
 */
const STATUS_REFRESH_MS = 20_000;

const toMillis = (ts) => {
  if (ts == null || ts === '') return null;
  const ms = typeof ts === 'number' ? ts : Date.parse(ts);
  return Number.isFinite(ms) ? ms : null;
};

function statusClock(ts) {
  const ms = toMillis(ts);
  return ms == null ? t('mcp.status.na') : timeString(new Date(ms));
}

function statusDate(ts) {
  const ms = toMillis(ts);
  if (ms == null) return t('mcp.status.na');
  return new Date(ms).toLocaleDateString(getLang() === 'th' ? 'th-TH' : 'en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
  });
}

function statusDuration(ms) {
  if (!Number.isFinite(Number(ms)) || Number(ms) < 0) return t('mcp.status.na');
  const sec = Math.round(Number(ms) / 1000);
  if (sec < 90) return `${sec}s`;
  const min = Math.round(sec / 60);
  if (min < 90) return `${min}m`;
  const hr = Math.round(min / 60);
  if (hr < 36) return `${hr}h`;
  return `${Math.round(hr / 24)}d`;
}

function statusAgo(ts, now = Date.now()) {
  const ms = toMillis(ts);
  if (ms == null) return t('mcp.status.na');
  const age = Math.max(0, now - ms);
  if (age < 10_000) return t('stat.justNow');
  const sec = Math.round(age / 1000);
  if (sec < 60) return t('stat.secsAgo', { n: sec });
  const min = Math.round(sec / 60);
  if (min < 60) return t('mcp.status.minsAgo', { n: min });
  const hr = Math.round(min / 60);
  if (hr < 48) return t('mcp.status.hoursAgo', { n: hr });
  return t('mcp.status.daysAgo', { n: Math.round(hr / 24) });
}

/** Local calendar day, matching the server's history date, not UTC. */
function statusDay(ts = Date.now()) {
  const ms = toMillis(ts);
  if (ms == null) return null;
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function statusAgeState(ts, freshMs, empty = 'idle', now = Date.now()) {
  const ms = toMillis(ts);
  if (ms == null) return empty;
  return now - ms <= freshMs ? 'on' : 'warn';
}

const STATUS_LABEL = {
  on: 'mcp.status.live',
  warn: 'mcp.status.stale',
  off: 'mcp.status.offline',
  idle: 'mcp.status.idle',
};

function statusCard({ label, state, value, lines = [] }) {
  const details = lines
    .filter(Boolean)
    .map((line) => `<div class="mcp-status__detail">${escape(line)}</div>`)
    .join('');
  return `<article class="mcp-status__card is-${state}">
    <div class="mcp-status__card-head">
      <span class="mcp-status__dot is-${state}"></span>
      <span class="mcp-status__label">${escape(label)}</span>
      <span class="mcp-status__state">${escape(t(STATUS_LABEL[state] ?? 'mcp.status.na'))}</span>
    </div>
    <div class="mcp-status__value">${escape(value)}</div>
    ${details}
  </article>`;
}

/**
 * Turn the health payload into the nine cards the reader needs.
 *
 * The states are intentionally conservative: green means "the last refresh is
 * recent", amber means "there is data but it is old or the last attempt
 * failed", and red is reserved for a source that is actually unavailable.
 * A stale upstream price can never be made live by this panel, so the cards
 * always carry the timestamp beside the light.
 */
function statusCards(h) {
  const server = h.server ?? {};
  const mcp = h.mcp ?? {};
  const quotes = h.realtime ?? {};
  const candles = h.candles ?? {};
  const fundamentals = h.fundamentals ?? {};
  const annual = h.annualHistory ?? {};
  const dataset = annual.dataset ?? {};
  const daily = h.history ?? {};
  const screener = h.screener ?? null;
  const backtest = h.backtest ?? {};
  // Use the server's clock for "ago" and for "today": a laptop in another
  // timezone must not turn a source that is current on the server amber.
  const now = toMillis(server.now) ?? Date.now();
  const serverToday = typeof server.today === 'string' ? server.today : statusDay(now);
  const cards = [];

  const commit = server.commit ? String(server.commit).slice(0, 7) : t('mcp.status.unknown');
  cards.push(statusCard({
    label: t('mcp.status.server'),
    state: h.status === 'ok' ? 'on' : 'off',
    value: server.uptimeSeconds != null
      ? statusDuration(server.uptimeSeconds * 1000)
      : t('mcp.status.na'),
    lines: [
      `${t('mcp.status.now')}: ${statusClock(server.now ?? now)}`,
      `${t('mcp.status.commit')}: ${commit}`,
    ],
  }));

  const ping = mcp.ping;
  const mcpState = ping?.ok === false
    ? 'warn'
    : (ping?.ok === true || mcp.connected ? 'on' : 'off');
  const mcpValue = ping && ping.ms != null
    ? t('mcp.status.pingMs', { ms: ping.ms })
    : (mcp.connected ? t('mcp.status.connected') : t('mcp.status.offline'));
  cards.push(statusCard({
    label: t('mcp.status.mcp'),
    state: mcpState,
    value: mcpValue,
    lines: [
      `${mcp.toolCount == null ? t('mcp.status.na') : mcp.toolCount} ${t('mcp.status.tools')} · ${mcp.queued ?? 0} ${t('mcp.status.queued')}`,
      mcp.pid ? `pid ${mcp.pid}` : '',
      ping?.error ? `${t('mcp.status.error')}: ${ping.error}` : '',
      !ping?.error && mcp.lastError ? `${t('mcp.status.error')}: ${mcp.lastError}` : '',
    ],
  }));

  const interval = Number(quotes.intervalMs) || 20_000;
  const quotesState = !quotes.clients
    ? 'idle'
    : statusAgeState(quotes.lastTickAt, Math.max(interval * 3, 60_000), 'idle', now);
  cards.push(statusCard({
    label: t('mcp.status.quotes'),
    state: quotesState,
    value: quotes.lastTickAt ? statusAgo(quotes.lastTickAt, now) : t('mcp.status.noTicks'),
    lines: [
      `${quotes.watchedSymbols ?? 0} ${t('mcp.status.symbols')} · ${quotes.clients ?? 0} ${t('mcp.status.clients')}`,
      `${t('mcp.status.every')} ${statusDuration(interval)} · ${quotes.tickCount ?? 0} ${t('mcp.status.ticks')}`,
      quotes.lastTickAt ? `${t('mcp.status.lastTick')}: ${statusClock(quotes.lastTickAt)}` : '',
      quotes.errorCount ? `${t('mcp.status.error')}: ${quotes.errorCount}` : '',
    ],
  }));

  const dailyCache = candles.caches?.daily ?? {};
  const intradayCache = candles.caches?.intraday ?? {};
  cards.push(statusCard({
    label: t('mcp.status.candles'),
    state: statusAgeState(candles.lastFetchAt, 5 * 60_000, 'idle', now),
    value: candles.lastFetchAt ? statusAgo(candles.lastFetchAt, now) : t('mcp.status.noFetch'),
    lines: [
      `${dailyCache.entries ?? 0} ${t('mcp.status.daily')} · ${intradayCache.entries ?? 0} ${t('mcp.status.intraday')}`,
      `${t('mcp.status.ttl')} ${statusDuration(dailyCache.ttlMs)} / ${statusDuration(intradayCache.ttlMs)}`,
      candles.lastFetchAt
        ? `${t('mcp.status.lastFetch')}: ${statusClock(candles.lastFetchAt)}${candles.lastSymbol ? ` · ${candles.lastSymbol}${candles.lastTimeframe ? ` ${candles.lastTimeframe}` : ''}` : ''}`
        : '',
    ],
  }));

  const lastSuccessAt = toMillis(fundamentals.lastSuccessAt);
  const lastErrorAt = toMillis(fundamentals.lastErrorAt);
  const freshError = Boolean(
    fundamentals.lastError
    && (!lastSuccessAt || (lastErrorAt != null && lastErrorAt > lastSuccessAt)),
  );
  const fundamentalsState = !fundamentals.available
    ? 'off'
    : (fundamentals.ready ? (freshError ? 'warn' : 'on') : 'warn');
  const fundamentalsValue = fundamentals.ready
    ? (lastSuccessAt ? statusAgo(lastSuccessAt, now) : t('mcp.status.ready'))
    : (fundamentals.available ? t('mcp.status.starting') : t('mcp.status.unavailable'));
  cards.push(statusCard({
    label: t('mcp.status.fundamentals'),
    state: fundamentalsState,
    value: fundamentalsValue,
    lines: [
      `${fundamentals.cached ?? 0} ${t('mcp.status.cached')} · ${t('mcp.status.ttl')} ${statusDuration(fundamentals.ttlMs)}`,
      fundamentals.lastFetchAt ? `${t('mcp.status.lastFetch')}: ${statusClock(fundamentals.lastFetchAt)}` : '',
      freshError ? `${t('mcp.status.error')}: ${fundamentals.lastError}` : '',
    ],
  }));

  const annualState = dataset.loaded ? (dataset.symbols > 0 ? 'on' : 'warn') : 'off';
  const annualValue = dataset.generatedAt
    ? statusDate(dataset.generatedAt)
    : (dataset.loaded ? t('mcp.status.loaded') : t('mcp.status.unavailable'));
  cards.push(statusCard({
    label: t('mcp.status.annual'),
    state: annualState,
    value: annualValue,
    lines: [
      `${dataset.symbols ?? 0} ${t('mcp.status.symbols')} · ${dataset.years ?? '—'} ${t('mcp.status.years')}`,
      dataset.source ? `${t('mcp.status.source')}: ${dataset.source}` : '',
    ],
  }));

  const historyState = !daily.lastDate
    ? 'idle'
    : (daily.lastDate === serverToday ? 'on' : 'warn');
  cards.push(statusCard({
    label: t('mcp.status.dailyHistory'),
    state: historyState,
    value: daily.lastDate ?? t('mcp.status.noData'),
    lines: [
      `${daily.points ?? 0} ${t('mcp.status.points')} · ${daily.symbols ?? 0} ${t('mcp.status.symbols')}`,
      daily.lastWriteAt ? `${t('mcp.status.lastWrite')}: ${statusClock(daily.lastWriteAt)}` : '',
      daily.lastError ? `${t('mcp.status.error')}: ${daily.lastError}` : '',
    ],
  }));

  const screenState = !screener
    ? 'idle'
    : ((screener.day ?? statusDay(screener.at)) === serverToday ? 'on' : 'warn');
  cards.push(statusCard({
    label: t('mcp.status.screener'),
    state: screenState,
    value: screener ? statusAgo(screener.at, now) : t('mcp.status.noRun'),
    lines: screener ? [
      `${screener.matched ?? 0} ${t('mcp.status.matched')} · ${screener.screened ?? 0}/${screener.symbols ?? 0} ${t('mcp.status.screened')}`,
      `${screener.tookMs ?? 0} ms${screener.preset ? ` · ${screener.preset}` : ''}`,
      screener.asOf ? `${t('mcp.status.asOf')}: ${statusClock(screener.asOf)}` : '',
    ] : [],
  }));

  const backtestState = backtest.running
    ? 'warn'
    : (!backtest.at ? 'idle' : (backtest.fresh ? 'on' : 'warn'));
  cards.push(statusCard({
    label: t('mcp.status.backtest'),
    state: backtestState,
    value: backtest.running
      ? t('mcp.status.measuring')
      : (backtest.at ? statusAgo(backtest.at, now) : t('mcp.status.noRun')),
    lines: [
      `${backtest.rules ?? 0} ${t('mcp.status.rules')} · ${(backtest.presets ?? []).length} ${t('mcp.status.presets')}`,
      backtest.at ? `${t('mcp.status.measured')}: ${statusClock(backtest.at)}` : '',
    ],
  }));

  return cards.join('');
}

export function openMcpConsole({ symbol }) {
  let tools = [];
  let selected = null;
  let args = {};
  let statusTimer = null;
  let closed = false;

  modal({
    title: t('mcp.title'),
    subtitle: t('mcp.sub'),
    size: 'lg',
    onClose() {
      closed = true;
      if (statusTimer) clearInterval(statusTimer);
      statusTimer = null;
    },
    render(body) {
      const statusEl = document.createElement('section');
      statusEl.className = 'mcp-status';
      statusEl.innerHTML = `
        <div class="mcp-status__head">
          <div>
            <h3 class="section__title">${escape(t('mcp.status.title'))}</h3>
            <p class="section__hint">${escape(t('mcp.status.sub'))}</p>
          </div>
          <div class="mcp-status__actions">
            <span class="mcp-status__updated" data-role="status-updated" aria-live="polite">${escape(t('mcp.status.checking'))}</span>
            <button class="btn btn--sm" type="button" data-act="refresh-status">${escape(t('mcp.status.refresh'))}</button>
          </div>
        </div>
        <div class="mcp-status__grid" data-role="status-grid">
          <p class="section__hint">${escape(t('mcp.status.checking'))}</p>
        </div>
        <p class="mcp-status__note">${escape(t('mcp.status.note'))}</p>
      `;
      body.appendChild(statusEl);

      const layout = document.createElement('div');
      layout.className = 'mcp-layout';
      layout.innerHTML = `
        <aside class="mcp-tools" data-role="list"><p class="section__hint">${escape(t('mcp.loading'))}</p></aside>
        <div class="mcp-main">
          <div class="mcp-form" data-role="form"></div>
          <div class="mcp-actions">
            <button class="btn btn--primary" data-act="run">${escape(t('mcp.run'))}</button>
            <span class="section__hint" data-role="elapsed"></span>
          </div>
          <pre class="code-block mcp-output" data-role="output">${escape(t('mcp.pick'))}</pre>
        </div>
      `;
      body.appendChild(layout);

      const listEl = layout.querySelector('[data-role="list"]');
      const formEl = layout.querySelector('[data-role="form"]');
      const outEl = layout.querySelector('[data-role="output"]');
      const elapsedEl = layout.querySelector('[data-role="elapsed"]');
      const statusGrid = statusEl.querySelector('[data-role="status-grid"]');
      const statusUpdated = statusEl.querySelector('[data-role="status-updated"]');
      const statusRefresh = statusEl.querySelector('[data-act="refresh-status"]');
      let statusBusy = false;
      let lastHealth = null;

      async function loadStatus() {
        if (statusBusy || closed) return;
        statusBusy = true;
        statusRefresh.disabled = true;
        statusEl.classList.add('is-loading');
        try {
          const health = await api.health(true);
          if (closed) return;
          lastHealth = health;
          statusGrid.innerHTML = statusCards(health);
          statusUpdated.textContent = t('mcp.status.checked', {
            time: statusClock(health.server?.now ?? Date.now()),
          });
        } catch (err) {
          if (closed) return;
          statusUpdated.textContent = t('mcp.status.loadError', { msg: err.message });
          if (!lastHealth) {
            statusGrid.innerHTML = `<p class="section__hint is-error">${escape(t('mcp.status.loadError', { msg: err.message }))}</p>`;
          }
        } finally {
          statusBusy = false;
          statusEl.classList.remove('is-loading');
          statusRefresh.disabled = false;
        }
      }

      statusRefresh.addEventListener('click', loadStatus);
      loadStatus();
      statusTimer = setInterval(loadStatus, STATUS_REFRESH_MS);

      api.mcpTools().then((data) => {
        tools = data.tools ?? [];
        listEl.innerHTML = '';
        if (!tools.length) {
          listEl.innerHTML = `<p class="section__hint is-error">${escape(t('mcp.noTools'))}</p>`;
          return;
        }
        for (const tool of tools) {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'mcp-tool';
          btn.innerHTML = `<b>${escape(tool.name)}</b><span>${escape(tool.description)}</span>`;
          btn.addEventListener('click', () => select(tool));
          listEl.appendChild(btn);
        }
        const preferred = tools.find((t) => t.name === 'stock_screener') ?? tools[0];
        select(preferred);
      }).catch((err) => {
        listEl.innerHTML = `<p class="section__hint is-error">${escape(err.message)}<br>${t('mcp.noToolsErr')}</p>`;
      });

      function select(tool) {
        selected = tool;
        listEl.querySelectorAll('.mcp-tool').forEach((n) => n.classList.remove('is-active'));
        formEl.dataset.tool = tool.name;
        formEl.innerHTML = `<h3 class="section__title">${escape(tool.name)}</h3>
          <p class="section__hint">${escape(tool.description)}</p>`;

        args = {};
        const grid = document.createElement('div');
        grid.className = 'form-grid';

        for (const p of tool.params) {
          const wrap = document.createElement('label');
          wrap.className = `field field--${p.type}`;

          if (p.type === 'boolean') {
            wrap.innerHTML = `<input type="checkbox"><span>${escape(p.id)}${p.required ? ' *' : ''}</span>`;
            const input = wrap.querySelector('input');
            input.checked = Boolean(p.default);
            input.addEventListener('change', () => { args[p.id] = input.checked; });
          } else {
            wrap.innerHTML = `<span class="field__label">${escape(p.id)}${p.required ? ' *' : ''}
              ${p.description ? `<em class="field__hint">${escape(p.description)}</em>` : ''}</span>`;
            const options = p.enum
              ? p.enum.map((v) => ({ value: String(v), label: String(v) }))
              : null;
            let input;
            if (options) {
              input = document.createElement('select');
              input.innerHTML = options
                .map((o) => `<option value="${escape(o.value)}"${String(p.default) === o.value ? ' selected' : ''}>${escape(o.label)}</option>`)
                .join('');
            } else {
              input = document.createElement('input');
              input.type = p.type === 'integer' || p.type === 'number' ? 'number' : 'text';
              if (p.type === 'integer') input.step = '1';
            }
            // Prefill the symbol-bearing tools with the focused chart's ticker.
            if (p.default !== undefined && p.default !== null) input.value = String(p.default);
            else if (['symbol', 'tickers'].includes(p.id) && symbol) input.value = symbol;

            input.addEventListener('input', () => {
              args[p.id] = p.type === 'integer' || p.type === 'number'
                ? Number(input.value)
                : input.value;
            });
            input.addEventListener('change', () => {
              args[p.id] = p.type === 'integer' || p.type === 'number'
                ? Number(input.value)
                : input.value;
            });
            wrap.appendChild(input);
          }
          grid.appendChild(wrap);
        }

        if (!tool.params.length) {
          grid.innerHTML = `<p class="section__hint">${escape(t('mcp.noArgs'))}</p>`;
        }
        formEl.appendChild(grid);
        outEl.textContent = t('mcp.ready', { name: tool.name });
      }

      body.addEventListener('click', async (e) => {
        if (!e.target.closest('[data-act="run"]')) return;
        if (!selected) return;
        const payload = Object.fromEntries(Object.entries(args).filter(([, v]) => v !== '' && v !== undefined));
        outEl.textContent = t('mcp.running');
        outEl.classList.add('is-loading');
        const started = performance.now();
        try {
          const res = await api.mcpCall(selected.name, payload, 60_000);
          const ms = Math.round(performance.now() - started);
          outEl.classList.remove('is-loading');
          outEl.textContent = JSON.stringify(res.data, null, 2) ?? String(res.data);
          elapsedEl.textContent = `${ms} ms`;
        } catch (err) {
          outEl.classList.remove('is-loading');
          outEl.textContent = t('mcp.error', { code: err.code, msg: err.message });
          elapsedEl.textContent = '';
          toast(t('mcp.failed', { name: selected.name }), { type: 'error' });
        }
      });
    },
  });
}