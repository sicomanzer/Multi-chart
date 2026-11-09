import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseSetFundamentals } from '../server/set-fundamentals.js';

const symbol = 'SET:TEST';
const trading = [{date:'2026-11-06',close:100,pe:10,pbv:2,dividendYield:4}];
const statements = [{asOfDate:'2026-06-30',deRatio:6,roe:8,roa:1,currentRatio:null,quickRatio:null}];
const row = parseSetFundamentals(symbol,trading,statements);
assert.equal(row.price,100);
assert.equal(row.de.value,6); // SET liabilities/equity, not interest-bearing debt/equity.
assert.equal(row.pe.value,10);
assert.equal(row.dividendYield.value,4); // Keep percentage points; no rebasing to a live quote.
assert.equal(row.asOf,'2026-11-06');
assert.equal(row.financialAsOf,'2026-06-30');
assert.equal(row.quickRatio.value,null);
assert.equal(parseSetFundamentals(symbol,[{...trading[0],pe:null}],statements).pe.value,null);
assert.equal(parseSetFundamentals(symbol,[{...trading[0],date:'2025-01-01',pe:99},...trading],statements).pe.value,10);
assert.throws(()=>parseSetFundamentals(symbol,[],statements));
const seed=JSON.parse(await readFile(new URL('../data/set-fundamentals.json',import.meta.url),'utf8'));
assert.equal(new Set(seed.rows.map(r=>r.symbol)).size,44);
assert.ok(seed.rows.every(r=>r.source==='set.or.th'&&r.asOf&&r.financialAsOf));
console.log('SET ratio source, dates, nulls and snapshot checks passed');
