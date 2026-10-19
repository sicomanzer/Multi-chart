/**
 * Verifies the P0/P1 fixes against a running server.
 *
 *   P0  PATCH {name} must not delete the board's charts or reset its settings.
 *   P1  priceLevels (priceLines) and indicator paneHeight must survive a
 *       save -> reload round trip.
 *
 * Exits non-zero on any failure.
 */
const BASE = process.env.API ?? 'http://127.0.0.1:8799';

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '  PASS' : '  FAIL'}  ${name}${ok ? '' : `  <- ${detail}`}`);
  if (!ok) failures += 1;
};

const req = async (method, path, body) => {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let parsed = null;
  try { parsed = JSON.parse(text); } catch { parsed = text; }
  return { status: res.status, body: parsed };
};

// ── seed ─────────────────────────────────────────────────────────────────────

const { body: list } = await req('GET', '/api/workspaces');
const board = list.workspaces[0];
console.log(`\nseed board: "${board.name}" (${board.chartCount} charts, revision seeded)\n`);

// Two price levels and a custom pane height, set through the same shape
// `chart-tile.snapshot()` produces.
const TARGET = board.id;
const { body: loaded } = await req('GET', `/api/workspaces/${TARGET}`);

const marks = [
  { value: 12.5, color: '#ff0000', width: 2, style: 'dashed', label: true, title: 'target' },
  { value: 9.75, color: '#00ff00', style: 'dotted', title: 'stop' },
];

const mutated = {
  ...loaded,
  charts: loaded.charts.slice(0, 3).map((c, i) => ({
    ...c,
    priceLines: i === 0 ? marks : [],
    indicators: c.indicators.map((ind) => (
      i === 0 ? { ...ind, paneHeight: 245 } : ind
    )),
  })),
};
mutated.baseRevision = loaded.revision;

const saved = await req('POST', '/api/workspaces', mutated);
check('full save accepted', saved.status === 200, `HTTP ${saved.status}`);

// ── P1: does it survive the round trip? ──────────────────────────────────────

const { body: back } = await req('GET', `/api/workspaces/${TARGET}`);
const c0 = back.charts[0];

/** Sanitizing fills omitted keys with defaults, so compare meaning, not JSON. */
const levelsMatch = (got, want) => Array.isArray(got)
  && got.length === want.length
  && want.every((w, i) => got[i] && got[i].value === w.value
    && got[i].color === w.color
    && got[i].style === w.style
    && got[i].title === w.title);

check('P1 priceLevels survive save+reload',
  levelsMatch(c0.priceLines, marks),
  `got ${JSON.stringify(c0.priceLines)}`);

check('P1 paneHeight survives save+reload',
  c0.indicators[0]?.paneHeight === 245,
  `got ${c0.indicators[0]?.paneHeight}`);

// ── P0: does renaming destroy the board? ─────────────────────────────────────

const before = {
  charts: back.charts.length,
  name: back.name,
  theme: back.settings.theme,
  columns: back.settings.columns,
  metrics: back.settings.footerMetrics.join(','),
};

const renamed = await req('PATCH', `/api/workspaces/${TARGET}`, { name: 'renamed by test' });
check('P0 PATCH returned 200', renamed.status === 200, `HTTP ${renamed.status}`);

const { body: afterRename } = await req('GET', `/api/workspaces/${TARGET}`);

check('P0 name actually changed',
  afterRename.name === 'renamed by test', `got "${afterRename.name}"`);

check('P0 charts SURVIVED the rename',
  afterRename.charts.length === before.charts,
  `${before.charts} -> ${afterRename.charts}`);

check('P0 priceLevels survived the rename',
  levelsMatch(afterRename.charts[0]?.priceLines, marks),
  `got ${JSON.stringify(afterRename.charts[0]?.priceLines)}`);

check('P0 paneHeight survived the rename',
  afterRename.charts[0]?.indicators[0]?.paneHeight === 245,
  `got ${afterRename.charts[0]?.indicators[0]?.paneHeight}`);

check('P0 settings SURVIVED the rename',
  afterRename.settings.theme === before.theme
  && afterRename.settings.columns === before.columns
  && afterRename.settings.footerMetrics.join(',') === before.metrics,
  `theme ${afterRename.settings.theme} / cols ${afterRename.settings.columns} / metrics ${afterRename.settings.footerMetrics}`);

// A partial settings patch must merge too, not reset.
await req('PATCH', `/api/workspaces/${TARGET}`, { settings: { theme: 'light' } });
const { body: afterSetting } = await req('GET', `/api/workspaces/${TARGET}`);
check('P0 partial settings patch merges',
  afterSetting.settings.theme === 'light'
  && afterSetting.settings.columns === before.columns
  && afterSetting.charts.length === before.charts,
  `theme ${afterSetting.settings.theme} / cols ${afterSetting.settings.columns} / charts ${afterSetting.charts.length}`);

// ── hostile input still gets cleaned ─────────────────────────────────────────

await req('PATCH', `/api/workspaces/${TARGET}`, {
  name: 'x'.repeat(500),
  charts: [{
    symbol: 'CPF',
    priceLines: [
      { value: 'not-a-number' },
      { value: 5, color: 'javascript:alert(1)', style: 'evil', width: 99, title: 'y'.repeat(80) },
      ...Array.from({ length: 40 }, (_, i) => ({ value: i })),
    ],
    indicators: [{ type: 'rsi', paneHeight: 99999 }],
  }],
});
const { body: hostile } = await req('GET', `/api/workspaces/${TARGET}`);
const hc = hostile.charts[0];

check('non-numeric price level dropped',
  !hc.priceLines.some((l) => !Number.isFinite(l.value)),
  JSON.stringify(hc.priceLines.slice(0, 2)));
check('invalid colour replaced',
  hc.priceLines.every((l) => !/javascript/i.test(l.color)), JSON.stringify(hc.priceLines[0]));
check('invalid style coerced',
  hc.priceLines.every((l) => ['solid', 'dashed', 'dotted'].includes(l.style)));
check('price levels capped at 12', hc.priceLines.length <= 12, `got ${hc.priceLines.length}`);
check('paneHeight clamped to 60..600',
  hc.indicators[0].paneHeight >= 60 && hc.indicators[0].paneHeight <= 600,
  `got ${hc.indicators[0].paneHeight}`);
check('unknown indicator type dropped',
  hc.indicators.every((i) => i.type === 'rsi'), JSON.stringify(hc.indicators.map((i) => i.type)));
check('bare symbol still normalised', hc.symbol === 'SET:CPF', `got ${hc.symbol}`);

console.log(`\n${failures ? `${failures} FAILURE(S)` : 'all checks passed'}\n`);
process.exit(failures ? 1 : 0);