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
import { t, tp } from '../i18n.js';

/**
 * @param {object} opts
 * @param {import('../board.js').Board} opts.board
 * @param {Array} opts.hits from the board's `oversold` event
 */
export function openOversoldList({ board, hits }) {
  const rows = [...(hits ?? [])];
  const lowest = rows[0];

  modal({
    title: t('os.title'),
    subtitle: rows.length
      ? tp('os.sub', rows.length)
      : t('os.subNone'),
    size: 'md',
    render: (body) => {
      if (!rows.length) {
        body.innerHTML = `<p class="section__hint">${escape(t('os.hint'))}</p>`;
        return;
      }

      const summary = document.createElement('p');
      summary.className = 'section__hint';
      // Markup is ours; the three values are escaped on the way in.
      summary.innerHTML = escape(t('os.deepest', {
        symbol: '\u0000', value: '\u0001', line: '\u0002',
      }))
        .replace('\u0000', `<b>${escape(lowest.symbol.split(':')[1])}</b>`)
        .replace('\u0001', `<b>${lowest.value.toFixed(1)}</b>`)
        .replace('\u0002', String(lowest.threshold));
      body.appendChild(summary);

      body.appendChild(section(t('os.charts'), t('os.chartsHint')));

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
        row.title = t('os.rowTitle', {
          symbol: hit.symbol,
          tf: hit.timeframe,
          length: hit.length,
          value: hit.value.toFixed(2),
          line: hit.threshold,
        });
        row.addEventListener('click', () => {
          const tile = board.tiles.get(hit.id);
          if (tile) board.toggleFocus(tile);
        });
        list.appendChild(row);
      }

      body.appendChild(list);

      const note = document.createElement('p');
      note.className = 'section__hint';
      note.textContent = t('os.note');
      body.appendChild(note);
    },
    footer: (foot) => {
      foot.innerHTML = `
        <span class="spacer"></span>
        <button class="btn" data-close>${escape(t('common.close'))}</button>`;
    },
  });
}