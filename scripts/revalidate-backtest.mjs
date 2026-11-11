import {writeFile} from 'node:fs/promises';
import {runBacktest} from '../server/backtest.js';
import {initAnnualHistory} from '../server/finnomena.js';
await initAnnualHistory();
const symbols=['SET:KBANK','SET:PTT','SET:PTTEP','SET:BCP','SET:MINT','SET:ADVANC','SET:KCE','SET:HMPRO'];
const rows=[];
for(const publicationMode of ['original','verified','estimated']) {
 const result=await runBacktest({symbols,publicationMode,holdYears:3,concurrency:2});
 rows.push(result);
 console.log(JSON.stringify({mode:publicationMode,version:result.version,periods:result.totals.periods,observations:result.totals.names,mean:result.totals.portfolioMean,reliability:result.reliability}));
}
await writeFile('backtest-revalidation.json',JSON.stringify({checkedAt:new Date().toISOString(),symbols,results:rows},null,2));
