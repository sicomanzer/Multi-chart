import {readFile,writeFile}from'node:fs/promises';
const audit=JSON.parse(await readFile('screener-complete-audit.json'));const by=new Map(audit.rows.map(r=>[r.symbol,r]));const records=[];
const page='https://www.set.or.th/th/market/product/stock/quote/PTT/price';
const ua='Mozilla/5.0';const first=await fetch(page,{headers:{'User-Agent':ua},signal:AbortSignal.timeout(15000)});
const cookie=first.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');const headers={'User-Agent':ua,Cookie:cookie,Referer:page,Accept:'application/json'};
let blocked=null;
for(const symbol of audit.symbols){
 if(blocked){records.push({symbol,error:blocked,attempted:false});continue;}
 try{
  const base=`https://www.set.or.th/api/set/stock/${symbol.slice(4)}/company-highlight/`;
  const get=async suffix=>{const r=await fetch(base+suffix+'?lang=en',{headers,signal:AbortSignal.timeout(12000)});if(!r.ok){if([403,429].includes(r.status))blocked='SET '+r.status+'; remaining calls stopped';throw Error('SET '+r.status);}return r.json();};
  const trading=await get('trading-stat');const financial=await get('financial-data');const t=[...trading].sort((a,b)=>a.date.localeCompare(b.date)).at(-1);const row=by.get(symbol);
  const comparisons=[];
  for(const [key,mine,official]of [['pe',row.pe,t.pe],['pbv',row.pbv,t.pbv],['dividendYield',row.dividendYield==null?null:row.dividendYield*100,t.dividendYield]]){
   const comparable=Number.isFinite(mine)&&Number.isFinite(official)&&row.ratioAsOf===t.date.slice(0,10);
   comparisons.push({key,mine,official,comparable,equal:comparable?Math.abs(mine-official)<1e-8:null});
  }
  records.push({symbol,source:base,checkedAt:new Date().toISOString(),trading,financial,comparisons});
 }catch(error){records.push({symbol,error:error.message,attempted:true});}
 if(records.length%10===0)console.log('SET reviewed',records.length);
 await writeFile('all-company-official-comparison.json',JSON.stringify({checkedAt:new Date().toISOString(),records},null,2));
 await new Promise(r=>setTimeout(r,150));
}
await writeFile('all-company-official-comparison.json',JSON.stringify({checkedAt:new Date().toISOString(),records},null,2));
console.log(JSON.stringify({companies:records.length,successful:records.filter(r=>!r.error).length,failed:records.filter(r=>r.error).length,comparable:records.flatMap(r=>r.comparisons??[]).filter(c=>c.comparable).length,differences:records.flatMap(r=>r.comparisons??[]).filter(c=>c.comparable&&!c.equal).length}));
