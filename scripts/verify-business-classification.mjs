import assert from 'node:assert/strict';
import {businessClassification,reviewedBusinessClassifications,applyReviewedBusinessModel} from '../server/business-models.js';
import {buildRow,SET100} from '../server/screener-run.js';
import {applyPreset,presetById} from '../server/screener.js';
const rows=reviewedBusinessClassifications();
assert.equal(rows.length,110);
for(const bare of SET100)assert.notEqual(businessClassification(`SET:${bare}`).model,'unknown',bare);
assert.equal(businessClassification('SET:KTC').model,'nonbank-financial');
assert.equal(businessClassification('SET:TLI').model,'insurance');
assert.equal(businessClassification('SET:KBANK').model,'bank');
assert.equal(businessClassification('SET:TCAP').model,'unsupported-bank');
assert.equal(businessClassification('SET:PTTEP').model,'general');
assert.equal(businessClassification('SET:UNREVIEWED').isFinancial,null);
const fixture={symbol:'SET:KTC',bare:'KTC',years:[],dividends:[],closes:[],ttm:{},price:35.75};
// A provider returning true, false or nothing must not change KTC eligibility.
const outcomes=[true,false,null].map(providerFlag=>{
  return buildRow(applyReviewedBusinessModel({...fixture,isFinancial:providerFlag}));
});
assert.deepEqual(outcomes[0],outcomes[1]);assert.deepEqual(outcomes[1],outcomes[2]);
for(const row of outcomes){
  assert.equal(row.score,null);assert.equal(row.dataIssue,'financial-framework-not-supported');
  assert.equal(applyPreset(row,presetById('income')).pass,false);
}
for(const identity of rows){
  const input={symbol:identity.evidence.symbol};
  assert.deepEqual(applyReviewedBusinessModel({...input,isFinancial:true}),applyReviewedBusinessModel({...input,isFinancial:false}));
  assert(identity.evidence.source.startsWith('https://www.set.or.th/'));
  assert(identity.evidence.asOf);assert(identity.model!=='unknown');
  if(!['bank','general'].includes(identity.model))assert(identity.dataIssue);
}
console.log('All 110 business identities reviewed; all SET100 covered; KTC provider-outage parity and unsupported-model exclusion passed');
