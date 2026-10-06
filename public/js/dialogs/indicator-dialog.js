/**
 * Indicator picker + per-instance editor.
 *
 * The editor is generated from the server catalog, so every parameter declared
 * in `server/indicator-catalog.js` shows up as the right control with its own
 * range, default and colour swatch. Two fields sit outside the catalog because
 * they belong to the *instance* rather than the calculation: pane placement and
 * pane height.
 */
import { modal, buildForm, section, selectField, escape, toast } from '../ui.js';

export function openIndicatorPicker({ catalog, groups, onAdd, current = [] }) {
  // Accept either the catalog array or the board's type-keyed map.
  const definitions = Array.isArray(catalog) ? catalog : Object.values(catalog ?? {});
  const groupOrder = groups?.length
    ? groups
    : [...new Set(definitions.map((i) => i.group))];
  const used = new Set(current.map((i) => i.type));

  modal({
    title: 'Add indicator',
    subtitle: 'Pick a study — every parameter stays editable afterwards.',
    size: 'lg',
    render(body) {
      const search = document.createElement('input');
      search.className = 'input input--search';
      search.placeholder = 'Filter indicators…';
      body.appendChild(search);

      const listHost = document.createElement('div');
      listHost.className = 'ind-list';
      body.appendChild(listHost);

      const render = (filter = '') => {
        const q = filter.trim().toLowerCase();
        listHost.innerHTML = '';
        for (const group of groupOrder) {
          const items = definitions.filter((ind) => ind.group === group)
            .filter((ind) => !q
              || ind.name.toLowerCase().includes(q)
              || ind.short.toLowerCase().includes(q)
              || ind.type.includes(q));
          if (!items.length) continue;

          const sec = document.createElement('div');
          sec.className = 'ind-list__group';
          sec.innerHTML = `<h4>${escape(group)}</h4>`;
          const grid = document.createElement('div');
          grid.className = 'ind-list__grid';
          for (const ind of items) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'ind-card';
            btn.innerHTML = `
              <span class="ind-card__short">${escape(ind.short)}</span>
              <span class="ind-card__name">${escape(ind.name)}</span>
              <span class="ind-card__meta">${ind.placement === 'pane' ? 'own pane' : 'overlay'}${used.has(ind.type) ? ' · already added' : ''}</span>
            `;
            btn.addEventListener('click', () => {
              onAdd(ind.type);
              btn.classList.add('is-added');
              const meta = btn.querySelector('.ind-card__meta');
              meta.textContent = 'added';
              used.add(ind.type);
            });
            grid.appendChild(btn);
          }
          sec.appendChild(grid);
          listHost.appendChild(sec);
        }
        if (!listHost.children.length) {
          listHost.innerHTML = '<p class="section__hint">No indicator matches that filter.</p>';
        }
      };

      render();
      search.addEventListener('input', () => render(search.value));
    },
  });
}

export function openIndicatorEditor({ catalog, instance, onSave, onDelete, onToggle }) {
  const def = catalog[instance.type];
  if (!def) {
    toast(`Unknown indicator "${instance.type}"`, { type: 'error' });
    return;
  }

  // Populated by `render`, read by the footer buttons.
  let readState = () => ({ params: {}, placement: instance.placement, paneHeight: 110 });

  modal({
    title: def.name,
    subtitle: `${def.short} · ${def.params.length} setting${def.params.length === 1 ? '' : 's'}`,
    size: 'md',
    render(body) {
      body.appendChild(section('Calculation', 'Changing a setting redraws this pane immediately.'));

      const formHost = document.createElement('div');
      formHost.className = 'form-grid';
      body.appendChild(formHost);

      const form = def.params.length
        ? buildForm(formHost, def.params, instance.params ?? {})
        : null;
      if (!form) formHost.innerHTML = '<p class="section__hint">This indicator has no settings.</p>';

      body.appendChild(section('Placement', 'A pane indicator stacks its own sub-chart under the candles.'));

      const placementHost = document.createElement('div');
      placementHost.className = 'form-grid';
      body.appendChild(placementHost);

      let placement = instance.placement ?? def.placement;
      const paneHeight = instance.paneHeight ?? def.defaultPaneHeight ?? 110;

      const heightWrap = document.createElement('div');
      placementHost.appendChild(selectField('Where', placement, [
        { value: 'pane', label: 'Own pane (below the price chart)' },
        { value: 'overlay', label: 'Overlay on the price chart' },
      ], (value) => {
        placement = value;
        heightWrap.style.display = value === 'pane' ? '' : 'none';
      }));

      const heightField = document.createElement('label');
      heightField.className = 'field field--int';
      heightField.innerHTML = '<span class="field__label">Pane height (px)</span>';
      const heightInput = document.createElement('input');
      heightInput.type = 'number';
      heightInput.min = '60';
      heightInput.max = '600';
      heightInput.step = '10';
      heightInput.value = paneHeight;
      heightField.appendChild(heightInput);
      heightWrap.appendChild(heightField);
      heightWrap.style.display = placement === 'pane' ? '' : 'none';
      placementHost.appendChild(heightWrap);

      readState = () => ({
        params: form ? form.read() : { ...(instance.params ?? {}) },
        placement,
        paneHeight,
      });
    },
    footer(foot, { close }) {
      foot.innerHTML = `
        <button class="btn btn--ghost" data-act="toggle">${instance.enabled === false ? 'Enable' : 'Disable'}</button>
        <button class="btn btn--danger" data-act="delete">Remove</button>
        <span class="spacer"></span>
        <button class="btn" data-close>Cancel</button>
        <button class="btn btn--primary" data-act="save">Apply</button>
      `;
      foot.querySelector('[data-act="save"]').addEventListener('click', () => {
        onSave({ ...readState(), enabled: instance.enabled !== false });
        close();
      });
      foot.querySelector('[data-act="delete"]').addEventListener('click', () => {
        onDelete();
        close();
      });
      foot.querySelector('[data-act="toggle"]').addEventListener('click', () => {
        onToggle();
        close();
      });
    },
  });
}