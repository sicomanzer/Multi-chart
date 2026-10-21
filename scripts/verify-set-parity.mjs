/**
 * Check the screen against the exchange.
 *
 * The numbers on this desk are going to be used with real money, so they are
 * checked against the only authority that publishes the same figures:
 * set.or.th. Every name in the index is compared on the multiple, the yield
 * and the statement lines, and every difference is printed with the size of it.
 *
 * A difference is not automatically a fault. The exchange computes a P/E from
 * earnings in *total*, while the screen uses earnings attributable to the
 * owners, so a company with large minority interests reads higher here than
 * there. The report prints both figures so the difference can be judged rather
 * than guessed at.
 *
 * Usage:
 *   node scripts/verify-set-parity.mjs [--api http://127.0.0.1:8787] [--tol 0.05]
 */
import { SET100 } from '../server/screener-run.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36';
const PAGE = 'https://www.set.or.th/th/market/product/stock/quote/BH/price';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
};

const API = arg('api', 'http://127.0.0.1:8787');
const TOL = Number(arg('tol', 0.05)); // the size a difference has to reach to be printed

/** The exchange's own figures, fetched the way the browser would. */
async function setData(symbols) {
  const page = await fetch(PAGE, { headers: { 'User-Agent': UA, Accept: 'text/html' } });
  const cookie = (page.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');
  const headers = {
    'User-Agent': UA,
    Accept: 'application/json',
    Referer: PAGE,
    ...(cookie ? { Cookie: cookie } : {}),
  };
  const out = {};
  for (const symbol of symbols) {
    try {
      const [ts, fd] = await Promise.all([
        fetch(`https://www.set.or.th/api/set/stock/${symbol}/company-highlight/trading-stat?lang=en`, { headers }).then((r) => r.json()),
        fetch(`https://www.set.or.th/api/set/stock/${symbol}/company-highlight/financial-data?lang=en`, { headers }).then((r) => r.json()),
      ]);
      const t = (Array.isArray(ts) ? ts[ts.length - 1] : ts) || {};
      const annual = (Array.isArray(fd) ? fd : [])
        .filter((y) => y.quarter === 'Q9')
        .map((y) => ({
          y: y.year,
          eps: y.eps,
          np: y.netProfit,
          rev: y.totalRevenue,
          roe: y.roe,
          de: y.deRatio,
          npm: y.netProfitMargin,
        }));
      out[symbol] = { ...t, annual };
    } catch (err) {
      out[symbol] = { error: String(err?.message ?? err).slice(0, 80) };
    }
  }
  return out;
}

/** How far apart two numbers are, as a fraction of the exchange's. */
const gap = (ours, theirs) => {
  if (typeof ours !== 'number' || typeof theirs !== 'number') return null;
  if (!Number.isFinite(ours) || !Number.isFinite(theirs) || theirs === 0) return null;
  return (ours - theirs) / Math.abs(theirs);
};

const pct = (v) => (v == null ? '—' : `${(v * 100).toFixed(2)}%`);
const num = (v, digits = 2) => (typeof v === 'number' && Number.isFinite(v) ? v.toFixed(digits) : '—');

/** The two figures behind a difference, so it can be judged. */
function figures(row, key) {
  const mine = row.mine ?? {};
  const set = row.set ?? {};
  const last = set.annual?.[set.annual.length - 1] ?? null;
  const year = mine.years?.[mine.years.length - 1] ?? null;
  switch (key) {
    case 'pe': return `ours ${num(mine.pe)}x · set ${num(set.pe)}x`;
    case 'pbv': return `ours ${num(mine.pbv)}x · set ${num(set.pbv)}x`;
    case 'yield': return `ours ${pct(mine.dividendYield)} · set ${pct(set.dividendYield != null ? set.dividendYield / 100 : null)}`;
    case 'eps': return `ours ${num(mine.ttmEps)} · set ${num(set.pe ? set.close / set.pe : null)}`;
    case 'roe': return `ours ${pct(year?.roe)} · set ${pct(last?.roe != null ? last.roe / 100 : null)}`;
    case 'npm': return `ours ${pct(year?.npm)} · set ${pct(last?.npm != null ? last.npm / 100 : null)}`;
    case 'np': return `ours ${num(year?.netIncome / 1e6, 0)}m · set ${num(last?.np / 1000, 0)}m`;
    case 'rev': return `ours ${num(year?.revenue / 1e6, 0)}m · set ${num(last?.rev / 1000, 0)}m`;
    case 'de': return `ours ${num(year?.de, 3)} · set ${num(last?.de, 3)}`;
    default: return '';
  }
}

async function main() {
  console.log(`checking ${SET100.length} names against set.or.th (tolerance ${(TOL * 100).toFixed(0)}%)\n`);

  // The details, one by one: the table carries the three-year averages and the
  // comparison is against a single year.
  const ours = new Map();
  let next = 0;
  const runners = Array.from({ length: 5 }, async () => {
    while (next < SET100.length) {
      const symbol = SET100[next];
      next += 1;
      try {
        const detail = await fetch(`${API}/api/screener/stock?symbol=SET:${symbol}`).then((r) => r.json());
        if (detail?.symbol) ours.set(symbol, detail);
      } catch {
        // A name the server cannot answer is not compared.
      }
    }
  });
  await Promise.all(runners);

  const theirs = await setData(SET100);

  const rows = [];
  for (const symbol of SET100) {
    const mine = ours.get(symbol);
    const set = theirs[symbol];
    if (!mine || !set || set.error) continue;
    const last = set.annual?.[set.annual.length - 1] ?? null;
    const year = mine.years?.[mine.years.length - 1] ?? null;
    rows.push({
      symbol,
      pe: gap(mine.pe, set.pe),
      pbv: gap(mine.pbv, set.pbv),
      yield: gap(mine.dividendYield, set.dividendYield != null ? set.dividendYield / 100 : null),
      eps: gap(mine.ttmEps, set.pe ? set.close / set.pe : null),
      roe: gap(year?.roe, last?.roe != null ? last.roe / 100 : null),
      npm: gap(year?.npm, last?.npm != null ? last.npm / 100 : null),
      np: gap(year?.netIncome, last?.np != null ? last.np * 1000 : null),
      rev: gap(year?.revenue, last?.rev != null ? last.rev * 1000 : null),
      de: gap(year?.de, last?.de),
      mine,
      set,
    });
  }

  const measures = [
    ['P/E', 'pe'],
    ['P/BV', 'pbv'],
    ['Yield', 'yield'],
    ['EPS (TTM)', 'eps'],
    ['ROE', 'roe'],
    ['Net margin', 'npm'],
    ['Net profit', 'np'],
    ['Revenue', 'rev'],
    ['D/E', 'de'],
  ];

  let problems = 0;
  for (const [label, key] of measures) {
    const values = rows.map((r) => r[key]).filter((v) => v != null);
    const over = rows.filter((r) => r[key] != null && Math.abs(r[key]) > TOL);
    const worst = values.slice().sort((a, b) => Math.abs(b) - Math.abs(a))[0];
    const median = values.slice().sort((a, b) => a - b)[Math.floor(values.length / 2)];
    console.log(
      `${label.padEnd(12)} compared ${String(values.length).padStart(3)}`
      + ` · median gap ${pct(median).padStart(8)}`
      + ` · worst ${pct(worst).padStart(8)}`
      + ` · over ${(TOL * 100).toFixed(0)}%: ${over.length}`,
    );
    for (const row of over) {
      problems += 1;
      console.log(`    ${row.symbol.padEnd(8)} ${pct(row[key]).padStart(9)}  ${figures(row, key)}`);
    }
  }
  console.log(`\n${problems} figure(s) over the tolerance across ${rows.length} names`);
}

await main();
