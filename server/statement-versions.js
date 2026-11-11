import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import {isBankSymbol} from './business-models.js';

const RAW_FIELDS = ['netIncome','revenue','equity','openingEquity','assets','openingAssets',
  'totalDebt','totalEquity','operatingCashFlow','ebit'];

export async function loadStatementVersions({symbols=null}={}) {
  const data = JSON.parse(await readFile(new URL('../data/statement-versions.json', import.meta.url), 'utf8'));
  const rows=[];
  for(const row of data.versions){
    if(symbols&&!symbols.includes(row.symbol))continue;
    if(!validStatementVersion(row))continue;
    try{
      const bytes=await readFile(new URL('../'+row.evidenceFile,import.meta.url));
      if(createHash('sha256').update(bytes).digest('hex')===row.sha256)rows.push(row);
    }catch{ /* Missing or changed evidence is excluded, never replaced by provider data. */ }
  }
  return rows;
}

export function bankScoringYears(versions,symbol,at){
  if(!isBankSymbol(symbol))return [];
  return selectStatementVersions(versions,symbol,at).map(row=>({...row,
    roe:Number.isFinite(row.openingEquity)&&row.openingEquity+row.equity>0
      ? row.netIncome/((row.openingEquity+row.equity)/2):null,
    npm:null,ratioSource:'sec-reviewed-bank',
  }));
}

const isoDate=value=>typeof value==='string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10)===value;

export function validStatementVersion(row) {
  try {
    return row.reviewed === true && ['audited-consolidated-current-year','audited-consolidated-comparative'].includes(row.scope)
      && (isBankSymbol(row.symbol) ? row.statementModel==='bank' : row.statementModel!=='bank')
      && row.unit === 'THB' && /^SET:[A-Z0-9]+$/.test(row.symbol)
      && Number.isInteger(row.fiscalYear) && isoDate(row.asOf) && row.asOf.startsWith(`${row.fiscalYear}-`)
      && isoDate(row.availableFrom)
      && row.availableFrom > row.asOf
      && new URL(row.source).hostname === 'market.sec.or.th'
      && new URL(row.availabilitySource).hostname === 'market.sec.or.th'
      && /^[a-f0-9]{64}$/.test(row.sha256)
      && /^data\/statement-evidence\/[A-Za-z0-9.-]+\.xlsx?$/.test(row.evidenceFile)
      && RAW_FIELDS.every(field => Number.isFinite(row.fields[field])
        || (row.statementModel==='bank' && ['ebit','operatingCashFlow'].includes(field) && row.fields[field]===null)
        || (row.scope==='audited-consolidated-comparative'
          && ['openingEquity','openingAssets'].includes(field) && row.fields[field]===null))
      && (row.statementModel!=='bank' || Number.isFinite(row.fields.totalNetIncome));
  } catch { return false; }
}

/** Pick an entire known snapshot, never blend it with a later provider row. */
export function selectStatementVersions(versions, symbol, at) {
  const selected = new Map();
  for (const row of versions) {
    if (!validStatementVersion(row) || row.symbol !== symbol || row.availableFrom > at) continue;
    const previous = selected.get(row.fiscalYear);
    const previousDate=previous?.statementSnapshot.availableFrom;
    if(previousDate>row.availableFrom)continue;
    if(previousDate===row.availableFrom){
      if(previous.ambiguous || previous.statementSnapshot.sha256!==row.sha256
        || RAW_FIELDS.some(field=>previous[field]!==row.fields[field])){
        selected.set(row.fiscalYear,{ambiguous:true,statementSnapshot:{availableFrom:row.availableFrom}});
      }
      continue;
    }
    const fields = Object.fromEntries(RAW_FIELDS.map(field => [field, row.fields[field]]));
    selected.set(row.fiscalYear, {
      ...fields, fiscalYear:row.fiscalYear, asOf:row.asOf,
      statementModel:row.statementModel??'general',
      totalNetIncome:row.fields.totalNetIncome??null,
      publishedAt:row.availableFrom, publicationSource:row.source,
      // EPS units may have changed through splits. Leave the model input unknown
      // until share-basis reconciliation is separately evidenced.
      eps:row.perShareBasisVerified === true ? row.fields.reportedEps : null,
      roa:Number.isFinite(fields.openingAssets) && fields.openingAssets+fields.assets>0
        ? (row.statementModel==='bank'?row.fields.totalNetIncome:fields.ebit) / ((fields.openingAssets + fields.assets) / 2) : null,
      npm:fields.revenue>0 ? fields.netIncome / fields.revenue : null,
      de:fields.totalEquity > 0 ? fields.totalDebt / fields.totalEquity : null,
      statementSnapshot:{source:row.source,availableFrom:row.availableFrom,sha256:row.sha256,scope:row.scope},
    });
  }
  return [...selected.values()].filter(row=>!row.ambiguous).sort((a,b)=>a.fiscalYear-b.fiscalYear);
}
