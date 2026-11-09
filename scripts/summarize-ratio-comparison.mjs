import {readFile,writeFile} from 'node:fs/promises';
const audit=JSON.parse(await readFile('ratio-comparison.json','utf8'));
const valid=v=>typeof v==='number'&&Number.isFinite(v);
const fmt=v=>valid(v)?v.toFixed(2):'—';
const rows=audit.rows.filter(r=>!r.error).map(r=>{
 const t=[...r.trading].sort((a,b)=>a.date.localeCompare(b.date)).at(-1);
 const f=[...r.financial].sort((a,b)=>a.asOfDate.localeCompare(b.asOfDate)).at(-1);
 const factor=r.saved.p/t.close;
 return {symbol:r.symbol,saved:r.saved,exchange:t,financial:f,
  adjusted:{pe:valid(t.pe)?t.pe*factor:null,pbv:valid(t.pbv)?t.pbv*factor:null,dividendYield:valid(t.dividendYield)?t.dividendYield/factor:null,de:f?.deRatio},
  gaps:Object.fromEntries(['pe','pbv','dividendYield','de'].map(k=>{const target=k==='de'?f?.deRatio:k==='dividendYield'?t[k]/factor:t[k]*factor;return[k,valid(r.saved[k])&&valid(target)&&target!==0?(r.saved[k]-target)/Math.abs(target)*100:null]}))};
});
const summary={};
for(const k of ['pe','pbv','dividendYield','de']){
 const sorted=rows.map(r=>Math.abs(r.gaps[k])).filter((_,i)=>valid(rows[i].gaps[k])).sort((a,b)=>a-b);
 summary[k]={compared:sorted.length,within5:sorted.filter(v=>v<=5).length,medianAbsPercent:sorted.length?sorted[Math.floor(sorted.length/2)]:null,over20:rows.filter(r=>valid(r.gaps[k])&&Math.abs(r.gaps[k])>20).map(r=>({symbol:r.symbol,saved:r.saved[k],setAdjusted:r.adjusted[k],gap:r.gaps[k]})),missing:rows.filter(r=>!valid(r.saved[k])).map(r=>r.symbol)};
}
let md='# Saved ratio comparison against SET\n\n';
md+=`Checked: ${audit.checkedAt}. Saved data: 2026-11-09. SET trading dates: ${[...new Set(rows.map(r=>r.exchange.date.slice(0,10)))].join(', ')}.\n\n`;
md+='SET multiples and dividend yields below are adjusted to each saved price to reduce price-date differences. This does not align financial statement vintages or dividend definitions. D/E compares TradingView debt/equity with SET liabilities/equity, which are different measures.\n\n';
md+='|Symbol|Saved price|SET price|Saved P/E|SET P/E adjusted|Saved P/BV|SET P/BV adjusted|Saved yield %|SET yield % adjusted|Saved D/E|SET liabilities/equity|\n|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|\n';
for(const r of rows.sort((a,b)=>a.symbol.localeCompare(b.symbol)))md+=`|${r.symbol}|${[r.saved.p,r.exchange.close,r.saved.pe,r.adjusted.pe,r.saved.pbv,r.adjusted.pbv,r.saved.dividendYield,r.adjusted.dividendYield,r.saved.de,r.adjusted.de].map(fmt).join('|')}|\n`;
await writeFile('RATIO-COMPARISON-2026-11-09.md',md);
await writeFile('ratio-comparison-summary.json',JSON.stringify({summary,rows},null,2));
console.log(JSON.stringify(summary,null,2));
