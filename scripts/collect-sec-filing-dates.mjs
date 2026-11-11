import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const ROOT='https://market.sec.or.th';
const symbols=JSON.parse(await readFile('data/set-fundamentals.json','utf8')).rows.map(r=>r.symbol.slice(4));
const checkedAt=new Date().toISOString();
const end=checkedAt.slice(0,10).replaceAll('-','');
const dir='data/filing-evidence';
await mkdir(dir,{recursive:true});
const text=s=>s.replace(/<[^>]*>/g,' ').replace(/&nbsp;|&#160;/g,' ').replace(/&amp;/g,'&').replace(/\s+/g,' ').trim();
const iso=s=>{const m=s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);return m?`${m[3]}-${m[2]}-${m[1]}`:null;};
async function get(url){const r=await fetch(url,{signal:AbortSignal.timeout(30000)});if(!r.ok)throw Error(`${r.status} ${url}`);return r.text();}
const entries=[],coverage=[];
for(const symbol of symbols){
 try{
  const profileUrl=`${ROOT}/public/idisc/en/CompanyProfile/Listed/${symbol}`;
  const profile=await get(profileUrl);
  const match=profile.match(/FinancialReport\/(?:ALLMIXED|AllMixed|ALL|All)-(\d+)/i);
  if(!match)throw Error('SEC issuer id not found in company profile');
  const id=match[1];
  const url=`${ROOT}/public/idisc/en/ViewMore/fs-r562?uniqueIDReference=${id}&searchSymbol=${symbol}&dateFrom=20150101&dateTo=${end}`;
  const html=await get(url);
  const records=[];
  for(const table of html.matchAll(/<table\b[^>]*>[\s\S]*?<\/table>/gi)){
   if(!/Receive Date/i.test(text(table[0])))continue;
   for(const row of table[0].matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi)){
    const cells=[...row[0].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(m=>text(m[1]));
    const href=row[0].match(/href=["']([^"']+)["']/i)?.[1]?.replaceAll('&amp;','&');
    const year=Number(cells[1]),date=iso(cells[2]??'');
    if(!Number.isInteger(year)||year<2015||year>2025||!date||!href)continue;
    records.push({symbol:`SET:${symbol}`,fiscalYear:year,publishedAt:date,
      publicationSource:new URL(href,url).href,listingSource:url,
      dateBasis:'annual-report-received',firstPublicationVerified:false,
      evidenceType:'SEC annual report/Form 56-2 receipt register',checkedAt});
   }
  }
  if(!records.length)throw Error('No dated annual-report receipts found');
  const sourceText=text(html);
  const hash=createHash('sha256').update(html).digest('hex');
  await writeFile(`${dir}/${symbol}.json`,JSON.stringify({symbol,issuerId:id,source:url,checkedAt,sha256:hash,records,evidenceText:sourceText},null,2)+'\n');
  entries.push(...records);
  coverage.push({symbol,issuerId:id,records:records.length,source:url});
  console.log(symbol,records.length);
 }catch(error){coverage.push({symbol,records:0,error:error.message});console.log(symbol,error.message);}
 await writeFile('data/filing-dates-candidates.json',JSON.stringify({version:1,checkedAt,description:'Verified SEC annual report receipt dates are conservative evidence of public availability, not proof of first audited-results publication.',entries,coverage},null,2)+'\n');
}
console.log('TOTAL',entries.length,'ISSUERS',coverage.filter(r=>r.records>0).length);
