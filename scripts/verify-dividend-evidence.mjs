import assert from 'node:assert/strict';import{loadDividendEvidence,compareDividendPeriod}from'../server/dividend-evidence.js';import{readFile}from'node:fs/promises';import{createHash}from'node:crypto';
const records=JSON.parse(await readFile('data/dividend-source-manifest.json','utf8')).records;assert.equal(records.length,110);
for(const r of records){assert.ok(!r.error,r.symbol);const raw=await readFile(r.evidenceFile);assert.equal(createHash('sha256').update(raw).digest('hex'),r.sha256);assert.ok(JSON.parse(raw).every(a=>a.symbol===r.symbol.slice(4)));}
const e=await loadDividendEvidence('SET:KTB',new Date('2026-11-11'));assert.equal(e.reviews.length,1);assert.equal(e.reviews[0].regularDps,2.07);assert.equal(e.reviews[0].specialDps,.6);
const p=compareDividendPeriod(e.actions,'2025-12-31',2.67,new Date('2026-11-11'));assert.equal(p.status,'matched');assert.ok(Math.abs(p.officialCashTotal-2.67)<1e-10);assert.equal(p.payments.length,2);assert.ok(p.payments.every(r=>r.endOperation.startsWith('2025')));
assert.equal(compareDividendPeriod(e.actions,'2025-12-31',2.07,new Date('2026-11-11')).status,'different'); // compare total with total, not regular
assert.equal(compareDividendPeriod(e.actions,'invalid',2.67).status,'unavailable');
assert.equal(compareDividendPeriod(e.actions,'2025-12-31',2.67,new Date('2026-11-10')).status,'unavailable');
assert.equal((await loadDividendEvidence('SET:KTB',new Date('2026-11-10'))).reviews.length,0);
const incomplete={...e.actions,rows:e.actions.rows.filter(r=>r.endOperation?.slice(0,10)==='2025-06-30')};assert.equal(compareDividendPeriod(incomplete,'2025-12-31',.43,new Date('2026-11-11')).status,'period-incomplete');
console.log('110 official action files and KTB declaration hashes, cash periods, special/total separation and observation-date gates verified');
