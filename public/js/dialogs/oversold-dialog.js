/**
 * Oversold alert — the list behind the green button.
 *
 * The button itself lives in the top bar and only ever says how many charts are
 * under water; this dialog is where the answer to "which ones, and how far?"
 * lives.
 *
 * Each row carries its chart's *own* oversold line, because that is the line
 * its RSI pane is drawing. A chart configured to fire at 20 is not comparable
 * to one left at the default 30, and flattening them into one column would
 * invite exactly the wrong comparison.
 *
 * Nothing here recomputes anything. The values come from the board, which
 * refreshes them on the same cadence as the RSI panes themselves, so what this
 * shows always matches what is drawn on screen.
 */
import { modal, escape, section } from '../ui.js';

/**
 * @param {object} opts
 * @param {import('../board.js').Board} opts.board
 * @param {Array} opts.hits from the board's `oversold` event
 */
export function openOversoldList({ board, hits }) {
  const rows = [...(hits ?? [])];
  const lowest = rows[0];

  modal({
    title: 'RSI below its oversold line',
    subtitle: rows.length
      ? `${rows.length} chart${rows.length === 1 ? '' : 's'} on this board. Each is judged against its own RSI setting.`
      : 'Nothing is below its line right now.',
    size: 'md',
    render: (body) => {
      if (!rows.length) {
        body.innerHTML = `
          <p class="section__hint">
            The alert re-checks whenever a chart reloads its candles, which is every
            minute while the tab is visible and whenever a board loads.
          </p>`;
        return;
      }

      const summary = document.createElement('p');
      summary.className = 'section__hint';
      summary.innerHTML = `Deepest: <b>${escape(lowest.symbol.split(':')[1])}</b> at
        RSI <b>${lowest.value.toFixed(1)}</b> against a ${lowest.threshold} line.`;
      body.appendChild(summary);

      body.appendChild(section('Charts', 'Click a row to bring that chart up full screen.'));

      const list = document.createElement('div');
      list.className = 'os-list';

      for (const hit of rows) {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'os-row';
        const depth = hit.threshold > 0
          ? Math.min(100, ((hit.threshold - hit.value) / hit.threshold) * 100)
          : 0;
        row.innerHTML = `
          <span class="os-row__sym">${escape(hit.symbol.split(':')[1])}</span>
          <span class="os-row__ex">${escape(hit.symbol.split(':')[0])}</span>
          <span class="os-row__tf">${escape(hit.timeframe)}</span>
          <span class="os-row__bar"><i style="width:${depth.toFixed(1)}%"></i></span>
          <span class="os-row__val">${hit.value.toFixed(1)}</span>
          <span class="os-row__line">&lt; ${hit.threshold}</span>`;
        row.title = `${hit.symbol} · ${hit.timeframe} · RSI(${hit.length}) ${hit.value.toFixed(2)}, line ${hit.threshold} — click to maximise`;
        row.addEventListener('click', () => {
          const tile = board.tiles.get(hit.id);
          if (tile) board.toggleFocus(tile);
        });
        list.appendChild(row);
      }

      body.appendChild(list);

      const note = document.createElement('p');
      note.className = 'section__hint';
      note.textContent = 'Change a chart\'s line from Settings, or from the RSI legend entry '
        + 'clicking opens its editor.';
      body.appendChild(note);
    },
    footer: (foot) => {
      foot.innerHTML = `
        <span class="spacer"></span>
        <button class="btn" data-close>Close</button>`;
    },
  });
}