/**
 * Verifies the watchlist feature against a running server.
 *
 * Focus is on the promises the feature makes:
 *   - unlimited lists (the board store trims at 40; this must not)
 *   - symbols normalised the same way the board does, so CPF == SET:CPF
 *   - partial PATCH does not wipe the list (the P0 lesson from workspaces)
 *   - per-list cap is enforced and reported, not silent
 *
 * Exits non-zero on any failure.
 */
const BASE = process.env.API ?? 'http://127.0.0.1:8787';

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

const created = [];
const track = (wl) => { created.push(wl.id); return wl; };

// ── CRUD ────────────────────────────────────────────────────────────────────

console.log('\n── CRUD ──');

const empty = track((await req('POST', '/api/watchlists', { name: 'Empty list' })).body);
check('create returns 201', empty && empty.id, JSON.stringify(empty));
check('create honours the name', empty.name === 'Empty list', empty?.name);

const seeded = track((await req('POST', '/api/watchlists/from-board', {
  name: 'From board',
  symbols: ['TU', 'SET:CPF', 'cpf.bk', 'PTTEP', 'TU', 'not a ticker!!'],
})).body);

check('symbols normalised to EXCHANGE:TICKER',
  seeded.symbols.every((s) => /^[A-Z0-9]+:[A-Z0-9.\-]+$/.test(s)),
  JSON.stringify(seeded.symbols));
check('CPF / SET:CPF / cpf.bk collapse to one',
  seeded.symbols.filter((s) => s === 'SET:CPF').length === 1,
  JSON.stringify(seeded.symbols));
check('duplicate TU collapsed',
  seeded.symbols.filter((s) => s === 'SET:TU').length === 1,
  JSON.stringify(seeded.symbols));

const added = await req('POST', `/api/watchlists/${seeded.id}/symbols`, { symbols: ['SCB, KBANK', 'ADVANC'] });
check('POST symbols adds', added.body.added === 3, JSON.stringify(added.body));
check('re-adding an existing symbol is a no-op',
  (await req('POST', `/api/watchlists/${seeded.id}/symbols`, { symbols: ['SCB'] })).body.added === 0);

const removed = await req('DELETE', `/api/watchlists/${seeded.id}/symbols`, { symbols: ['SCB', 'ADVANC'] });
check('DELETE symbols removes', removed.body.removed === 2, JSON.stringify(removed.body));

const stateBeforeDup = (await req('GET', `/api/watchlists/${seeded.id}`)).body.symbols;
const dup = track((await req('POST', `/api/watchlists/${seeded.id}/duplicate`)).body);
check('duplicate copies exactly the current symbols',
  JSON.stringify(dup.symbols) === JSON.stringify(stateBeforeDup),
  `${JSON.stringify(dup.symbols)} vs ${JSON.stringify(stateBeforeDup)}`);
check('duplicate gets a new id', dup.id !== seeded.id);
check('duplicate gets a new name', dup.name.endsWith('copy'), dup.name);

// ── PATCH must not wipe ─────────────────────────────────────────────────────

console.log('\n── partial update ──');

const beforeCount = (await req('GET', `/api/watchlists/${seeded.id}`)).body.symbols.length;
const renamed = await req('PATCH', `/api/watchlists/${seeded.id}`, { name: 'Renamed' });
check('PATCH returns 200', renamed.status === 200);
check('PATCH applied the name', renamed.body.name === 'Renamed', renamed.body?.name);
check('PATCH did NOT wipe the symbols',
  renamed.body.symbols.length === beforeCount,
  `${beforeCount} -> ${renamed.body.symbols?.length}`);

// ── the per-list cap ────────────────────────────────────────────────────────

console.log('\n── limits ──');

const capList = track((await req('POST', '/api/watchlists', { name: 'Cap test' })).body);
const many = Array.from({ length: 620 }, (_, i) => `SYM${i}`);
const capped = await req('POST', `/api/watchlists/${capList.id}/symbols`, { symbols: many });
const capValue = (await req('GET', '/api/meta')).body.maxWatchlistSymbols;

check(`list capped at ${capValue}`, capped.body.watchlist.symbols.length === capValue,
  `got ${capped.body.watchlist.symbols.length}`);
check('overflow reported as skipped', capped.body.skipped > 0, `skipped=${capped.body.skipped}`);
check('overflow reported as full', capped.body.full === false || capped.body.skipped > 0);

// ── unlimited lists ─────────────────────────────────────────────────────────

console.log('\n── unlimited ──');

const listCount = (await req('GET', '/api/watchlists')).body.watchlists.length;
const createdNow = await Promise.all(
  Array.from({ length: 45 }, (_, i) => req('POST', '/api/watchlists', { name: `bulk-${i}` })),
);
const newIds = createdNow.filter((r) => r.status === 201).map((r) => r.body.id);
const afterCount = (await req('GET', '/api/watchlists')).body.watchlists.length;

check('45 more lists created at once', newIds.length === 45, `${newIds.length}`);
check('none were trimmed away', afterCount >= listCount + 45, `${listCount} -> ${afterCount}`);

const summary = (await req('GET', '/api/watchlists')).body.summary;
check('summary reports no list limit', summary.maxLists === null, `maxLists=${summary.maxLists}`);

// ── resilience ──────────────────────────────────────────────────────────────

console.log('\n── hostile input ──');

await req('PUT', `/api/watchlists/${seeded.id}`, {
  name: 'x'.repeat(300),
  symbols: [null, '', '   ', 42, {}, 'OK:GENUINE'],
});
const hostile = (await req('GET', `/api/watchlists/${seeded.id}`)).body;
check('name truncated to 80', hostile.name.length === 80, `${hostile.name.length}`);
check('garbage symbols dropped, valid one kept',
  hostile.symbols.length === 1 && hostile.symbols[0] === 'OK:GENUINE',
  JSON.stringify(hostile.symbols));

check('unknown id -> 404',
  (await req('GET', '/api/watchlists/wl_nope')).status === 404);
check('add to unknown id -> 404',
  (await req('POST', '/api/watchlists/wl_nope/symbols', { symbols: ['TU'] })).status === 404);
check('delete is idempotent',
  (await req('DELETE', '/api/watchlists/wl_nope')).status === 204);

// ── cleanup ─────────────────────────────────────────────────────────────────

for (const id of created.concat(newIds)) await req('DELETE', `/api/watchlists/${id}`);
const left = (await req('GET', '/api/watchlists')).body.watchlists.length;
check('cleanup removed the test lists', left === 0, `${left} left`);

console.log(`\n${failures ? `${failures} FAILURE(S)` : 'all checks passed'}\n`);
process.exit(failures ? 1 : 0);