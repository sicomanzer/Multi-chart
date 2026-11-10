import {readFile,writeFile} from 'node:fs/promises';
const auditFile=process.argv[2] ?? 'value-screener-audit.json';
const audit=JSON.parse(await readFile(auditFile,'utf8'));
const page='https://www.set.or.th/th/market/product/stock/quote/PTT/price';
const response=await fetch(page);
const headers={Cookie:response.headers.getSetCookie().map(c=>c.split(';')[0]).join('; '),Referer:page,'User-Agent':'Mozilla/5.0',Accept:'application/json'};
for(const row of audit.rows){
 if(!row.detail)continue;
 const root=`https://www.set.or.th/api/set/stock/${row.symbol}/company-highlight/`;
 const get=async suffix=>{const r=await fetch(root+suffix+'?lang=en',{headers,signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('SET '+r.status);return r.json();};
 try{
  const [trading,financial]=await Promise.all([get('trading-stat'),get('financial-data')]);
  row.official={trading,financial};
  const t=trading.at(-1),mine=row.detail.years.at(-1),fy=financial.find(f=>f.quarter==='Q9'&&f.year===mine.fiscalYear);
  row.comparison={tradingDate:t.date,ratios:{pe:[row.detail.pe,t.pe],pbv:[row.detail.pbv,t.pbv],yield:[row.detail.dividendYield*100,t.dividendYield]},year:mine.fiscalYear,annual:fy?{
   revenue:[mine.revenue,fy.totalRevenue*1000],netProfit:[mine.netIncome,fy.netProfit*1000],eps:[mine.eps,fy.eps],roe:[mine.roe*100,fy.roe],roa:[mine.roa*100,fy.roa],npm:[mine.npm*100,fy.netProfitMargin],de:[mine.de,fy.deRatio]}:null};
  console.log(JSON.stringify({symbol:row.symbol,...row.comparison}));
 }catch(error){row.officialError=error.message;console.log(row.symbol,error.message);}
}
await writeFile(auditFile,JSON.stringify(audit,null,2));
