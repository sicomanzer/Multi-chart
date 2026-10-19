/**
 * Watchlist picker.
 *
 * A watchlist is a named bag of symbols that lives outside any board, so it
 * survives re-arranging the grid and can be dumped onto whichever board you are
 * looking at. This dialog is the only surface for them: create, rename, seed
 * from the current board, edit membership, and push the whole list onto the
 * board in one action.
 *
 * Deliberately a modal rather than a side panel โ€” a 60-chart board is already
 * tight on a laptop, and a permanent drawer would compete with the charts it
 * exists to serve.
 *
 * Naming and deleting happen inline, not through `window.prompt` /
 * `window.confirm`. Native dialogs are blocked outright in plenty of contexts
 * โ€” embedded frames, automation, some kiosk and in-app browsers โ€” and they
 * return null rather than throwing, so a blocked prompt is indistinguishable
 * from a cancelled one and a `if (answer == null) return;` guard turns the
 * failure into silence. An inline field cannot fail that way, and it can be
 * styled to match the rest of the desk.
 *
 * Membership edits go through the dedicated add/remove routes so that ticking
 * one symbol off a 200-name list does not rewrite the whole thing and race a
 * rename happening in another tab.
 */
import { api } from '../api.js';
import { escape, modal, section, toast, checkbox } from '../ui.js';

/**
 * @param {object} opts
 * @param {import('../board.js').Board} opts.board
 * @param {() => void} [opts.onChanged] called after the board has been modified
 *   or a list has been created, renamed, duplicated or deleted โ€” whatever
 *   else is showing the list of watchlists needs to re-read it
 */
export function openWatchlists({ board, onChanged }) {
  let lists = [];
  let selectedId = null;
  let current = null;      // the full selected list
  let addRsi = true;
  let loadTimeframe = '';  // '' = follow the board's default

  // Inline-edit state. At most one of these is ever open, which keeps the
  // column from growing a stack of half-finished inputs.
  let creating = false;
  let renaming = false;
  let seeding = false;
  let armedDelete = false;

  let left;
  let right;
  let setHint = () => {};

  modal({
    title: 'Watchlists',
    subtitle: 'Named symbol lists. Load one onto the board in a click โ€” no limit on how many you keep.',
    size: 'lg',
    render: (body) => {
      const layout = document.createElement('div');
      layout.className = 'wl-layout';

      left = document.createElement('div');
      left.className = 'wl-pane wl-pane--lists';

      right = document.createElement('div');
      right.className = 'wl-pane wl-pane--detail';

      layout.append(left, right);
      body.appendChild(layout);
    },
    footer: (foot) => {
      foot.innerHTML = `
        <span class="section__hint" id="wlFooterHint"></span>
        <span class="spacer"></span>
        <button class="btn" data-close>Close</button>`;
      const hint = foot.querySelector('#wlFooterHint');
      setHint = (text) => { hint.textContent = text ?? ''; };
    },
  });

  // โ”€โ”€ state โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€

  async function refresh() {
    const data = await api.watchlists();
    lists = data.watchlists ?? [];
    // The selected list can vanish if another tab deleted it; fall back rather
    // than leaving the detail pane pointing at nothing.
    if (selectedId && !lists.some((l) => l.id === selectedId)) selectedId = null;
    if (!selectedId && lists.length) selectedId = lists[0].id;
    current = selectedId ? await api.watchlist(selectedId).catch(() => null) : null;
  }

  function render() {
    // Any navigation closes a pending inline edit: leaving a half-typed name
    // sitting in the column after the user moved on only invites confusion.
    creating = false;
    seeding = false;
    armedDelete = false;
    renderLists();
    renderDetail();
  }

  /**
   * Run a mutation, reporting failure instead of dropping it.
   *
   * Every server call here is fallible, and a swallowed rejection looks exactly
   * like a button that does nothing โ€” which is the bug this dialog was written
   * to avoid in the first place.
   */
  async function attempt(label, fn) {
    try {
      await fn();
      return true;
    } catch (err) {
      toast(`${label} failed: ${err.message}`, { type: 'error', timeout: 6000 });
      return false;
    }
  }

  // โ”€โ”€ inline name editor, shared by create / rename / seed โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€

  /**
   * A text field with its own confirm and cancel.
   *
   * Enter commits, Escape cancels, and the field is focused and pre-selected on
   * the next frame so it can be typed over without a second click. Commit is
   * ignored while the value is empty rather than silently creating a nameless
   * list โ€” the server would accept one, but that is not what anybody means.
   */
  function nameEditor({ value, placeholder, submitLabel, onSubmit, onCancel }) {
    const wrap = document.createElement('form');
    wrap.className = 'wl-edit';

    const input = document.createElement('input');
    input.className = 'input';
    input.placeholder = placeholder;
    input.value = value;
    input.maxLength = 80;

    const commit = () => {
      const name = input.value.trim();
      if (!name) {
        input.focus();
        toast('A watchlist needs a name', { type: 'error', timeout: 2500 });
        return;
      }
      onSubmit(name);
    };

    const cancel = () => onCancel?.();

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); commit(); }
      if (e.key === 'Escape') { e.preventDefault(); cancel(); }
    });
    wrap.addEventListener('submit', (e) => { e.preventDefault(); commit(); });

    wrap.append(input, btn(submitLabel, 'btn btn--primary btn--sm', commit));
    wrap.appendChild(btn('Cancel', 'btn btn--ghost btn--sm', cancel));

    requestAnimationFrame(() => { input.focus(); input.select(); });
    return wrap;
  }

  // โ”€โ”€ left pane: the lists โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€

  function renderLists() {
    left.innerHTML = '';

    const head = document.createElement('div');
    head.className = 'wl-head';
    head.innerHTML = '<h3>Lists</h3>';
    if (board.filterSymbols) {
      // Mirrors the toolbar chip, so the filter is discoverable from inside the
      // dialog that caused it rather than only from the top bar.
      head.appendChild(btn(`Show all (${board.visibleCount()}/${board.tiles.size})`,
        'btn btn--filter btn--sm',
        () => {
          board.clearFilter();
          render();
        }));
    }
    if (!creating) {
      head.appendChild(btn('+ New', 'btn btn--primary btn--sm', () => {
        creating = true;
        renderLists();
      }));
    }
    left.appendChild(head);

    if (creating) {
      left.appendChild(nameEditor({
        value: '',
        placeholder: 'Name this list',
        submitLabel: 'Create',
        onSubmit: async (name) => {
          const ok = await attempt('Create list', async () => {
            const wl = await api.createWatchlist(name, []);
            creating = false;
            // Land in the list that was just created. Staying on whatever was
            // selected before leaves the user staring at the old list and
            // wondering whether the new one exists.
            selectedId = wl.id;
            await refresh();
            render();
            setHint(`Created "${wl.name}".`);
          });
          if (!ok) {
            // Leave the field open on failure so the typed name is not lost.
            creating = true;
            renderLists();
          }
        },
        onCancel: () => { creating = false; renderLists(); },
      }));
    }

    if (!lists.length && !creating) {
      const empty = document.createElement('p');
      empty.className = 'section__hint';
      empty.textContent = 'No watchlists yet. Create one, or save the current board as a list.';
      left.appendChild(empty);
    }

    for (const list of lists) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = `wl-list${list.id === selectedId ? ' is-active' : ''}`;
      const preview = list.count
        ? list.preview.map((s) => s.split(':')[1]).join(' ยท ')
        : 'empty';
      row.innerHTML = `
        <b>${escape(list.name)}</b>
        <span class="wl-list__count">${list.count}</span>
        <span class="wl-list__preview">${escape(preview)}${list.count > list.preview.length ? ' โ€ฆ' : ''}</span>`;
      row.addEventListener('click', async () => {
        selectedId = list.id;
        current = await api.watchlist(list.id).catch(() => null);
        // Selecting a list narrows the board to it. Clicking the list that is
        // already narrowing clears it again, so the control has one obvious
        // meaning: "show me these, or show me everything".
        // Canonical `EXCHANGE:TICKER`, which is what the board compares against โ€”
        // stripping the exchange would match nothing.
        const symbols = new Set(current?.symbols ?? []);
        board.toggleFilter(symbols.size ? symbols : null, list.name, list.id);
        render();
      });
      left.appendChild(row);
    }

    const boardSymbols = [...board.tiles.values()].map((t) => t.config.symbol);
    if (seeding) {
      left.appendChild(nameEditor({
        value: '',
        placeholder: `Name the list (${boardSymbols.length} symbols)`,
        submitLabel: 'Save',
        onSubmit: async (name) => {
          const ok = await attempt('Save board as list', async () => {
            const wl = await api.watchlistFromSymbols(boardSymbols, name);
            seeding = false;
            selectedId = wl.id;
            await refresh();
            render();
            onChanged?.();
            toast(`Saved ${wl.symbols.length} symbols as "${wl.name}"`, { type: 'success' });
          });
          if (!ok) {
            seeding = true;
            renderLists();
          }
        },
        onCancel: () => { seeding = false; renderLists(); },
      }));
    } else {
      const seed = btn(
        `Save this board (${boardSymbols.length})`,
        'btn btn--ghost wl-seed',
        () => { seeding = true; renderLists(); },
      );
      seed.disabled = boardSymbols.length === 0;
      left.appendChild(seed);
    }
  }

  // โ”€โ”€ right pane: one list โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€

  function renderDetail() {
    right.innerHTML = '';

    if (!current) {
      right.innerHTML = '<p class="section__hint">Select a list, or create a new one.</p>';
      return;
    }

    const head = document.createElement('div');
    head.className = 'wl-head';

    if (renaming) {
      head.appendChild(nameEditor({
        value: current.name,
        placeholder: 'List name',
        submitLabel: 'Save',
        onSubmit: async (name) => {
          const ok = await attempt('Rename', async () => {
            await api.renameWatchlist(current.id, name);
            renaming = false;
            await refresh();
            render();
            onChanged?.();
          });
          if (!ok) { renaming = true; renderDetail(); }
        },
        onCancel: () => { renaming = false; renderDetail(); },
      }));
      right.appendChild(head);
      right.appendChild(detailBody());
      return;
    }

    const title = document.createElement('h3');
    title.textContent = current.name;
    head.appendChild(title);
    head.append(
      btn('Rename', 'btn btn--ghost btn--sm', () => { renaming = true; renderDetail(); }),
      btn('Duplicate', 'btn btn--ghost btn--sm', async () => {
        const ok = await attempt('Duplicate', async () => {
          const wl = await api.duplicateWatchlist(current.id);
          await refresh();
          selectedId = wl.id;
          render();
          onChanged?.();
        });
        if (!ok) renderDetail();
      }),
      // Two-step rather than `confirm()`: deleting a list of names on one
      // mis-click is not recoverable, and arming a button makes the second
      // click explicit instead of relying on a dialog that may never open.
      btn(armedDelete ? 'Confirm delete' : 'Delete',
        armedDelete ? 'btn btn--danger btn--sm is-armed' : 'btn btn--danger btn--sm',
        async () => {
          if (!armedDelete) {
            armedDelete = true;
            renderDetail();
            return;
          }
          const ok = await attempt('Delete', async () => {
            await api.deleteWatchlist(current.id);
            selectedId = null;
            current = null;
            armedDelete = false;
            await refresh();
            render();
            onChanged?.();
            toast('Watchlist deleted. The board was not touched.', { type: 'info' });
          });
          if (!ok) { armedDelete = false; renderDetail(); }
        }),
    );
    if (armedDelete) {
      const warn = document.createElement('span');
      warn.className = 'wl-armed-note';
      warn.textContent = 'press again';
      head.appendChild(warn);
    }
    right.appendChild(head);
    right.appendChild(detailBody());
  }

  /** Everything below the header: membership and the load controls. */
  function detailBody() {
    const frag = document.createDocumentFragment();

    // โ”€โ”€ add symbols โ”€โ”€
    frag.appendChild(section('Add symbols', 'Accepts CPF, SET:CPF, CPF.BK, or several separated by commas.'));

    const input = document.createElement('input');
    input.className = 'input';
    input.placeholder = 'CPF, PTTEP, SET:SCBโ€ฆ';
    input.spellcheck = false;

    const addBtn = btn('Add', 'btn btn--primary', async () => {
      const raw = input.value.trim();
      if (!raw) return;
      addBtn.disabled = true;
      try {
        const res = await api.addWatchlistSymbols(current.id, raw.split(/[,;\s]+/));
        if (res.full) toast(`List is full โ€” ${res.skipped} not added`, { type: 'error' });
        else if (res.added) toast(`Added ${res.added} symbol(s)`, { type: 'success', timeout: 2200 });
        await refresh();
        render();
      } catch (err) {
        toast(`Add failed: ${err.message}`, { type: 'error', timeout: 6000 });
        addBtn.disabled = false;
        input.focus();
      }
    });

    const searchBtn = btn('Search SET', 'btn', async () => {
      const data = await api.symbols(input.value, 'thailand', 20).catch(() => null);
      if (!data) { toast('Search failed', { type: 'error' }); return; }
      if (!data.results?.length) { toast('No screener match', { type: 'info' }); return; }
      const picked = data.results.slice(0, 8).map((r) => r.symbol);
      const res = await api.addWatchlistSymbols(current.id, picked);
      toast(`Added ${res.added} from the screener`, { type: 'success' });
      input.value = '';
      await refresh();
      render();
    });

    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addBtn.click(); } });

    const row = document.createElement('div');
    row.className = 'row';
    row.append(input, searchBtn, addBtn);
    frag.appendChild(row);

    // โ”€โ”€ membership โ”€โ”€
    const max = board.meta?.maxWatchlistSymbols;
    frag.appendChild(section(
      `Symbols (${current.symbols.length}${max ? ` / ${max}` : ''})`,
      'Click โ• to drop one. A dot means it is already drawn on the board.',
    ));

    const drawn = new Set([...board.tiles.values()].map((t) => t.config.symbol));
    const list = document.createElement('div');
    list.className = 'wl-symbols';
    if (!current.symbols.length) {
      list.innerHTML = '<p class="section__hint">Nothing here yet.</p>';
    }
    for (const symbol of current.symbols) {
      const chip = document.createElement('div');
      chip.className = `wl-symbol${drawn.has(symbol) ? ' is-on-board' : ''}`;
      chip.innerHTML = `
        <i class="wl-symbol__on" title="already on the board">โ—</i>
        <b>${escape(symbol.split(':')[1])}</b>
        <span>${escape(symbol.split(':')[0])}</span>`;
      const x = btn('โ•', 'icon-btn wl-symbol__x', async () => {
        const ok = await attempt('Remove symbol', async () => {
          await api.removeWatchlistSymbols(current.id, [symbol]);
          await refresh();
          render();
        });
        if (!ok) renderDetail();
      });
      x.title = `Remove ${symbol}`;
      chip.appendChild(x);
      list.appendChild(chip);
    }
    frag.appendChild(list);

    // โ”€โ”€ load onto the board โ”€โ”€
    frag.appendChild(section('Load onto this board'));

    const opts = document.createElement('div');
    opts.className = 'wl-load';

    const tfField = document.createElement('select');
    tfField.className = 'input input--select';
    tfField.innerHTML = `<option value="">Board default (${escape(board.workspace.settings.defaultTimeframe)})</option>`
      + board.meta.timeframes
        .map((t) => `<option value="${escape(t.id)}">${escape(t.id)} โ€” ${escape(t.label)}</option>`)
        .join('');
    tfField.addEventListener('change', () => { loadTimeframe = tfField.value; });

    const rsiToggle = checkbox('Start each new chart with an RSI pane', addRsi, (v) => { addRsi = v; });

    const loadBtn = btn(`Load ${current.symbols.length} symbol(s)`, 'btn btn--primary', () => {
      const result = board.addCharts(current.symbols, {
        timeframe: loadTimeframe || undefined,
        withRsi: addRsi,
      });
      reportLoad(result);
      onChanged?.();
    });
    loadBtn.disabled = current.symbols.length === 0;

    opts.append(tfField, rsiToggle, loadBtn);
    frag.appendChild(opts);
    return frag;
  }

  function reportLoad(result) {
    const parts = [`added ${result.added.length}`];
    if (result.alreadyOnBoard.length) parts.push(`${result.alreadyOnBoard.length} already on the board`);
    if (result.duplicates.length) parts.push(`${result.duplicates.length} repeated`);
    if (result.overCapacity.length) {
      parts.push(`${result.overCapacity.length} left out โ€” the board holds at most ${result.limit}`);
    }
    toast(parts.join(' ยท '), {
      type: result.overCapacity.length ? 'error' : 'success',
      timeout: result.overCapacity.length ? 7000 : 3500,
    });
    render();
  }

  // Load before the first paint โ€” rendering empty panes and then filling them
  // makes the dialog look broken on a cold or slow connection.
  refresh()
    .then(render)
    .catch((err) => {
      left.innerHTML = `<p class="section__hint is-error">Could not load watchlists: ${escape(err.message)}</p>`;
    });
}

function btn(label, className, onClick) {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = className;
  el.textContent = label;
  el.addEventListener('click', onClick);
  return el;
}