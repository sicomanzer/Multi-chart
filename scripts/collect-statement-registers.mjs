import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const checkedAt=new Date().toISOString();
const dates=JSON.parse(await readFile('data/filing-dates.json','utf8'));
const symbols=[...new Set(dates.entries.map(r=>r.symbol.slice(4)))];
const clean=s=>s.replace(/<[^>]*>/g,' ').replace(/&nbsp;|&#160;/g,' ').replace(/&amp;/g,'&').replace(/\s+/g,' ').trim();
await mkdir('data/statement-registers',{recursive:true});
const issuers=[];let next=0;
await Promise.all(Array.from({length:1},async()=>{
 while(next<symbols.length){
  const symbol=symbols[next++];
  try{
   const evidence=JSON.parse(await readFile(`data/filing-evidence/${symbol}.json`,'utf8'));
   const url=`https://market.sec.or.th/public/idisc/en/ViewMore/fs-norm?uniqueIDReference=${evidence.issuerId}&searchSymbol=${symbol}&dateFrom=20150101&dateTo=20261111`;
   const response=await fetch(url,{signal:AbortSignal.timeout(30000)});if(!response.ok)throw Error('HTTP '+response.status);
   const html=await response.text(),records=[];
   for(const m of html.matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi)){
    const cells=[...m[0].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(c=>clean(c[1]));
    if(cells[4]!=='Year'||!cells[3]?.includes('Consolidated')||Number(cells[1])<2016||Number(cells[1])>2025)continue;
    const href=m[0].match(/href=["']([^"']+)["']/i)?.[1]?.replaceAll('&amp;','&');if(!href)continue;
    // Bind the actual issuer name, not just a ticker supplied in the query.
    if(!evidence.evidenceText.includes(cells[0]))throw Error('Issuer name does not match receipt evidence: '+cells[0]);
    records.push({symbol:`SET:${symbol}`,companyName:cells[0],fiscalYear:Number(cells[1]),status:cells[2],type:cells[3],period:cells[4],asOf:cells[5],source:new URL(href,url).href});
   }
   const result={symbol,issuerId:evidence.issuerId,url,checkedAt,sha256:createHash('sha256').update(html).digest('hex'),records};
   await writeFile(`data/statement-registers/${symbol}.json`,JSON.stringify(result,null,2)+'\n');
   issuers.push({symbol,records:records.length,distinctYears:new Set(records.map(r=>r.fiscalYear)).size,
    multipleSources:[...new Set(records.map(r=>r.fiscalYear))].filter(y=>new Set(records.filter(r=>r.fiscalYear===y).map(r=>r.source)).size>1)});
   console.log(symbol,records.length);
  }catch(error){issuers.push({symbol,error:error.message});console.log(symbol,error.message);}
 }
}));
await writeFile('data/statement-register-coverage.json',JSON.stringify({checkedAt,issuers:issuers.sort((a,b)=>a.symbol.localeCompare(b.symbol))},null,2)+'\n');
