import assert from 'node:assert/strict';
import{auditScreeningRow}from'../server/screener-audit.js';
const row={score:80,scoringYearCount:3,dataCoverage:1,checks:[],dividendFy:2025,payout:.5,payoutEvidence:{fiscalYear:2025,eps:2,dps:1},roe3:.15,ddm:{ok:true,d0:1},residualIncome:{ok:true},dividendClassification:'issuer-verified'};
assert.equal(auditScreeningRow(row).status,'consistent');
for(const bad of [{...row,scoringYearCount:0},{...row,dataCoverage:2},{...row,payout:.9},{...row,ddm:{ok:true,d0:9}},{...row,payout:null}])assert.equal(auditScreeningRow(bad).status,'error');
const inferred=auditScreeningRow({...row,dividendClassification:'unreviewed'});assert.equal(inferred.status,'needs-review');assert.ok(inferred.issues.some(i=>i.code==='regular-dividend-unverified'));
const missing=auditScreeningRow({...row,payoutEvidence:{...row.payoutEvidence,fiscalYear:2024}});assert.ok(missing.issues.some(i=>i.code==='payout-period-unverified'));
console.log('All-symbol consistency checks distinguish invalid math, missing input and unreviewed issuer evidence');
