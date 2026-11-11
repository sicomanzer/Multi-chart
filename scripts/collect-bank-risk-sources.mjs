import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const sources=[
 ['BBL-2025-mda','https://www.bangkokbank.com/-/media/files/investor-relations/financial-results/2025/mda4q_en2025.pdf?hash=1A5689409235D927672EA73BF3E1CCAE&sc_lang=en'],
 ['KBANK-2025-ar','https://www.kasikornbank.com/en/IR/FinanInfoReports/financialReports/y2025-onereport-en.pdf'],
 ['TTB-2025-mda','https://media.ttbbank.com/5005/ir_set_news/7855-en.pdf'],
 ['TISCO-2025-ar','https://www.tisco.co.th/wp-content/uploads/2025-group-annual-report-en.pdf'],
 ['TISCO-2025-mda','https://www.tisco.co.th/wp-content/uploads/MDA-2025E.pdf'],
 ['SCB-2025-mda','https://investor.scbx.com/storage/document/shareholder-meetings/agm2026/financial-summary-management-discussion-and-analysis-of-2025-en.pdf'],
 ['SCB-2025-news','https://www.scbx.com/en/news/scbx-reports-2025-net-profit/'],
 ['KKP-highlights','https://ir.kkpfg.com/en/financial-information/financial-highlights'],
];
await mkdir('data/bank-risk-evidence',{recursive:true});
const records=[];
for(const [name,url] of sources){
 const pdf=/\.pdf(?:\?|$)/.test(url),path=`data/bank-risk-evidence/${name}.${pdf?'pdf':'html'}`;
 try{
  let bytes;try{bytes=await readFile(path);}catch{
   const r=await fetch(url,{signal:AbortSignal.timeout(60000)});if(!r.ok)throw Error('HTTP '+r.status);
   bytes=Buffer.from(await r.arrayBuffer());await writeFile(path,bytes);
  }
  if(pdf&&bytes.subarray(0,4).toString()!=='%PDF')throw Error('Not a PDF');
  records.push({name,source:url,path,sha256:createHash('sha256').update(bytes).digest('hex'),observedAt:new Date().toISOString()});
  console.log(name,bytes.length);
 }catch(error){records.push({name,source:url,error:error.message});console.log(name,error.message);}
}
await writeFile('data/bank-risk-source-manifest.json',JSON.stringify({records},null,2)+'\n');
