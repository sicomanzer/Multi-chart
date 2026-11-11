import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
const read=async p=>JSON.parse(await readFile(p,'utf8'));
const candidates=await read('data/filing-dates-candidates.json');
const history=await read('data/annual-history.json');
const seed=await read('data/set-fundamentals.json');
const unique=new Map();
for(const row of candidates.entries){
 assert.equal(new URL(row.publicationSource).hostname,'market.sec.or.th');
 assert.equal(new URL(row.listingSource).hostname,'market.sec.or.th');
 assert.equal(new Date(row.publishedAt).toISOString().slice(0,10),row.publishedAt);
 const symbol=row.symbol.slice(4);
 const end=history.symbols[symbol]?.years.find(y=>y.y===row.fiscalYear)?.asOf ?? `${row.fiscalYear}-12-31`;
 assert.ok(row.publishedAt>end,`${row.symbol} ${row.fiscalYear}: receipt precedes fiscal end`);
 const evidence=await read(`data/filing-evidence/${symbol}.json`);
 assert.ok(evidence.records.some(r=>r.fiscalYear===row.fiscalYear&&r.publishedAt===row.publishedAt));
 const key=`${row.symbol}|${row.fiscalYear}`;
 const entry={...row,availableFrom:new Date(Date.parse(row.publishedAt)+86400000).toISOString().slice(0,10),evidenceFile:`data/filing-evidence/${symbol}.json`,evidenceSha256:evidence.sha256};
 if(!unique.has(key)||unique.get(key).publishedAt>row.publishedAt)unique.set(key,entry);
}
const entries=[...unique.values()].sort((a,b)=>a.symbol.localeCompare(b.symbol)||a.fiscalYear-b.fiscalYear);
const covered=new Set(entries.map(r=>r.symbol));
const missing=seed.rows.filter(r=>!covered.has(r.symbol)).map(r=>r.symbol);
await writeFile('data/filing-dates.json',JSON.stringify({version:2,checkedAt:candidates.checkedAt,description:'Verified public availability using SEC annual-report receipt dates, not verified earliest financial-statement publication dates. Usable from the next calendar day. Original statement versions remain unverified.',entries},null,2)+'\n');
const lines=['# SEC historical availability coverage — 2026-11-11','',`${entries.length} issuer/year records; ${covered.size}/${seed.rows.length} symbols. Missing: ${missing.join(', ')}.`, '', 'These are actual SEC annual-report receipt dates. They prove availability by that date, not the earliest audited-results announcement. Backtests use the next calendar day and the first eligible trading observation. No dates are borrowed from predecessor legal entities.', '', 'Historical financial values still come from the existing annual-history provider. These dates do not verify original statement versions, restatements, historical market membership, or corporate actions. Results remain research estimates.', '', '| Symbol | Years | SEC evidence |','|---|---|---|'];
for(const symbol of [...covered].sort()){
 const rows=entries.filter(r=>r.symbol===symbol);
 lines.push(`| ${symbol} | ${rows.length} (${rows[0].fiscalYear}–${rows.at(-1).fiscalYear}) | [Receipt register](${rows[0].listingSource}) |`);
}
await writeFile('SEC-AVAILABILITY-2026-11-11.md',lines.join('\n')+'\n');
console.log(JSON.stringify({records:entries.length,symbols:covered.size,missing}));
