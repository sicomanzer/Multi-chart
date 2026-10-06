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

export function openMcpConsole({ symbol }) {
  let tools = [];
  let selected = null;
  let args = {};

  modal({
    title: 'MCP tools',
    subtitle: 'tradingview-mcp · direct tool access',
    size: 'lg',
    render(body) {
      const layout = document.createElement('div');
      layout.className = 'mcp-layout';
      layout.innerHTML = `
        <aside class="mcp-tools" data-role="list"><p class="section__hint">Loading tools…</p></aside>
        <div class="mcp-main">
          <div class="mcp-form" data-role="form"></div>
          <div class="mcp-actions">
            <button class="btn btn--primary" data-act="run">Run tool</button>
            <span class="section__hint" data-role="elapsed"></span>
          </div>
          <pre class="code-block mcp-output" data-role="output">Pick a tool on the left.</pre>
        </div>
      `;
      body.appendChild(layout);

      const listEl = layout.querySelector('[data-role="list"]');
      const formEl = layout.querySelector('[data-role="form"]');
      const outEl = layout.querySelector('[data-role="output"]');
      const elapsedEl = layout.querySelector('[data-role="elapsed"]');

      api.mcpTools().then((data) => {
        tools = data.tools ?? [];
        listEl.innerHTML = '';
        if (!tools.length) {
          listEl.innerHTML = '<p class="section__hint is-error">MCP server returned no tools.</p>';
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
        listEl.innerHTML = `<p class="section__hint is-error">${escape(err.message)}<br>Is <code>tradingview-mcp-server</code> installed?</p>`;
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
          grid.innerHTML = '<p class="section__hint">This tool takes no arguments.</p>';
        }
        formEl.appendChild(grid);
        outEl.textContent = `${tool.name} ready — press Run.`;
      }

      body.addEventListener('click', async (e) => {
        if (!e.target.closest('[data-act="run"]')) return;
        if (!selected) return;
        const payload = Object.fromEntries(Object.entries(args).filter(([, v]) => v !== '' && v !== undefined));
        outEl.textContent = 'Running…';
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
          outEl.textContent = `Error [${err.code}]: ${err.message}`;
          elapsedEl.textContent = '';
          toast(`${selected.name} failed`, { type: 'error' });
        }
      });
    },
  });
}