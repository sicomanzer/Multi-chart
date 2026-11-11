import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const clean=s=>s.replace(/<[^>]*>/g,' ').replace(/&nbsp;|&#160;/g,' ').replace(/&amp;/g,'&').replace(/\s+/g,' ').trim();
const records=[];
for(const symbol of ['KBANK','BBL','KTB','TTB','KKP','TISCO','SCB']){
 try{
  const issuer=JSON.parse(await readFile(`data/filing-evidence/${symbol}.json`,'utf8'));
  const url=`https://market.sec.or.th/public/idisc/en/ViewMore/fs-mda?uniqueIDReference=${issuer.issuerId}&searchSymbol=${symbol}&dateFrom=20250101&dateTo=20261111`;
  const response=await fetch(url,{signal:AbortSignal.timeout(30000)});if(!response.ok)throw Error('HTTP '+response.status);
  const html=await response.text();
  await writeFile(`data/bank-risk-evidence/${symbol}-mda-register.html`,html);
  const rows=[];
  for(const m of html.matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi)){
   const cells=[...m[0].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(c=>clean(c[1]));
   if(!/(?:31 Dec(?:ember)?[,]? 2025|December 31,? 2025)/i.test(cells[2]??''))continue;
   const d=cells[0]?.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
   const href=m[0].match(/href=["']([^"']+)["']/i)?.[1]?.replaceAll('&amp;','&');if(!d||!href)continue;
   rows.push({symbol,fiscalYear:2025,publishedAt:`${d[3]}-${d[2]}-${d[1]}`,heading:cells[2],source:new URL(href,url).href,listingSource:url});
  }
  rows.sort((a,b)=>b.publishedAt.localeCompare(a.publishedAt));
  if(!rows.length)throw Error('No dated FY2025 MDA found');
  const row=rows[0],r=await fetch(row.source,{signal:AbortSignal.timeout(60000)});if(!r.ok)throw Error('Document HTTP '+r.status);
  const bytes=Buffer.from(await r.arrayBuffer());if(bytes.subarray(0,4).toString()!=='%PDF')throw Error('Not PDF');
  const path=`data/bank-risk-evidence/${symbol}-2025-sec-mda.pdf`;
  await writeFile(path,bytes);
  records.push({...row,path,sha256:createHash('sha256').update(bytes).digest('hex'),observedAt:new Date().toISOString(),otherDatedVersions:rows.slice(1)});
  console.log(symbol,row.publishedAt,bytes.length);
 }catch(error){records.push({symbol,error:error.message});console.log(symbol,error.message);}
}
await writeFile('data/bank-mda-source-manifest.json',JSON.stringify({records},null,2)+'\n');
