import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {isBankSymbol,bankCalendarDate} from './business-models.js';
const KEYS=['capitalAdequacy','npl','nplCoverage'];
const HOSTS=new Set(['market.sec.or.th','www.tisco.co.th','www.kasikornbank.com','www.bangkokbank.com',
 'krungthai.com','www.krungthai.com','www.ttbbank.com','media.ttbbank.com','ir.kkpfg.com','www.scbx.com','investor.scbx.com']);
const date=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)
 &&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
const nextDay=value=>new Date(Date.parse(value)+86400000).toISOString().slice(0,10);
export function validRiskMetric(metric,key,fiscalYear){
 try{
  const timing=metric.availabilityBasis==='sec-mda-announcement-next-day'
   ? date(metric.publishedAt)&&metric.availableFrom===nextDay(metric.publishedAt)
     &&metric.historicalAvailableFrom===metric.availableFrom
     &&/^data\/bank-risk-evidence\/[A-Z]+(?:-history)?-mda-register\.html$/.test(metric.releaseEvidenceFile)
     &&/^[a-f0-9]{64}$/.test(metric.releaseEvidenceSha256)
   :metric.availabilityBasis==='first-observed-official-document'
     &&Number.isFinite(Date.parse(metric.observedAt))&&metric.availableFrom===bankCalendarDate(metric.observedAt)
     &&metric.historicalAvailableFrom===nextDay(metric.availableFrom)&&metric.publishedAt===null;
  return KEYS.includes(key)&&Number.isFinite(metric.value)&&metric.value>=0
   &&(key==='nplCoverage'?metric.value<=100:metric.value<=1)
   &&Math.abs(metric.value-metric.reportedPercent/100)<1e-10
   &&Number.isInteger(metric.reportedDecimals)&&metric.reportedDecimals>=0&&metric.reportedDecimals<=4
   &&date(metric.asOf)&&metric.asOf===`${fiscalYear}-12-31`
   &&date(metric.availableFrom)&&date(metric.historicalAvailableFrom)
   &&metric.availableFrom>metric.asOf&&metric.historicalAvailableFrom>=metric.availableFrom
   &&new URL(metric.source).protocol==='https:'&&HOSTS.has(new URL(metric.source).hostname)
   &&/^data\/bank-risk-evidence\/[A-Za-z0-9.-]+\.pdf$/.test(metric.evidenceFile)
   &&/^[a-f0-9]{64}$/.test(metric.sha256)&&Number.isInteger(metric.pdfPage)&&metric.pdfPage>0&&timing;
 }catch{return false;}
}
export async function loadBankRisk({symbols=null,file=new URL('../data/bank-risk.json',import.meta.url)}={}){
 let data;try{data=JSON.parse(await readFile(file,'utf8'));}catch{return [];}
 const hashes=new Map(),rows=[],texts=new Map();
 for(const row of data.rows??[]){
  if(!isBankSymbol(row.symbol)||!Number.isInteger(row.fiscalYear)||(symbols&&!symbols.includes(row.symbol)))continue;
  const metrics={};
  for(const key of KEYS){
   const metric=row.metrics?.[key];let integrityVerified=false;
   if(validRiskMetric(metric,key,row.fiscalYear)){
    try{
     if(!hashes.has(metric.evidenceFile)){
      hashes.set(metric.evidenceFile,createHash('sha256').update(await readFile(new URL('../'+metric.evidenceFile,import.meta.url))).digest('hex'));
     }
     integrityVerified=hashes.get(metric.evidenceFile)===metric.sha256;
     if(integrityVerified&&metric.releaseEvidenceFile){
      if(!texts.has(metric.releaseEvidenceFile))texts.set(metric.releaseEvidenceFile,await readFile(new URL('../'+metric.releaseEvidenceFile,import.meta.url),'utf8'));
      const html=texts.get(metric.releaseEvidenceFile);
      const published=metric.publishedAt.split('-').reverse().join('/');
      const release=[...html.matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi)]
        .some(match=>match[0].replaceAll('&amp;','&').includes(metric.source)&&match[0].includes(published));
      integrityVerified=createHash('sha256').update(html).digest('hex')===metric.releaseEvidenceSha256&&release;
     }
    }catch{ /* Missing evidence cannot earn a pass. */ }
   }
   metrics[key]={...metric,integrityVerified};
  }
  rows.push({...row,metrics});
 }
 return rows;
}
export function selectBankRisk(rows,symbol,fiscalYear,at,{historical=false}={}){
 let day;try{day=bankCalendarDate(at);}catch{return null;}
 if(!date(day))return null;
 const candidates=rows.filter(r=>r.symbol===symbol&&r.fiscalYear===fiscalYear);
 if(!candidates.length)return null;
 const kkpPortfolio=symbol==='SET:KKP'&&candidates.every(r=>r.assessmentProfile==='group-capital-and-reported-banking-portfolio');
 const result={symbol,verified:true,fiscalYear,basis:kkpPortfolio?'group-capital-and-reported-banking-portfolio':'consolidated',source:null,availableFrom:null,metrics:{}};
 for(const key of KEYS){
  const metrics=candidates.map(row=>row.metrics[key]).filter(Boolean);
  const fromOf=m=>historical?m?.historicalAvailableFrom:m?.availableFrom;
  const knownMetrics=metrics.filter(m=>date(fromOf(m))&&fromOf(m)<=day).sort((a,b)=>fromOf(b).localeCompare(fromOf(a)));
  const m=knownMetrics[0]??metrics.sort((a,b)=>String(fromOf(a)).localeCompare(String(fromOf(b))))[0];
  const from=fromOf(m);
  const conflict=knownMetrics.some(other=>fromOf(other)===from&&(other.sha256!==m.sha256||other.value!==m.value));
  const known=m?.integrityVerified===true&&from<=day;
  const scope=key==='capitalAdequacy'
   ? ['consolidated','regulatory-group','financial-conglomerate'].includes(m?.scope)
   : ['consolidated','group-loan-portfolio'].includes(m?.scope)||(kkpPortfolio&&m?.scope==='commercial-banking-portfolio');
  const eligible=known&&!conflict&&scope&&['reported','reported-preliminary'].includes(m.status);
  result[key]=eligible?m.value:null;
  result.metrics[key]={...m,value:known?m.value:null,reportedPercent:known?m.reportedPercent:null,
   eligible,reason:!m?.integrityVerified?'evidence-invalid':!known?'not-yet-public':conflict?'conflicting-evidence':!scope?'scope-unresolved':
    !['reported','reported-preliminary'].includes(m.status)?'status-not-eligible':null};
  if(known){
   result.source??=m.source;
   if(!result.availableFrom||result.availableFrom>from)result.availableFrom=from;
  }
 }
 return result;
}
