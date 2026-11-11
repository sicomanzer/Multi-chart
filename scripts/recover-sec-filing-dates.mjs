import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const data=JSON.parse(await readFile('data/filing-dates-candidates.json','utf8'));
const checkedAt=new Date().toISOString(),end=checkedAt.slice(0,10).replaceAll('-','');
const clean=s=>s.replace(/<[^>]+>/g,' ').replace(/&nbsp;|&#160;/g,' ').replace(/&amp;/g,'&').replace(/\s+/g,' ').trim();
// SEC search identifies TISCO Financial Group as 6887; the current company
// profile links to 1269, which has no annual reports. Do not use TISCO Bank 1739.
for(const [symbol,id,route,expected] of [
 ['TISCO','0000006887','fs-r562','TISCO FINANCIAL GROUP'],
 ['BKIH','0000034402','fs-r561','BANGKOK INSURANCE HOLDINGS'],
]){
 const url=`https://market.sec.or.th/public/idisc/en/ViewMore/${route}?uniqueIDReference=${id}&searchSymbol=${symbol}&dateFrom=20150101&dateTo=${end}`;
 const response=await fetch(url,{signal:AbortSignal.timeout(30000)});if(!response.ok)throw Error('SEC '+response.status);
 const html=await response.text(),records=[];
 for(const table of html.matchAll(/<table\b[^>]*>[\s\S]*?<\/table>/gi)){
  if(!/Receive Date/.test(clean(table[0])))continue;
  for(const row of table[0].matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi)){
   const cells=[...row[0].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(m=>clean(m[1]));
   const m=cells[2]?.match(/^(\d{2})\/(\d{2})\/(\d{4})$/),year=Number(cells[1]);
   const href=row[0].match(/href=["']([^"']+)["']/i)?.[1]?.replaceAll('&amp;','&');
   if(!m||!href||year<2015||year>2025||!cells[0]?.includes(expected))continue;
   if(route==='fs-r561'&&year<2020)continue;
   records.push({symbol:`SET:${symbol}`,fiscalYear:year,publishedAt:`${m[3]}-${m[2]}-${m[1]}`,
    publicationSource:new URL(href,url).href,listingSource:url,
    dateBasis:route==='fs-r562'?'annual-report-received':'one-report-received',firstPublicationVerified:false,
    evidenceType:route==='fs-r562'?'SEC annual report/Form 56-2 receipt register':'SEC Form 56-1 One Report receipt register',checkedAt});
  }
 }
 console.log(symbol,records.length);
 if(records.length){
  data.entries=data.entries.filter(r=>r.symbol!==`SET:${symbol}`).concat(records);
  data.coverage=data.coverage.filter(r=>r.symbol!==symbol).concat({symbol,issuerId:id,records:records.length,source:url});
  await writeFile(`data/filing-evidence/${symbol}.json`,JSON.stringify({symbol,issuerId:id,source:url,checkedAt,sha256:createHash('sha256').update(html).digest('hex'),records,evidenceText:clean(html)},null,2)+'\n');
 }
}
await writeFile('data/filing-dates-candidates.json',JSON.stringify(data,null,2)+'\n');
