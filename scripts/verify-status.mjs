/**
 * Verifies the data-status contract the MCP dialog renders.
 *
 * The panel is only honest if `/api/health?deep=1` carries the timestamps and
 * cache facts behind each light. This suite pins that shape: a field the UI
 * reads but the endpoint forgets would otherwise show as a blank card rather
 * than as a failed test.
 */
const BASE = process.env.API ?? 'http://127.0.0.1:8799';

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '  PASS' : '  FAIL'}  ${name}${ok ? '' : `  <- ${detail}`}`);
  if (!ok) failures += 1;
};

const req = async (method, path) => {
  const res = await fetch(BASE + path, { method });
  const text = await res.text();
  let parsed = null;
  try { parsed = JSON.parse(text); } catch { parsed = text; }
  return { status: res.status, body: parsed };
};

console.log('\n── health shape ──');

const { status, body: h } = await req('GET', '/api/health?deep=1');

check('health answers 200', status === 200, `HTTP ${status}`);
check('status is ok', h?.status === 'ok', JSON.stringify(h?.status));
check('server block carries a clock, server-local day and uptime',
  typeof h?.server?.now === 'string'
  && /^\d{4}-\d{2}-\d{2}$/.test(h?.server?.today ?? '')
  && Number.isFinite(h?.server?.uptimeSeconds),
  JSON.stringify(h?.server));
check('server block carries a commit field (null on a laptop is valid)',
  Object.hasOwn(h?.server ?? {}, 'commit'),
  JSON.stringify(h?.server));
check('MCP block carries a ping result',
  h?.mcp && typeof h.mcp.ping === 'object' && typeof h.mcp.ping.ok === 'boolean',
  JSON.stringify(h?.mcp?.ping));
check('candles expose both cache TTLs',
  h?.candles?.caches?.daily?.ttlMs > 0 && h?.candles?.caches?.intraday?.ttlMs > 0,
  JSON.stringify(h?.candles));
check('fundamentals expose TTL and last-fetch fields',
  h?.fundamentals?.ttlMs > 0
  && Object.hasOwn(h.fundamentals, 'lastFetchAt')
  && Object.hasOwn(h.fundamentals, 'lastSuccessAt'),
  JSON.stringify(h?.fundamentals));
check('annual history exposes generatedAt/source metadata',
  Object.hasOwn(h?.annualHistory?.dataset ?? {}, 'generatedAt')
  && Object.hasOwn(h.annualHistory.dataset, 'source'),
  JSON.stringify(h?.annualHistory?.dataset));
check('daily history exposes lastWriteAt',
  Object.hasOwn(h?.history ?? {}, 'lastWriteAt'),
  JSON.stringify(h?.history));
check('rule-edge block exposes freshness',
  h?.backtest && typeof h.backtest.fresh === 'boolean' && Object.hasOwn(h.backtest, 'at'),
  JSON.stringify(h?.backtest));
check('screener block is present (null before the first run)',
  h && Object.hasOwn(h, 'screener'),
  JSON.stringify(h?.screener));

console.log(failures ? `\n${failures} status check(s) failed\n` : '\nstatus checks passed\n');
process.exit(failures ? 1 : 0);
