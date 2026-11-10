import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseSetFundamentals } from '../server/set-fundamentals.js';
import { scoreQuality } from '../server/screener.js';
import { reconcileYears, buildRow, currentMultiples } from '../server/screener-run.js';

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
const short = scoreQuality({ years: [{fiscalYear:2025,roe:.2,roa:.1,npm:.2,netIncome:100,freeCashFlow:100}], dividends: [], price:10 });
for (const id of ['roeLevel','roeConsistency','roaLevel','npmLevel','npmTrend','fcfPositive']) {
  assert.equal(short.checks.find(c=>c.id===id).pass,null,id+' needs a sufficient history');
}
const official = [{fiscalYear:2025,asOf:'2025-12-31',roe:.1,roa:.0643,npm:.0435,de:.9786}];
const fixed = reconcileYears([{fiscalYear:2025,netIncome:100,roe:.2,roa:.0269,npm:.03,de:99}],[],official)[0];
assert.equal(fixed.roa,.0643);
assert.equal(fixed.de,.9786);
assert.equal(fixed.ratioSource,'set.or.th');
assert.deepEqual(currentMultiples({officialMultiples:{pe:12.72,pbv:1.46}}),{peCurrent:12.72,pbvCurrent:1.46});
assert.equal(reconcileYears([{fiscalYear:2024,roa:.2}],[],official)[0].roa,null);
const mint=seed.rows.find(r=>r.symbol==='SET:MINT').annualYears.find(y=>y.fiscalYear===2025);
assert.ok(Math.abs(mint.de-2.6843557803655758)<1e-10);
const reit=seed.rows.find(r=>r.symbol==='SET:CPNREIT');
assert.equal(reit.accountFormId,'5');
const unknown=buildRow({symbol:'SET:CPNREIT',years:[],dataIssue:'reit-framework-not-supported'});
assert.equal(unknown.score,null);
assert.equal(unknown.ddm.reason,'reit-framework-not-supported');
console.log('Screener history minimums, SET annual overrides and REIT exclusion checks passed');
