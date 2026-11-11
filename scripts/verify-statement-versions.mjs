import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {loadStatementVersions,selectStatementVersions,validStatementVersion} from '../server/statement-versions.js';
import {backtestCompany} from '../server/backtest.js';
import {archiveObservation} from './statement-archive-observation.mjs';

const versions=await loadStatementVersions();
assert.equal(archiveObservation({sha256:'old',retrievedAt:'2020-01-01'},'new','2026-11-11T01:00:00Z').notBefore,'2026-11-12');
assert.equal(archiveObservation({sha256:'old',retrievedAt:'2020-01-01'},'old','2026-11-11T01:00:00Z').retrievedAt,'2020-01-01');
assert.ok(versions.length>=86);
assert.equal(new Set(versions.map(r=>r.symbol)).size,14);
for(const row of versions){
  assert.equal(createHash('sha256').update(await readFile(row.evidenceFile)).digest('hex'),row.sha256);
  assert.ok(validStatementVersion(row));
  assert.equal(validStatementVersion({...row,reviewed:false}),false);
  assert.equal(validStatementVersion({...row,source:'https://example.com/forged'}),false);
  assert.equal(validStatementVersion({...row,unit:'million THB'}),false);
  assert.equal(validStatementVersion({...row,availableFrom:'2020-02-30'}),false);
  assert.equal(selectStatementVersions([row],row.symbol,'2016-01-01').length,0);
}
const first=versions.find(r=>r.symbol==='SET:PTT'&&r.fiscalYear===2016&&r.scope==='audited-consolidated-current-year');
const changed={...first,availableFrom:'2020-04-01',fields:{...first.fields,netIncome:1}};
const before=selectStatementVersions([...versions,changed],'SET:PTT','2019-03-31');
assert.equal(before.find(r=>r.fiscalYear===2016).netIncome,94609078240);
assert.equal(selectStatementVersions([...versions,changed],'SET:PTT','2020-04-01').find(r=>r.fiscalYear===2016).netIncome,1);
assert.deepEqual(selectStatementVersions([...versions,changed].reverse(),'SET:PTT','2020-04-01'),
  selectStatementVersions([...versions,changed],'SET:PTT','2020-04-01'));
assert.equal(selectStatementVersions([first,{...first,fields:{...first.fields,netIncome:1}}],'SET:PTT','2020-04-01').length,0);
const revised2018=versions.find(r=>r.symbol==='SET:PTT'&&r.fiscalYear===2018&&r.scope==='audited-consolidated-comparative');
assert.equal(selectStatementVersions(versions,'SET:PTT',revised2018.availableFrom).find(r=>r.fiscalYear===2018).netIncome,119647246552);
assert.equal(selectStatementVersions(versions,'SET:PTT',revised2018.availableFrom).find(r=>r.fiscalYear===2018).roa,null);
assert.equal(before.find(r=>r.fiscalYear===2018).eps,null); // never compare unreconciled share units
assert.equal(selectStatementVersions(versions,'SET:AEONTS','2020-04-01').length,0);
const bank=selectStatementVersions(versions,'SET:KBANK','2026-04-01').at(-1);
assert.equal(bank.statementModel,'bank');
assert.equal(bank.ebit,null);
assert.equal(bank.operatingCashFlow,null);
assert.ok(bank.roa>0&&bank.roa<.05);
assert.equal(validStatementVersion({...versions.find(r=>r.statementModel==='bank'),symbol:'SET:AEONTS'}),false);
const closes=[{date:'2019-04-01',close:10},{date:'2022-04-01',close:13}];
const contaminated=[{fiscalYear:2018,netIncome:999999999999999}];
const args={symbol:'SET:PTT',history:contaminated,closes,rebalances:['2019-03-31'],holdYears:3,publicationMode:'original',statementVersions:versions};
const result=backtestCompany(args);
assert.equal(result.length,1);
assert.equal(result[0].entryPriceDate,'2019-04-01');
assert.equal(result[0].statementSnapshots.length,3);
assert.deepEqual(result,backtestCompany({...args,history:[]})); // no provider fallback or contamination
assert.equal(backtestCompany({...args,statementVersions:[]}).length,0);
assert.equal(backtestCompany({...args,history:[{fiscalYear:2019,asOf:'2019-12-31',publishedAt:'2020-03-15',publicationSource:first.source}],
  statementVersions:versions.filter(r=>r.symbol==='SET:PTT'&&r.fiscalYear<=2018),
  closes:[{date:'2020-04-01',close:10},{date:'2023-04-01',close:13}],rebalances:['2020-03-31']}).length,0);
assert.equal(backtestCompany({...args,statementVersions:versions.filter(r=>r.symbol==='SET:PTT'&&r.fiscalYear<=2018),
  closes:[{date:'2021-04-01',close:10},{date:'2024-04-01',close:13}],rebalances:['2021-03-31']}).length,0);
console.log('Official snapshot hashes, dates, revision selection, share units, no fallback, and stale-data checks passed');
