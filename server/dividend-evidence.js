import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {parseCashDeclarations} from './dividend-declarations.js';
const hash=b=>createHash('sha256').update(b).digest('hex');
const date=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s;
export async function loadDividendEvidence(symbol,at=new Date()){
 const day=at.toISOString().slice(0,10);let actions=null;const reviews=[];
 try{
  const manifest=JSON.parse(await readFile(new URL('../data/dividend-source-manifest.json',import.meta.url),'utf8'));
  const r=manifest.records.find(r=>r.symbol===symbol&&!r.error);
  if(r&&r.observedAt.slice(0,10)<=day&&r.source===`https://www.set.or.th/api/set/stock/${symbol.slice(4)}/corporate-action?lang=en`
   &&/^data\/dividend-evidence\/[A-Z0-9]+-actions\.json$/.test(r.evidenceFile)){
   const bytes=await readFile(new URL('../'+r.evidenceFile,import.meta.url));
   if(hash(bytes)===r.sha256){const rows=JSON.parse(bytes);if(Array.isArray(rows)&&rows.every(a=>a.symbol===symbol.slice(4)))actions={...r,rows};}
  }
 }catch{}
 try{
  const data=JSON.parse(await readFile(new URL('../data/dividend-reviews.json',import.meta.url),'utf8'));
  for(const r of data.rows.filter(r=>r.symbol===symbol&&r.reviewed===true)){
   if(!date(r.liveAvailableFrom)||!date(r.availableFrom)||r.liveAvailableFrom>day||r.availableFrom<=r.liveAvailableFrom
    ||!Number.isInteger(r.fiscalYear)||r.regularDps<0||!Number.isFinite(r.regularDps)||!Number.isFinite(r.totalDps)
    ||!Number.isFinite(r.specialDps)||r.specialDps<0||Math.abs(r.regularDps+r.specialDps-r.totalDps)>1e-8)continue;
   const docs=r.components??[r];let valid=docs.length>0;
   if(r.components){
    valid=valid&&r.reviewMethod==='matched-structured-common-cash-v1'
      &&Math.abs(docs.reduce((n,d)=>n+d.regularDps,0)-r.regularDps)<1e-8
      &&Math.abs(docs.reduce((n,d)=>n+d.totalDps,0)-r.totalDps)<1e-8;
   }
   for(const doc of docs){
    const url=new URL(doc.source);
    if(url.origin!=='https://www.set.or.th'||url.pathname!=='/en/market/news-and-alert/newsdetails'||url.searchParams.get('symbol')!==symbol.slice(4)
      ||!/^data\/dividend-evidence\/(?:notices\/)?[A-Za-z0-9.-]+\.html$/.test(doc.evidenceFile)){valid=false;break;}
    const bytes=await readFile(new URL('../'+doc.evidenceFile,import.meta.url));const text=bytes.toString('utf8');
    if(hash(bytes)!==doc.sha256){valid=false;break;}
    if(r.components){
      if(!parseCashDeclarations(text).some(p=>p.paymentDate===doc.paymentDate&&p.beginOperation===doc.beginOperation&&p.endOperation===doc.endOperation
        &&p.regularDps===doc.regularDps&&p.specialDps===doc.specialDps)){valid=false;break;}
    }else if(!doc.anchors?.length||!doc.anchors.every(a=>text.includes(a))){valid=false;break;}
   }
   if(valid&&r.periodVerified){
    const e=r.actionEvidence;
    if(!r.components||!e||!/^data\/dividend-evidence\/[A-Z0-9]+-actions\.json$/.test(e.evidenceFile))valid=false;
    else{
      const raw=await readFile(new URL('../'+e.evidenceFile,import.meta.url));
      valid=hash(raw)===e.sha256&&e.symbol===symbol
        &&e.source===`https://www.set.or.th/api/set/stock/${symbol.slice(4)}/corporate-action?lang=en`
        &&compareDividendPeriod({...e,rows:JSON.parse(raw)},r.fiscalEnd,r.totalDps,at).status==='matched';
    }
   }
   if(valid)reviews.push(r);
  }
 }catch{}
 return {actions,reviews};
}

/** Official cash totals and operating periods do not certify special classification. */
export function compareDividendPeriod(evidence,fiscalEnd,modelTotal,at=new Date()){
 if(!evidence||!date(fiscalEnd)||evidence.observedAt?.slice(0,10)>at.toISOString().slice(0,10))return {status:'unavailable'};
 const start=new Date(fiscalEnd+'T00:00:00Z');start.setUTCFullYear(start.getUTCFullYear()-1);start.setUTCDate(start.getUTCDate()+1);
 const from=start.toISOString().slice(0,10),day=at.toISOString().slice(0,10);
 const monthEdge=months=>{const d=new Date(fiscalEnd+'T00:00:00Z'),n=d.getUTCDate();d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()+months);d.setUTCDate(Math.min(n,new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate()));return d.toISOString().slice(0,10);};
 const windowFrom=monthEdge(-6),windowTo=monthEdge(6);
 const tentative=r=>[true,'Y','true'].includes(r.tentativeDividendFlag);
 const unknownPeriod=evidence.rows.filter(r=>r.caType==='XD'&&r.currency==='Baht'&&Number.isFinite(r.dividend)
  &&(!r.beginOperation||!r.endOperation)&&r.xdate?.slice(0,10)>windowFrom&&r.xdate?.slice(0,10)<=windowTo&&!tentative(r));
 const cash=evidence.rows.filter(r=>r.caType==='XD'&&r.currency==='Baht'&&Number.isFinite(r.dividend)
  &&r.beginOperation?.slice(0,10)>=from&&r.endOperation?.slice(0,10)<=fiscalEnd&&r.endOperation?.slice(0,10)>=from
  &&r.paymentDate?.slice(0,10)<=day&&!tentative(r));
 const hasYearEnd=cash.some(r=>r.endOperation.slice(0,10)===fiscalEnd);
 const total=cash.reduce((sum,r)=>sum+r.dividend,0);
 return {status:!cash.length||!hasYearEnd||unknownPeriod.length?'period-incomplete':Number.isFinite(modelTotal)&&Math.abs(total-modelTotal)<1e-6?'matched':'different',
  fiscalStart:from,fiscalEnd,officialCashTotal:cash.length?total:null,modelTotal,
  payments:cash,unknownPeriodPayments:unknownPeriod,source:evidence.source,observedAt:evidence.observedAt,
  note:'Cash-only, same operating period; no share-action or special/regular certification'};
}
