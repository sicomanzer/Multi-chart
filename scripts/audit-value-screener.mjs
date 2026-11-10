import {writeFile} from 'node:fs/promises';
import {loadDetail} from '../server/screener-run.js';
import {initAnnualHistory} from '../server/finnomena.js';
await initAnnualHistory();
const symbols=['KBANK','PTT','BCP','MINT','ADVANC','KCE','CPNREIT','HMPRO'];
const rows=[];
for(const symbol of symbols){
 try{
  const detail=await loadDetail('SET:'+symbol);
  const last=detail.years?.at(-1);
  const checks=Object.fromEntries((detail.checks??[]).map(c=>[c.id,c]));
  rows.push({symbol,detail});
  console.log(JSON.stringify({symbol,score:detail.score,coverage:detail.coverage,ratioSource:detail.ratioSource,ratioAsOf:detail.ratioAsOf,pe:detail.pe,pbv:detail.pbv,de:detail.de,yield:detail.dividendYield,scoredDe:checks.debtLevel?.value,scoredYield:checks.dividendYield?.value,ddm:detail.ddm,latestYear:last?.fiscalYear,yearCount:detail.yearCount}));
 }catch(error){rows.push({symbol,error:error.message});console.log(JSON.stringify({symbol,error:error.message}));}
 await writeFile(process.argv[2] ?? 'value-screener-audit.json',JSON.stringify({checkedAt:new Date().toISOString(),rows},null,2));
}
