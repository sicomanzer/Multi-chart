import {mkdir,readFile,writeFile,access} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const clean=s=>s.replace(/<[^>]*>/g,' ').replace(/&nbsp;|&#160;/g,' ').replace(/&amp;/g,'&').replace(/\s+/g,' ').trim();
const records=[];
await mkdir('data/bank-risk-evidence',{recursive:true});
for(const symbol of ['KBANK','BBL','KTB','TTB','KKP','TISCO','SCB']){
 try{
  const issuer=JSON.parse(await readFile(`data/filing-evidence/${symbol}.json`,'utf8'));
  const listingSource=`https://market.sec.or.th/public/idisc/en/ViewMore/fs-mda?uniqueIDReference=${issuer.issuerId}&searchSymbol=${symbol}&dateFrom=20160101&dateTo=20261111`;
  const response=await fetch(listingSource,{signal:AbortSignal.timeout(30000)});if(!response.ok)throw Error('HTTP '+response.status);
  const html=await response.text(),releaseEvidenceFile=`data/bank-risk-evidence/${symbol}-history-mda-register.html`;
  await writeFile(releaseEvidenceFile,html);
  const releaseEvidenceSha256=createHash('sha256').update(html).digest('hex');
  for(const match of html.matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi)){
   const cells=[...match[0].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(c=>clean(c[1]));
   const period=(cells[2]??'').match(/(?:31 Dec(?:e?mber|ecmber)?[,]? (20\d{2})|December 31,? (20\d{2}))/i);
   if(!period)continue;
   const fiscalYear=Number(period[1]??period[2]);if(fiscalYear<2016||fiscalYear>2025||(symbol==='SCB'&&fiscalYear<2022))continue;
   const d=cells[0]?.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
   const source=match[0].match(/href=["']([^"']+)["']/i)?.[1]?.replaceAll('&amp;','&');if(!d||!source)continue;
   const publishedAt=`${d[3]}-${d[2]}-${d[1]}`;
   const tag=createHash('sha256').update(source).digest('hex').slice(0,10);
   const path=`data/bank-risk-evidence/${symbol}-${fiscalYear}-${publishedAt}-${tag}.pdf`;
   const record={symbol:'SET:'+symbol,fiscalYear,publishedAt,heading:cells[2],source,listingSource,path,releaseEvidenceFile,releaseEvidenceSha256};
   try{
    try{await access(path);}catch{
     const r=await fetch(source,{signal:AbortSignal.timeout(60000)});if(!r.ok)throw Error('Document HTTP '+r.status);
     const bytes=Buffer.from(await r.arrayBuffer());if(bytes.subarray(0,4).toString()!=='%PDF')throw Error('Not PDF');
     await writeFile(path,bytes);
    }
    const bytes=await readFile(path);
    records.push({...record,sha256:createHash('sha256').update(bytes).digest('hex'),observedAt:new Date().toISOString()});
    console.log(symbol,fiscalYear,publishedAt);
   }catch(error){records.push({...record,error:error.message});console.log(symbol,fiscalYear,error.message);}
  }
 }catch(error){records.push({symbol:'SET:'+symbol,error:error.message});console.log(symbol,error.message);}
}
await writeFile('data/bank-risk-history-manifest.json',JSON.stringify({records},null,2)+'\n');
