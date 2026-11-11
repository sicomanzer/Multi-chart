import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp,rm,rmdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {loadBankRisk,selectBankRisk,validRiskMetric} from '../server/bank-risk.js';
import {scoreQuality} from '../server/screener.js';
import {bankCalendarDate} from '../server/business-models.js';
import {loadStatementVersions} from '../server/statement-versions.js';
import {backtestCompany} from '../server/backtest.js';
assert.equal(bankCalendarDate('2026-11-11T18:00:00Z'),'2026-11-12');
const rows=await loadBankRisk();assert.equal(rows.length,64);
assert.ok(rows.every(r=>Object.values(r.metrics).every(m=>m.integrityVerified)));
const at='2026-12-01';
let complete=0;
for(const row of rows.filter(r=>r.fiscalYear===2025)){
 const selected=selectBankRisk(rows,row.symbol,2025,at);
 if(['capitalAdequacy','npl','nplCoverage'].every(k=>selected[k]!=null))complete++;
 assert.ok(selectBankRisk(rows,row.symbol,2024,at));
 const before=selectBankRisk(rows,row.symbol,2025,'2025-12-31',{historical:true});
 assert.equal(before.npl,null);assert.equal(before.metrics.npl.reportedPercent,null);
}
assert.equal(complete,7);
const bbl=selectBankRisk(rows,'SET:BBL',2025,at);
assert.equal(bbl.npl,.03);assert.ok(Math.abs(bbl.capitalAdequacy-.2178)<1e-12);
const kkp=selectBankRisk(rows,'SET:KKP',2025,at);
assert.ok(Math.abs(kkp.npl-.044)<1e-12);assert.ok(Math.abs(kkp.nplCoverage-1.372)<1e-12);assert.equal(kkp.metrics.npl.reportedPercent,4.4);
assert.equal(kkp.basis,'group-capital-and-reported-banking-portfolio');
assert.equal(kkp.metrics.npl.reason,null);
const unlabelledKKP=structuredClone(rows.find(r=>r.symbol==='SET:KKP'));
delete unlabelledKKP.assessmentProfile;
assert.equal(selectBankRisk([unlabelledKKP],'SET:KKP',2025,at).npl,null);
const wrongIssuer=structuredClone(rows.find(r=>r.symbol==='SET:KKP'));
wrongIssuer.symbol='SET:BBL';
assert.equal(selectBankRisk([wrongIssuer],'SET:BBL',2025,at).npl,null);
const tisco=rows.find(r=>r.symbol==='SET:TISCO'&&r.fiscalYear===2025);const date=tisco.metrics.capitalAdequacy.availableFrom;
assert.equal(selectBankRisk(rows,'SET:TISCO',2025,date,{historical:true}).capitalAdequacy,null);
assert.equal(selectBankRisk(rows,'SET:TISCO',2025,date).capitalAdequacy,.1897);
assert.equal(selectBankRisk(rows,'SET:TISCO',2025,tisco.metrics.capitalAdequacy.historicalAvailableFrom,{historical:true}).capitalAdequacy,.1897);
const bankOnly=structuredClone(rows.find(r=>r.symbol==='SET:BBL'));bankOnly.metrics.npl.scope='bank-only';
assert.equal(selectBankRisk([bankOnly],'SET:BBL',2025,at).npl,null);
const projected=structuredClone(bankOnly);projected.metrics.capitalAdequacy.status='projected';
assert.equal(selectBankRisk([projected],'SET:BBL',2025,at).capitalAdequacy,null);
const conflict=structuredClone(bankOnly);conflict.metrics.capitalAdequacy.value=.99;
assert.equal(selectBankRisk([bankOnly,conflict],'SET:BBL',2025,at).capitalAdequacy,null);
const m=rows[0].metrics.npl;
assert.equal(validRiskMetric({...m,availableFrom:'2026-01-01'},'npl',2025),false);
assert.equal(validRiskMetric({...m,value:3.2},'npl',2025),false);
const years=[2023,2024,2025].map(fiscalYear=>({fiscalYear,roe:.11,roa:.012,netIncome:100}));
const quality=scoreQuality({years,dividends:[],price:10,isBank:true,bankRisk:selectBankRisk(rows,'SET:KBANK',2025,at),asOf:new Date(at)});
assert.equal(quality.bankRiskComplete,true);assert.equal(quality.checks.find(c=>c.id==='bankNpl').pass,false);
const kkpQuality=scoreQuality({years,dividends:[],price:10,isBank:true,bankRisk:kkp,asOf:new Date(at)});
assert.equal(kkpQuality.bankRiskComplete,true);
assert.equal(kkpQuality.checks.find(c=>c.id==='bankNpl').pass,false);
assert.equal(kkpQuality.checks.find(c=>c.id==='bankNplCoverage').pass,false);
let historyComplete=0;
for(const r of rows){
 const selected=selectBankRisk(rows,r.symbol,r.fiscalYear,at,{historical:true});
 if(['capitalAdequacy','npl','nplCoverage'].every(k=>selected[k]!=null))historyComplete++;
 for(const [key,m] of Object.entries(r.metrics)){
  const before=selectBankRisk(rows,r.symbol,r.fiscalYear,m.publishedAt??m.availableFrom,{historical:true});
  assert.equal(before[key],null,`${r.symbol} ${r.fiscalYear} ${key}: announcement day cannot be used`);
 }
}
assert.equal(historyComplete,49);
assert.equal(selectBankRisk(rows,'SET:SCB',2021,at),null);
assert.equal(selectBankRisk(rows,'SET:TTB',2019,at).metrics.capitalAdequacy.reason,'scope-unresolved');
assert.equal(selectBankRisk(rows,'SET:TTB',2020,at).metrics.nplCoverage.reason,'not-reported');
assert.equal(selectBankRisk(rows,'SET:TISCO',2024,at).metrics.capitalAdequacy.reason,'status-not-eligible');
const tisco2020=selectBankRisk(rows,'SET:TISCO',2020,'2021-03-31',{historical:true});
assert.ok(Math.abs(tisco2020.capitalAdequacy-.219)<1e-12);
assert.equal(tisco2020.npl,.025);
assert.ok(Math.abs(tisco2020.nplCoverage-2.105)<1e-12);
// Actual reviewed statement/risk integration; prices are test fixtures, not a return claim.
const replay={symbol:'SET:TISCO',history:[],statementVersions:await loadStatementVersions(),
 publicationMode:'original',rebalances:['2021-05-01'],holdYears:3,
 closes:[{date:'2021-05-01',close:10},{date:'2024-05-01',close:12}]};
const observed=backtestCompany({...replay,bankRiskRecords:rows});
assert.equal(observed.length,1);assert.equal(observed[0].fiscalYear,2020);
assert.equal(observed[0].bankRiskComplete,true);
assert.ok(observed[0].checks.filter(c=>c.id.startsWith('bank')).every(c=>c.pass===true));
const removed=backtestCompany({...replay,bankRiskRecords:rows.filter(r=>r.fiscalYear!==2020)});
assert.equal(removed[0].bankRiskComplete,false);
assert.ok(removed[0].checks.filter(c=>c.id.startsWith('bank')).every(c=>c.pass===null));
const dir=await mkdtemp(join(tmpdir(),'bank-risk-'));
try{
 const data=JSON.parse(await readFile('data/bank-risk.json','utf8'));
 data.rows[0].metrics.npl.sha256='0'.repeat(64);
 const file=join(dir,'tampered.json');await writeFile(file,JSON.stringify(data));
 const bad=await loadBankRisk({file});
 assert.equal(selectBankRisk(bad,data.rows[0].symbol,2025,at).npl,null);
}finally{await rm(join(dir,'tampered.json'),{force:true});await rmdir(dir);}
console.log('Official bank risk evidence, release-date bindings, scope/projected exclusions, date cutoffs and integrity checks passed');
