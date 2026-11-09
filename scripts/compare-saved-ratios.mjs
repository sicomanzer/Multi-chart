import { readFile, writeFile } from 'node:fs/promises';
const points = (await readFile('data/history/2026-11-09.jsonl','utf8')).trim().split('\n').map(JSON.parse);
const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/152.0.0.0 Safari/537.36';
const page = 'https://www.set.or.th/th/market/product/stock/quote/PTT/price';
const response = await fetch(page, {headers:{'User-Agent':ua},signal:AbortSignal.timeout(15000)});
const cookie = response.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');
const headers = {'User-Agent':ua,Cookie:cookie,Referer:page,Accept:'application/json'};
const rows=[];
for(const point of points){
  const symbol=point.s.slice(4);
  try{
    const get=async suffix=>{
      const r=await fetch(`https://www.set.or.th/api/set/stock/${encodeURIComponent(symbol)}/company-highlight/${suffix}?lang=en`,{headers,signal:AbortSignal.timeout(12000)});
      if(!r.ok)throw Error(`${r.status} ${suffix}`);
      return r.json();
    };
    const [trading,financial]=await Promise.all([get('trading-stat'),get('financial-data')]);
    rows.push({symbol,saved:point,trading,financial});
  }catch(e){ rows.push({symbol,saved:point,error:e.message}); }
}
await writeFile('ratio-comparison.json',JSON.stringify({checkedAt:new Date().toISOString(),rows},null,2));
console.log(JSON.stringify({total:rows.length,ok:rows.filter(r=>!r.error).length,errors:rows.filter(r=>r.error).map(r=>({symbol:r.symbol,error:r.error})),sample:rows.find(r=>!r.error)},null,2));
