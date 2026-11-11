import {readFile,writeFile} from 'node:fs/promises';
import {applyPreset,PRESETS} from '../server/screener.js';
const base=process.env.BASE_URL??'http://127.0.0.1:8787';
const universe=await fetch(base+'/api/screener/universe').then(r=>r.json());
const symbols=[...new Set(universe.lists.flatMap(r=>r.symbols))];
const snapshots=[];const errors=[];
for(let i=0;i<symbols.length;i+=40){
 const batch=symbols.slice(i,i+40);
 const res=await fetch(base+'/api/screener/run',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({symbols:batch,preset:'all'}),signal:AbortSignal.timeout(120000)});
 if(!res.ok)throw Error('HTTP '+res.status);
 const r=await res.json();snapshots.push(...r.rows);errors.push(...(r.errors??[]));
 console.log(`Audited ${snapshots.length}/${symbols.length}; errors ${errors.length}`);
 await writeFile('screener-complete-audit.json',JSON.stringify({checkedAt:new Date().toISOString(),symbols,rows:snapshots,errors},null,2));
}
const flags=[];const summary=snapshots.map(r=>{
 const verdicts=Object.fromEntries(PRESETS.map(p=>[p.id,applyPreset(r,p)]));
 const missing=(r.checks??[]).filter(c=>!c.na&&c.pass===null).map(c=>c.id);
 const failed=(r.checks??[]).filter(c=>!c.na&&c.pass===false&&!c.warn).map(c=>c.id);
 if(r.score>=90&&missing.length)flags.push({symbol:r.symbol,kind:'high-score-incomplete',score:r.score,coverage:r.dataCoverage,missing});
 if(r.scoringYearCount===0&&r.score!=null)flags.push({symbol:r.symbol,kind:'numeric-score-without-annual-statements',score:r.score});
 if(r.residualIncome?.ok&&(r.payout==null||r.roe3==null))flags.push({symbol:r.symbol,kind:'residual-income-with-missing-input',missing:[...(r.payout==null?['payout']:[]),...(r.roe3==null?['roe']:[])]});
 if(r.pass!==verdicts.all.pass||r.failReason!==verdicts.all.reason)flags.push({symbol:r.symbol,kind:'verdict-mismatch'});
 if(r.dataCoverage!=null&&(r.dataCoverage<0||r.dataCoverage>1))flags.push({symbol:r.symbol,kind:'invalid-coverage'});
 return {symbol:r.symbol,model:r.qualityModel,score:r.score,coverage:r.dataCoverage,roe3:r.roe3,roa3:r.roa3,missing,failed,verdicts,dataIssue:r.dataIssue??null};
});
await writeFile('screener-complete-audit-summary.json',JSON.stringify({checkedAt:new Date().toISOString(),requested:symbols.length,reviewed:snapshots.length,errors,flags,summary},null,2));
console.log(JSON.stringify({requested:symbols.length,reviewed:snapshots.length,errors,flags}));
