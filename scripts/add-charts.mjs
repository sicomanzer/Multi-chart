/**
 * Add charts to a saved board through the same API the UI uses.
 *
 *   node scripts/add-charts.mjs --board "SET board" --tf 1w --rsi TU TISCO …
 *   node scripts/add-charts.mjs --only TU TISCO …      # keep exactly these
 *
 * Flags:
 *   --board <name|id>  target board (default: the most recently updated one)
 *   --tf <id>          timeframe for the new charts (default: the board's)
 *   --rsi / --no-rsi   attach an RSI pane (default: follow the board)
 *   --only             make the board contain exactly the listed symbols, in the
 *                      listed order, dropping everything else
 *   --dry              report what would happen without saving
 */
const BASE = process.env.API ?? 'http://127.0.0.1:8787';

const argv = process.argv.slice(2);

// Split flags from positionals properly: a bare `--dry` consumes no value, while
// `--board "SET board"` consumes the next argument. Guessing this by looking at
// neighbours silently drops the first symbol, so walk the list instead.
const FLAGS_WITH_VALUE = new Set(['board', 'tf']);
const flags = {};
const symbols = [];
for (let i = 0; i < argv.length; i += 1) {
  const arg = argv[i];
  if (!arg.startsWith('--')) {
    symbols.push(arg);
    continue;
  }
  const name = arg.slice(2);
  if (FLAGS_WITH_VALUE.has(name)) {
    flags[name] = argv[i + 1];
    i += 1;
  } else {
    flags[name] = true;
  }
}

const flag = (name, fallback = null) => (flags[name] === undefined ? fallback : flags[name]);
const has = (name) => flags[name] === true;

if (!symbols.length) {
  console.error('usage: node scripts/add-charts.mjs [--board name] [--tf 1w] [--rsi|--no-rsi] SYMBOL…');
  process.exit(2);
}

const get = async (path) => {
  const res = await fetch(BASE + path);
  const text = await res.text();
  return { status: res.status, body: JSON.parse(text) };
};
const post = async (path, body) => {
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: JSON.parse(text) };
};

// ── pick the board ──────────────────────────────────────────────────────────

const { body: list } = await get('/api/workspaces');
let target = list.workspaces[0];
const wanted = flag('board');
if (wanted) {
  target = list.workspaces.find((w) => w.id === wanted || w.name === wanted);
  if (!target) {
    console.error(`no board named "${wanted}". Available: ${list.workspaces.map((w) => w.name).join(', ')}`);
    process.exit(2);
  }
}

const { body: board } = await get(`/api/workspaces/${target.id}`);
const timeframe = flag('tf', board.settings.defaultTimeframe);
const wantRsi = has('no-rsi') ? false : has('rsi') ? true : board.charts[0]?.indicators?.length > 0;

const { body: catalog } = await get('/api/indicators');
const rsiParams = Object.fromEntries(
  catalog.indicators.find((i) => i.type === 'rsi').params.map((p) => [p.id, p.default]),
);

// ── resolve the requested symbols ───────────────────────────────────────────

const only = has('only');
const bySymbol = new Map(board.charts.map((c) => [c.symbol, c]));
const kept = [];   // final chart list, in the order the symbols were listed
const keptExisting = [];
const added = [];
const removed = [];
const failed = [];

const newChart = (symbol) => ({
  id: `ch_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
  symbol,
  timeframe,
  chartType: board.settings.candleStyle,
  logScale: false,
  autoscale: true,
  priceLines: [],
  indicators: wantRsi
    ? [{
      id: `ind_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
      type: 'rsi',
      enabled: true,
      placement: 'pane',
      params: rsiParams,
      paneHeight: 100,
    }]
    : [],
});

for (const raw of symbols) {
  const { body: resolved } = await get(`/api/symbol/resolve?symbol=${encodeURIComponent(raw)}`);
  const symbol = resolved.symbol ?? `SET:${raw.toUpperCase()}`;
  const current = bySymbol.get(symbol);

  if (current) {
    // Keep the existing tile (and its indicators) unless --tf was given
    // explicitly, in which case the board is being re-based anyway.
    const chart = flag('tf') ? { ...current, timeframe } : current;
    kept.push(chart);
    keptExisting.push(symbol);
    continue;
  }

  const { status, body: candles } = await get(
    `/api/candles?symbol=${encodeURIComponent(symbol)}&timeframe=${timeframe}`,
  );
  if (status !== 200) {
    failed.push(`${symbol}: ${candles?.error?.message ?? `HTTP ${status}`}`);
    continue;
  }

  kept.push(newChart(symbol));
  added.push({ symbol });
}

if (only) {
  const wanted = new Set(kept.map((c) => c.symbol));
  for (const chart of board.charts) {
    if (!wanted.has(chart.symbol)) removed.push(chart.symbol);
  }
} else {
  for (const chart of board.charts) {
    if (!keptExisting.includes(chart.symbol)) kept.push(chart);
  }
}

// ── report ──────────────────────────────────────────────────────────────────

console.log(`board:  ${board.name} (${board.charts.length} charts, ${board.settings.columns} columns)`);
console.log(`mode:   ${only ? 'keep exactly the listed symbols' : 'append'}`);

if (only) {
  for (const symbol of removed) console.log(`  - ${symbol} (removed)`);
}
for (const chart of added) console.log(`  + ${chart.symbol}`);
for (const note of failed) console.log(`  ! ${note}`);
console.log(`result: ${kept.length} charts at ${timeframe}${wantRsi ? ' with RSI pane' : ''}`);

if (has('dry')) {
  console.log('\ndry run — nothing saved');
  process.exit(failed.length ? 1 : 0);
}
if (!only && !added.length) {
  console.log('\nnothing to add');
  process.exit(0);
}
if (failed.length && only) {
  console.error('\nrefusing to prune: some symbols could not be verified.');
  process.exit(1);
}

// ── save ────────────────────────────────────────────────────────────────────

const next = { ...board, charts: kept };
// Send the revision we read so an open browser tab cannot overwrite this
// change afterwards (and so we detect a competing write ourselves).
next.baseRevision = board.revision;

const saved = await post('/api/workspaces', next);
if (saved.status === 409) {
  console.error('\nsave rejected: the board changed while this script ran.');
  console.error('Re-run the command to apply it on top of the newer version.');
  process.exit(1);
}
if (saved.status >= 400) {
  console.error(`\nsave failed: HTTP ${saved.status} ${JSON.stringify(saved.body).slice(0, 200)}`);
  process.exit(1);
}

console.log(`\nsaved:  HTTP ${saved.status} · ${next.charts.length} charts total`);
console.log('reload the browser to see them (or press the reload button).');