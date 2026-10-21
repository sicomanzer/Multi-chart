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
import { t, tp, paramKey } from '../i18n.js';

export function openIndicatorPicker({ catalog, groups, onAdd, current = [] }) {
  // Accept either the catalog array or the board's type-keyed map.
  const definitions = Array.isArray(catalog) ? catalog : Object.values(catalog ?? {});
  const groupOrder = groups?.length
    ? groups
    : [...new Set(definitions.map((i) => i.group))];
  const used = new Set(current.map((i) => i.type));

  modal({
    title: t('ind.addTitle'),
    subtitle: t('ind.addSub'),
    size: 'lg',
    render(body) {
      const search = document.createElement('input');
      search.className = 'input input--search';
      search.placeholder = t('ind.filter');
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
              <span class="ind-card__meta">${ind.placement === 'pane' ? escape(t('cd.ownPane')) : escape(t('cd.overlay'))}${used.has(ind.type) ? escape(t('ind.alreadyAdded')) : ''}</span>
            `;
            btn.addEventListener('click', () => {
              onAdd(ind.type);
              btn.classList.add('is-added');
              const meta = btn.querySelector('.ind-card__meta');
              meta.textContent = t('ind.added');
              used.add(ind.type);
            });
            grid.appendChild(btn);
          }
          sec.appendChild(grid);
          listHost.appendChild(sec);
        }
        if (!listHost.children.length) {
          listHost.innerHTML = `<p class="section__hint">${escape(t('ind.noMatch'))}</p>`;
        }
      };

      render();
      search.addEventListener('input', () => render(search.value));
    },
  });
}

/**
 * Board-wide indicator settings.
 *
 * `usage` is one entry per indicator *type* present on the board, with the number
 * of charts carrying it — clicking one opens the normal editor, but in "all
 * charts" scope, so one dialog changes every chart at once.
 */
export function openBoardIndicatorPicker({ catalog, usage, totalCharts, onPick }) {
  const definitions = Array.isArray(catalog) ? catalog : Object.values(catalog ?? {});

  if (!usage.length) {
    toast(t('ind.emptyToast'), { type: 'info' });
    return;
  }

  const api = modal({
    title: t('ind.boardTitle'),
    subtitle: tp('ind.boardSub', totalCharts),
    size: 'lg',
    render(body) {
      const search = document.createElement('input');
      search.className = 'input input--search';
      search.placeholder = t('ind.filter');
      body.appendChild(search);

      const listHost = document.createElement('div');
      listHost.className = 'ind-list';
      body.appendChild(listHost);

      const render = (filter = '') => {
        const q = filter.trim().toLowerCase();
        listHost.innerHTML = '';
        const items = usage.filter(({ type }) => {
          const def = catalog[type] ?? definitions.find((d) => d.type === type);
          if (!def) return false;
          return !q || def.name.toLowerCase().includes(q)
            || def.short.toLowerCase().includes(q)
            || type.includes(q);
        });

        if (!items.length) {
          listHost.innerHTML = `<p class="section__hint">${escape(t('ind.noMatch'))}</p>`;
          return;
        }

        const sec = document.createElement('div');
        sec.className = 'ind-list__group';
        sec.innerHTML = `<h4>${escape(t('ind.onThisBoard'))}</h4>`;
        const grid = document.createElement('div');
        grid.className = 'ind-list__grid';

        for (const entry of items) {
          const def = catalog[entry.type] ?? definitions.find((d) => d.type === entry.type);
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'ind-card';
          const everywhere = entry.charts === totalCharts;
          btn.innerHTML = `
            <span class="ind-card__short">${escape(def.short)}</span>
            <span class="ind-card__name">${escape(def.name)}</span>
            <span class="ind-card__meta">${escape(tp('ind.onCharts', entry.charts))}${everywhere ? escape(t('ind.all')) : ''}${entry.differing ? escape(t('ind.mixed')) : ''}</span>
          `;
          btn.addEventListener('click', () => {
            // Close first: the editor is a second modal, and two stacked
            // dialogs leave the picker sitting behind the one being used.
            api.close();
            onPick(entry.type);
          });
          grid.appendChild(btn);
        }
        sec.appendChild(grid);
        listHost.appendChild(sec);
      };

      render();
      search.addEventListener('input', () => render(search.value));
    },
  });
}

export function openIndicatorEditor({ catalog, instance, onSave, onDelete, onToggle, scope = null }) {
  const def = catalog[instance.type];
  if (!def) {
    toast(t('ind.unknown', { type: instance.type }), { type: 'error' });
    return;
  }

  // Populated by `render`, read by the footer buttons.
  let readState = () => ({ params: {}, placement: instance.placement, paneHeight: 110 });

  modal({
    title: def.name,
    subtitle: tp('ind.sub', def.params.length, { short: def.short }),
    size: 'md',
    render(body) {
      // Scope banner: the same dialog edits one instance or the whole board, and
      // overwriting differing settings silently would be the surprising kind.
      if (scope) {
        const banner = document.createElement('div');
        banner.className = 'scope-banner';
        const head = `<strong>${escape(t('ind.scopeStrong', { n: scope.charts }))}</strong> ${escape(t('ind.scopeTail'))}`;
        banner.innerHTML = scope.differing
          ? `${head} ${escape(tp('ind.scopeDiff', scope.differing))}`
          : head;
        body.appendChild(banner);
      }

      body.appendChild(section(t('ind.calc'), scope
        ? t('ind.calcScope')
        : t('ind.calcOne')));

      const formHost = document.createElement('div');
      formHost.className = 'form-grid';
      body.appendChild(formHost);

      const form = def.params.length
        ? buildForm(formHost, def.params, instance.params ?? {})
        : null;
      if (!form) formHost.innerHTML = `<p class="section__hint">${escape(t('ind.noSettings'))}</p>`;

      body.appendChild(section(t('ind.placement'), t('ind.placementHint')));

      const placementHost = document.createElement('div');
      placementHost.className = 'form-grid';
      body.appendChild(placementHost);

      let placement = instance.placement ?? def.placement;
      let paneHeight = instance.paneHeight ?? def.defaultPaneHeight ?? 110;

      const heightWrap = document.createElement('div');
      placementHost.appendChild(selectField(t('ind.where'), placement, [
        { value: 'pane', label: t('ind.wherePane') },
        { value: 'overlay', label: t('ind.whereOverlay') },
      ], (value) => {
        placement = value;
        heightWrap.style.display = value === 'pane' ? '' : 'none';
      }));

      const heightField = document.createElement('label');
      heightField.className = 'field field--int';
      heightField.innerHTML = `<span class="field__label">${escape(t('ind.paneHeight'))}</span>`;
      const heightInput = document.createElement('input');
      heightInput.type = 'number';
      heightInput.min = '60';
      heightInput.max = '600';
      heightInput.step = '10';
      heightInput.value = paneHeight;
      heightField.appendChild(heightInput);
      // Read back on every change, not on Apply: an emptied or half-typed field
      // has to fall back to something sane, and `readState` cannot distinguish
      // "left at 110" from "never touched the spinner".
      heightInput.addEventListener('input', () => {
        const n = Number(heightInput.value);
        paneHeight = Number.isFinite(n)
          ? Math.min(600, Math.max(60, Math.round(n)))
          : (def.defaultPaneHeight ?? 110);
      });
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
      // Name the scope in the buttons, so it is impossible to save a board-wide
      // change believing it was one chart.
      const scopeNote = scope ? tp('ind.scopeNote', scope.charts) : '';
      foot.innerHTML = `
        <button class="btn btn--ghost" data-act="toggle">${escape(t(instance.enabled === false ? 'ind.enable' : 'ind.disable'))}${escape(scopeNote)}</button>
        <button class="btn btn--danger" data-act="delete">${escape(t('common.remove'))}${escape(scopeNote)}</button>
        <span class="spacer"></span>
        <button class="btn" data-close>${escape(t('common.cancel'))}</button>
        <button class="btn btn--primary" data-act="save">${escape(t('common.apply'))}${escape(scopeNote)}</button>
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