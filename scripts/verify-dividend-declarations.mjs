import assert from 'node:assert/strict';import{readFile}from'node:fs/promises';import{parseCashDeclarations}from'../server/dividend-declarations.js';import{loadDividendEvidence}from'../server/dividend-evidence.js';import{sustainableDividend}from'../server/screener.js';
const html=await readFile('data/dividend-evidence/KTB-2025-announcement.html','utf8');const parsed=parseCashDeclarations(html);assert.ok(parsed.some(p=>p.regularDps===1.64&&p.specialDps===.6&&Math.abs(p.totalDps-2.24)<1e-10));assert.ok(!parsed.some(p=>p.regularDps===1.7945)); // preferred shares cannot enter common-share DPS
assert.deepEqual(parseCashDeclarations('<p>2025 special dividend 0.6, total 2.67</p>'),[]); // prose alone is not a structured declaration
const reviews=JSON.parse(await readFile('data/dividend-reviews.json')).rows;assert.equal(reviews.length,62);
for(const r of reviews){const loaded=await loadDividendEvidence(r.symbol);assert.ok(loaded.reviews.length,r.symbol);assert.ok(Math.abs(r.regularDps+r.specialDps-r.totalDps)<1e-8);}
for(const symbol of ['SET:MRDIYT','SET:TFG','SET:TRUE']){
 const r=reviews.find(r=>r.symbol===symbol);assert.equal(r.periodVerified,true);
 const d=sustainableDividend({years:[{fiscalYear:2025,asOf:'2025-12-31',regularDividend:r}],dividends:[{date:'2026-05-01',amount:r.totalDps+1}],asOf:new Date('2026-11-11')});
 assert.equal(d.annual,r.totalDps);assert.equal(d.d0,r.regularDps); // explicit operating-period evidence overrides a mismatched payment window
}
console.log('62 issuer/year cash declarations bind all component notices and operating-period evidence; preferred shares and unsupported prose excluded');
