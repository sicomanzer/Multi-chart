/**
 * UI primitives: modal shell + schema-driven form builder.
 *
 * The indicator editor is generated from the catalog that the server sends, so
 * adding a parameter to an indicator in `server/indicator-catalog.js` gives it a
 * form control with the right widget, range and default — no HTML written twice.
 */

let openCount = 0;

/**
 * @param {object} opts
 * @param {string} opts.title
 * @param {string} [opts.subtitle]
 * @param {(body: HTMLElement) => void} opts.render
 * @param {(footer: HTMLElement, api: {close:Function}) => void} [opts.footer]
 * @param {string} [opts.size] 'sm' | 'md' | 'lg'
 */
export function modal({ title, subtitle = '', render, footer, size = 'md', onClose }) {
  const root = document.createElement('div');
  root.className = `modal modal--${size}`;
  root.innerHTML = `
    <div class="modal__backdrop" data-close></div>
    <div class="modal__panel" role="dialog" aria-modal="true">
      <header class="modal__head">
        <div>
          <h2>${escape(title)}</h2>
          ${subtitle ? `<p>${escape(subtitle)}</p>` : ''}
        </div>
        <button class="icon-btn" data-close title="Close">✕</button>
      </header>
      <div class="modal__body"></div>
      <footer class="modal__foot"></footer>
    </div>
  `;

  const body = root.querySelector('.modal__body');
  const foot = root.querySelector('.modal__foot');
  const api = { close, root, body };

  render?.(body);

  function close(result) {
    root.classList.add('is-closing');
    document.removeEventListener('keydown', onKey);
    setTimeout(() => {
      root.remove();
      openCount = Math.max(0, openCount - 1);
      if (openCount === 0) document.body.classList.remove('is-modal-open');
      onClose?.(result);
    }, 120);
  }

  function onKey(e) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    }
  }

  root.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) close();
  });
  document.addEventListener('keydown', onKey);
  footer?.(foot, { close });
  document.getElementById('modal-root').appendChild(root);
  document.body.classList.add('is-modal-open');
  openCount += 1;

  // Focus the first meaningful control so keyboard users land in the form.
  requestAnimationFrame(() => {
    const first = root.querySelector('input, select, textarea, button.btn--primary');
    first?.focus();
  });

  return api;
}

export function escape(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

/**
 * Render a form from a parameter schema.
 * @param {HTMLElement} host
 * @param {Array} schema catalog `params` array
 * @param {object} values current values
 * @returns {{ read: () => object, reset: () => void, inputs: Map<string, HTMLElement> }}
 */
export function buildForm(host, schema, values) {
  const inputs = new Map();
  const current = { ...values };

  host.innerHTML = '';
  for (const p of schema) {
    const wrap = document.createElement('label');
    wrap.className = `field field--${p.type}`;
    const id = `f_${p.id}_${Math.random().toString(36).slice(2, 6)}`;
    const labelText = p.label ?? p.id;

    let control;
    if (p.type === 'bool') {
      wrap.innerHTML = `<input type="checkbox" id="${id}"><span>${escape(labelText)}</span>`;
      control = wrap.querySelector('input');
      control.checked = Boolean(current[p.id] ?? p.default);
      control.addEventListener('change', () => { current[p.id] = control.checked; });
    } else if (p.type === 'select') {
      const options = p.options.map((o) => (typeof o === 'string'
        ? { value: o, label: o }
        : o));
      wrap.innerHTML = `<span class="field__label">${escape(labelText)}</span>
        <select id="${id}">${options.map((o) => `<option value="${escape(o.value)}">${escape(p.labels?.[o.value] ?? o.label ?? o.value)}</option>`).join('')}</select>`;
      control = wrap.querySelector('select');
      control.value = String(current[p.id] ?? p.default);
      control.addEventListener('change', () => { current[p.id] = control.value; });
    } else if (p.type === 'color') {
      wrap.innerHTML = `<span class="field__label">${escape(labelText)}</span>
        <span class="field__color"><input type="color" id="${id}"><input type="text" class="field__hex" spellcheck="false"></span>`;
      const colorInput = wrap.querySelector('input[type=color]');
      const hexInput = wrap.querySelector('.field__hex');
      // rgba() colours can't round-trip through <input type=color>; show the
      // hex field for those and keep the colour input as a convenience.
      const isRgba = /^rgba/.test(String(current[p.id] ?? p.default));
      colorInput.value = toHex(String(current[p.id] ?? p.default));
      hexInput.value = String(current[p.id] ?? p.default);
      colorInput.addEventListener('input', () => {
        current[p.id] = colorInput.value;
        hexInput.value = colorInput.value;
      });
      hexInput.addEventListener('input', () => {
        current[p.id] = hexInput.value;
        if (!isRgba && /^#[0-9a-f]{6}$/i.test(hexInput.value)) colorInput.value = hexInput.value;
      });
      control = colorInput;
      inputs.set(p.id, { el: hexInput, kind: 'color' });
    } else {
      const step = p.type === 'int' ? 1 : (p.step ?? 0.01);
      wrap.innerHTML = `<span class="field__label">${escape(labelText)}</span>
        <input type="number" id="${id}" step="${step}"${p.min !== undefined ? ` min="${p.min}"` : ''}${p.max !== undefined ? ` max="${p.max}"` : ''}>`;
      control = wrap.querySelector('input');
      control.value = current[p.id] ?? p.default;
      control.addEventListener('input', () => {
        const raw = control.value;
        current[p.id] = p.type === 'int' ? parseInt(raw, 10) : parseFloat(raw);
      });
    }

    if (!inputs.has(p.id)) inputs.set(p.id, { el: control, kind: p.type });
    if (p.hint) {
      const hint = document.createElement('span');
      hint.className = 'field__hint';
      hint.textContent = p.hint;
      wrap.appendChild(hint);
    }
    host.appendChild(wrap);
  }

  return {
    inputs,
    read: () => ({ ...current }),
  };
}

function toHex(value) {
  const s = String(value ?? '');
  if (/^#[0-9a-f]{6}$/i.test(s)) return s;
  const m = /^rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)/.exec(s);
  if (m) {
    return `#${[m[1], m[2], m[3]]
      .map((n) => Math.round(Number(n)).toString(16).padStart(2, '0'))
      .join('')}`;
  }
  return '#2962ff';
}

/** Small helper: a labelled section inside a modal body. */
export function section(title, hint = '') {
  const el = document.createElement('section');
  el.className = 'section';
  el.innerHTML = `<h3 class="section__title">${escape(title)}</h3>${hint ? `<p class="section__hint">${escape(hint)}</p>` : ''}`;
  return el;
}

export function fieldRow(label, hint, control) {
  const wrap = document.createElement('label');
  wrap.className = 'field field--inline';
  wrap.innerHTML = `<span class="field__label">${escape(label)}</span>${hint ? `<span class="field__hint">${escape(hint)}</span>` : ''}`;
  wrap.appendChild(control);
  return wrap;
}

export function checkbox(label, checked, onChange) {
  const wrap = document.createElement('label');
  wrap.className = 'field field--bool';
  wrap.innerHTML = `<input type="checkbox"><span>${escape(label)}</span>`;
  const input = wrap.querySelector('input');
  input.checked = Boolean(checked);
  input.addEventListener('change', () => onChange(input.checked));
  return wrap;
}

export function selectField(label, value, options, onChange) {
  const wrap = document.createElement('label');
  wrap.className = 'field field--select';
  wrap.innerHTML = `<span class="field__label">${escape(label)}</span>
    <select>${options.map((o) => {
      const val = typeof o === 'string' ? o : o.value;
      const txt = typeof o === 'string' ? o : o.label;
      return `<option value="${escape(val)}"${String(val) === String(value) ? ' selected' : ''}>${escape(txt)}</option>`;
    }).join('')}</select>`;
  wrap.querySelector('select').addEventListener('change', (e) => onChange(e.target.value));
  return wrap;
}

/** Toast notifications for background failures (data load, MCP errors). */
export function toast(message, { type = 'info', timeout = 4500 } = {}) {
  const root = document.getElementById('toast-root');
  const el = document.createElement('div');
  el.className = `toast toast--${type}`;
  el.innerHTML = `<span>${escape(message)}</span>`;
  const close = () => {
    el.classList.add('is-leaving');
    setTimeout(() => el.remove(), 200);
  };
  el.addEventListener('click', close);
  root.appendChild(el);
  if (timeout) setTimeout(close, timeout);
  return close;
}