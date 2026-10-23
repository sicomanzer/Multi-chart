/**
 * Rebuild the tracked long annual history.
 *
 * The deep dive's charts want ten fiscal years of net profit, revenue, EPS,
 * net margin and leverage. Yahoo serves four annual periods per symbol and the
 * exchange the same, so those numbers come from Finnomena's public market-info
 * API — which the deployed container cannot always reach, because the host sits
 * behind a bot filter that a container's address does not pass.
 *
 * So the history is also kept as a file in the repository, the same way the
 * boards and watchlists are: the deploy boots from it, and the charts draw
 * whether or not the upstream answer arrives. Annual figures change once a
 * year, so a tracked file stays true for a long time; run this script again
 * after the fiscal year closes, or whenever a number looks stale.
 *
 * Usage: node scripts/refresh-annual-history.mjs [--out data/annual-history.json]
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { liveAnnualHistory, clearFinnomenaCache, HISTORY_YEARS } from '../server/finnomena.js';
import { SET100, SET_LARGE_CAPS } from '../server/screener-run.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

const outArg = process.argv.indexOf('--out');
const OUT = resolve(ROOT, outArg >= 0 ? process.argv[outArg + 1] : 'data/annual-history.json');

/** Every symbol the app knows about: the index, the boards and the lists. */
async function collectSymbols() {
  const symbols = new Set([...SET100, ...SET_LARGE_CAPS].map((s) => String(s).toUpperCase()));
  for (const file of ['data/workspaces.json', 'data/watchlists.json']) {
    try {
      const raw = JSON.parse(await readFile(join(ROOT, file), 'utf8'));
      for (const ws of raw.workspaces ?? []) {
        for (const chart of ws.charts ?? []) {
          const sym = String(chart.symbol ?? '').split(':').pop();
          if (sym) symbols.add(sym.toUpperCase());
        }
      }
      for (const wl of raw.watchlists ?? []) {
        for (const sym of wl.symbols ?? []) {
          const bare = String(sym).split(':').pop();
          if (bare) symbols.add(bare.toUpperCase());
        }
      }
    } catch {
      // A missing board file is not a reason to skip the index.
    }
  }
  return [...symbols].sort();
}

async function main() {
  const symbols = await collectSymbols();
  console.log(`fetching ${symbols.length} symbols (${HISTORY_YEARS} years each)`);

  const out = {};
  const missing = [];
  // The upstream is a public site, not a paid API: stay polite and take a
  // handful at a time.
  const CONCURRENCY = 4;
  let next = 0;
  const runners = Array.from({ length: Math.min(CONCURRENCY, symbols.length) }, async () => {
    while (next < symbols.length) {
      const symbol = symbols[next];
      next += 1;
      const history = await liveAnnualHistory(symbol);
      if (!history || (history.years.length === 0 && history.quarters.length === 0)) {
        missing.push(symbol);
        continue;
      }
      out[symbol] = {
        years: history.years.map((y) => ({
          y: y.fiscalYear,
          asOf: y.asOf,
          np: y.netIncome,
          rev: y.revenue,
          gp: y.grossProfit,
          eps: y.eps,
          npm: y.npm,
          gpm: y.gpm,
          de: y.de,
          roe: y.roe,
          roa: y.roa,
          cfo: y.operatingCashFlow,
          debt: y.totalDebt,
          equity: y.equity,
          asset: y.assets,
          divYield: y.dividendYield,
          close: y.close,
        })),
      };
      process.stdout.write(`  ${symbol} ${history.years.length}y\n`);
    }
  });
  await Promise.all(runners);

  const payload = {
    version: 1,
    generatedAt: new Date().toISOString(),
    source: 'finnomena public market-info API',
    years: HISTORY_YEARS,
    symbols: out,
  };
  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, `${JSON.stringify(payload)}\n`, 'utf8');

  console.log(`\nwrote ${OUT}`);
  console.log(`  symbols: ${Object.keys(out).length}/${symbols.length}`);
  if (missing.length) console.log(`  missing: ${missing.join(', ')}`);
  if (missing.length) process.exitCode = 1;
}

clearFinnomenaCache();
await main();
