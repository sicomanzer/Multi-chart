import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const raw=JSON.parse(await readFile(process.argv.includes('--banks')?'data/bank-statement-candidates.json':'data/statement-candidates.json','utf8')).records;
const previousData=JSON.parse(await readFile('data/statement-versions.json','utf8'));
const previous=previousData.versions;
const fields=['netIncome','revenue','equity','assets','totalDebt','totalEquity','operatingCashFlow','ebit'];
const versions=[],revisionEvents=[];
for(const row of raw){
 const bank=row.statementModel==='bank';
 const modelFields=bank?[...fields.filter(k=>!['ebit','operatingCashFlow'].includes(k)),'totalNetIncome']:fields;
 assert.equal(row.candidate,true,`${row.symbol} ${row.fiscalYear}: extraction not reviewed`);
 assert.equal(row.status,'Audited');assert.equal(row.asOf,`31/12/${row.fiscalYear}`);
 assert.equal(new URL(row.source).hostname,'market.sec.or.th');
 assert.equal(createHash('sha256').update(await readFile(row.workbook)).digest('hex'),row.workbookSha256);
 for(const key of [...modelFields,'openingEquity','openingAssets']){
  assert.ok(Number.isFinite(row.fields[key]),key);
  assert.ok(row.fieldEvidence[key],key+' evidence missing');
 }
 const old=previous.find(r=>r.symbol===row.symbol&&r.fiscalYear===row.fiscalYear&&r.sha256===row.workbookSha256&&r.scope==='audited-consolidated-current-year');
 const base={symbol:row.symbol,companyName:row.companyName,fiscalYear:row.fiscalYear,asOf:`${row.fiscalYear}-12-31`,
  availableFrom:row.availableFrom,availabilitySource:row.availabilitySource,
  availabilityBasis:'conservative-annual-report-receipt-next-day',source:row.source,evidenceFile:row.workbook,
  sha256:row.workbookSha256,archiveSha256:row.sha256,retrievedAt:row.retrievedAt,
  reviewed:true,scope:'audited-consolidated-current-year',earliestVersionVerified:false,
  revisionDatesVerified:false,perShareBasisVerified:false,unit:'THB',
  statementModel:bank?'bank':'general',
  sourceContentChanged:row.sourceContentChanged??false,
  reviewMethod:'issuer-and-period-and-unit-headers; labelled-cells; balance-sheet-reconciliation',
  revenueBasis:bank?'net-interest-plus-non-interest-operating-income':row.symbol==='SET:PTT'?'sales-and-service-income':row.symbol==='SET:BCP'?'sales-and-service-income':'reported-total-revenue-or-income',
  fields:{...row.fields,...(old?.fields.reportedEps!=null?{reportedEps:old.fields.reportedEps}:{})},cells:row.fieldEvidence};
 versions.push(base);
 const prior=raw.find(r=>r.symbol===row.symbol&&r.fiscalYear===row.fiscalYear-1);
 if(!prior || prior.availableFrom>row.availableFrom)continue;
 const changed=modelFields.filter(k=>Number.isFinite(row.comparative[k])&&Math.abs(row.comparative[k]-prior.fields[k])>Math.max(2000,Math.abs(prior.fields[k])*1e-6));
 if(!changed.length)continue;
 assert.ok(modelFields.every(k=>Number.isFinite(row.comparative[k])&&row.comparativeEvidence[k]),'Incomplete comparative snapshot');
 const event={symbol:row.symbol,fiscalYear:prior.fiscalYear,observedInFiscalYear:row.fiscalYear,
  availableFrom:row.availableFrom,source:row.source,availabilitySource:row.availabilitySource,
  kind:'later-comparative-difference',earliestAmendmentDateVerified:false,
  changes:Object.fromEntries(changed.map(k=>[k,{original:prior.fields[k],laterComparative:row.comparative[k]}]))};
 revisionEvents.push(event);
 // A later comparative cannot reveal its opening balance two years back.
 // Keep those inputs unknown rather than borrowing an unverified denominator.
 versions.push({...base,fiscalYear:prior.fiscalYear,asOf:`${prior.fiscalYear}-12-31`,scope:'audited-consolidated-comparative',
  fields:{...Object.fromEntries(modelFields.map(k=>[k,row.comparative[k]])),...(bank?{ebit:null,operatingCashFlow:null}:{}),
    openingEquity:row.comparativeOpening?.openingEquity??null,openingAssets:row.comparativeOpening?.openingAssets??null},
  cells:{...row.comparativeEvidence,...row.comparativeOpeningEvidence},revisionEvent:event});
}
// Keep previously reviewed bytes and dates when a URL later serves new content.
const versionKey=r=>`${r.symbol}|${r.fiscalYear}|${r.scope}|${r.availableFrom}|${r.sha256}`;
const retained=previous.filter(r=>r.scope!=='audited-consolidated-comparative'
  || !raw.some(row=>row.source===r.source&&row.workbookSha256===r.sha256));
const merged=new Map([...retained,...versions].map(r=>[versionKey(r),r]));
versions.splice(0,versions.length,...merged.values());
versions.sort((a,b)=>a.symbol.localeCompare(b.symbol)||a.fiscalYear-b.fiscalYear||a.availableFrom.localeCompare(b.availableFrom));
await writeFile('data/statement-versions.json',JSON.stringify({version:2,checkedAt:new Date().toISOString(),
 description:'Reviewed official archived statement cells and later comparative snapshots. Dates are conservative SEC annual-report receipt bounds, not certified earliest filing/amendment dates. Unavailable opening balances and EPS are excluded from model inputs.',versions,revisionEvents:versions.filter(r=>r.revisionEvent).map(r=>r.revisionEvent)},null,2)+'\n');
console.log(JSON.stringify({issuers:new Set(versions.map(r=>r.symbol)).size,currentYearSnapshots:raw.length,comparativeSnapshots:revisionEvents.length,total:versions.length}));
