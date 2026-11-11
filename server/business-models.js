// Bank/holding-group identity is explicit. Consumer lenders and insurers are
// financial businesses but must not inherit a commercial-bank model.
export const BANK_SYMBOLS = new Set(['SET:KBANK','SET:BBL','SET:KTB','SET:TTB','SET:KKP','SET:TISCO','SET:SCB']);
export const isBankSymbol = symbol => BANK_SYMBOLS.has(String(symbol).toUpperCase());
// Research assumptions for this screener, not BOT regulatory minimums.
export const BANK_POLICY = Object.freeze({roe:.10,roa:.01,capitalAdequacy:.15,npl:.03,nplCoverage:1.5});
export function bankCalendarDate(value){
  if(typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value))return value;
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Bangkok',year:'numeric',month:'2-digit',day:'2-digit'})
    .formatToParts(value instanceof Date?value:new Date(value));
  const get=type=>parts.find(p=>p.type===type).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}
