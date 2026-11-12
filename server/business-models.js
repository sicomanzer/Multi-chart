// Bank/holding-group identity is explicit. Consumer lenders and insurers are
// financial businesses but must not inherit a commercial-bank model.
import {readFileSync} from 'node:fs';
const classifications=JSON.parse(readFileSync(new URL('../data/business-classification.json',import.meta.url),'utf8'));
const bySymbol=new Map(classifications.rows.map(row=>[row.symbol,row]));
export const BANK_SYMBOLS = new Set(['SET:KBANK','SET:BBL','SET:KTB','SET:TTB','SET:KKP','SET:TISCO','SET:SCB']);
export const isBankSymbol = symbol => BANK_SYMBOLS.has(String(symbol).toUpperCase());
/** Stable reviewed identity, independent of runtime Yahoo availability.
 * Changes require reviewing and shipping the same dated snapshot everywhere. */
export function businessClassification(symbol){
  const evidence=bySymbol.get(String(symbol).toUpperCase());
  if(!evidence)return {model:'unknown',isFinancial:null,evidence:null,dataIssue:'business-classification-unknown'};
  const sector=evidence.sector;
  const model=isBankSymbol(symbol)?'bank':sector==='BANK'?'unsupported-bank'
    :sector==='FIN'?'nonbank-financial':sector==='INSUR'?'insurance'
    :evidence.accountFormId==='5'?'reit':sector?'general':'unknown';
  const dataIssue=model==='general'||model==='bank'?null:model==='unknown'?'business-classification-unknown'
    :model==='reit'?'reit-framework-not-supported':'financial-framework-not-supported';
  return {model,isFinancial:['bank','unsupported-bank','nonbank-financial','insurance'].includes(model)?true:model==='unknown'?null:false,
    evidence,dataIssue};
}
export const reviewedBusinessClassifications=()=>classifications.rows.map(row=>businessClassification(row.symbol));
export function applyReviewedBusinessModel(fin){
  if(!fin.symbol?.startsWith('SET:'))return fin;
  const identity=businessClassification(fin.symbol);
  return {...fin,businessClassification:identity,isFinancial:identity.isFinancial,
    ...(identity.dataIssue?{dataIssue:identity.dataIssue}:{})};
}
// Research assumptions for this screener, not BOT regulatory minimums.
export const BANK_POLICY = Object.freeze({roe:.10,roa:.01,capitalAdequacy:.15,npl:.03,nplCoverage:1.5});
export function bankCalendarDate(value){
  if(typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value))return value;
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Bangkok',year:'numeric',month:'2-digit',day:'2-digit'})
    .formatToParts(value instanceof Date?value:new Date(value));
  const get=type=>parts.find(p=>p.type===type).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}
