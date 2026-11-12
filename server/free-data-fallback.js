/** Free-source fallback policy. Published SET values and calculated ratios stay distinct. */
const DAY=86400000;
const age=(day,at)=>{const t=Date.parse(day);return Number.isFinite(t)?(at.getTime()-t)/DAY:Infinity;};
export const SET_CACHE_MAX_DAYS=7;
export function usableSetSnapshot(official,at=new Date()){
 return !!official&&typeof official.asOf==='string'&&age(official.asOf,at)>=0&&age(official.asOf,at)<=SET_CACHE_MAX_DAYS;
}
export function reviewedAnnualFallback(rows,at=new Date()){
 const known=rows.filter(r=>age(r.asOf,at)>=0&&Date.parse(r.publishedAt)<=at.getTime());
 if(!known.length)return [];
 // Keep the whole known series for history checks; only use it if latest report is current enough.
 const latest=[...known].sort((a,b)=>a.fiscalYear-b.fiscalYear).at(-1);
 if(age(latest.asOf,at)>550)return [];
 return known.map(r=>({...r,roe:Number.isFinite(r.openingEquity)&&r.openingEquity+r.equity>0?r.netIncome/((r.openingEquity+r.equity)/2):null,
  ratioSource:'sec-reviewed-calculated',payoutEpsSource:r.payoutEps!=null?'sec-reviewed-bank':null}));
}
export function chooseFreeSources(fin,official,reviewed,at=new Date()){
 const primary=usableSetSnapshot(official,at);const fallback=reviewedAnnualFallback(reviewed,at);
 return {officialSnapshot:primary?official:null,
  officialAnnual:primary?(official.annualYears??[]):null,
  reviewedScoreYears:!primary&&fallback.length?fallback:null,
  officialMultiples:primary?{pe:official.pe?.value??null,pbv:official.pbv?.value??null}:undefined,
  qualitySource:primary?'set.or.th':fallback.length?'sec-reviewed-calculated':'provider-statements',
  sourceFallback:!primary||!!official?.stale,
  sourceFallbackReason:primary?(official.stale?'set-cached':null):official?'set-cache-expired':'set-unavailable'};
}
export function applyFreeHeadlineFallback(row,fin,official,at=new Date()){
 if(usableSetSnapshot(official,at)){
  return {...row,pe:official.pe?.value??null,pbv:official.pbv?.value??null,de:official.de?.value??null,
   dividendYield:official.dividendYield?.value==null?null:official.dividendYield.value/100,
   ratioSource:'set.or.th',ratioAsOf:official.asOf,ratioFinancialAsOf:official.financialAsOf??null,
   ratiosStale:!!official.stale,sourceFallback:!!official.stale||row.sourceFallback,
   ...(official.reitProfile?{reitProfile:official.reitProfile}:{})};
 }
 const t=fin.ttm??{};const validDate=d=>age(d,at)>=0&&age(d,at)<=550;
 const ratio=(v,d)=>Number.isFinite(fin.price)&&fin.price>0&&Number.isFinite(v)&&v>0&&validDate(d)?fin.price/v:null;
 // Missing/negative TTM earnings cannot be replaced with an older profitable year.
 return {...row,pe:ratio(t.eps,t.epsAsOf),pbv:ratio(t.bvps,t.bvpsAsOf),de:null,
  dividendYield:row.recurringDividendYield??null,ratioSource:'calculated-provider',ratioAsOf:fin.priceDate??null,
  ratioFinancialAsOf:null,ratiosStale:false,sourceFallback:true,
  sourceFallbackReason:row.sourceFallbackReason??(official?'set-cache-expired':'set-unavailable'),
  ratioInputs:{price:fin.price,priceAsOf:fin.priceDate??null,eps:t.eps??null,epsAsOf:t.epsAsOf??null,bvps:t.bvps??null,bvpsAsOf:t.bvpsAsOf??null},
  yieldBasis:'model-recurring-dividend / price; not SET-published yield',
  deBasis:'unavailable; interest-bearing debt is not substituted for SET liabilities/equity'};
}
