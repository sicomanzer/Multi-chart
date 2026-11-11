import assert from 'node:assert/strict';
import {scoreQuality,applyPreset} from '../server/screener.js';
import {isBankSymbol,BANK_POLICY} from '../server/business-models.js';
import {loadStatementVersions,bankScoringYears,selectStatementVersions} from '../server/statement-versions.js';
import {summariseBacktest} from '../server/backtest.js';
const years=[2023,2024,2025].map(fiscalYear=>({fiscalYear,roe:.11,roa:.012,npm:.3,netIncome:100,de:8,operatingCashFlow:-100,freeCashFlow:-100}));
const args={years,dividends:[],price:10,asOf:new Date('2026-11-11'),isBank:true};
const bank=scoreQuality(args),general=scoreQuality({...args,isBank:false});
assert.equal(bank.checks.find(c=>c.id==='roaLevel').pass,true);
assert.equal(general.checks.find(c=>c.id==='roaLevel').pass,false);
assert.equal(bank.checks.find(c=>c.id==='roeLevel').threshold,BANK_POLICY.roe);
for(const id of ['npmLevel','npmTrend','debtLevel','interestCoverage','cfoPositive','fcfPositive']){
 const check=bank.checks.find(c=>c.id===id);assert.equal(check.pass,null);assert.equal(check.na,true);
}
assert.equal(bank.bankRiskComplete,false);
assert.equal(bank.checks.find(c=>c.id==='bankNpl').pass,null);
assert.equal(applyPreset({...bank,ddm:{}},{requires:[],minScore:0}).reason,'unknown:bankRisk');
const risk={verified:true,fiscalYear:2025,basis:'consolidated',source:'https://www.kasikornbank.com/test-fixture',availableFrom:'2026-03-01',capitalAdequacy:.20,npl:.02,nplCoverage:1.8};
const complete=scoreQuality({...args,bankRisk:risk});
assert.equal(complete.bankRiskComplete,true);
assert.equal(applyPreset({...complete,ddm:{}},{requires:[],minScore:0}).pass,true);
for(const invalid of [{...risk,fiscalYear:2024},{...risk,basis:'bank-only'},{...risk,availableFrom:'2027-01-01'},{...risk,verified:false}]){
 assert.equal(scoreQuality({...args,bankRisk:invalid}).bankRiskComplete,false);
}
const failed=scoreQuality({...args,bankRisk:{...risk,npl:.05}});
assert.equal(applyPreset({...failed,ddm:{}},{requires:[],minScore:0}).reason,'requires:bankNpl');
assert.equal(isBankSymbol('SET:AEONTS'),false);
assert.equal(isBankSymbol('SET:KTC'),false);
const versions=await loadStatementVersions();
assert.equal(selectStatementVersions(versions,'SET:KBANK','2026-11-11').at(-1).regularDividend,null);
assert.equal(selectStatementVersions(versions,'SET:KBANK','2026-11-12').at(-1).regularDividend.regularDps,12);
assert.equal(bankScoringYears(versions,'SET:KBANK','2026-11-11').at(-1).regularDividend.regularDps,12);
for(const [symbol,dps,eps] of [['KBANK',14,20.63],['BBL',10,24.10177735937424],['KTB',2.67,3.45],['TTB',.134,.22],['KKP',5.7,7.17],['TISCO',7.75,8.32],['SCB',11.28,14.103494770555406]]){
 const ys=bankScoringYears(versions,'SET:'+symbol,'2026-11-11');
 assert.equal(ys.at(-1).payoutEps,eps);
 assert.equal(ys.at(-1).eps,null); // payout review does not certify historical EPS growth
 const q=scoreQuality({...args,years:ys,history:{years:ys},dividends:[{date:'2026-05-15',amount:dps}],asOf:new Date('2026-11-11')});
 assert.ok(Math.abs(q.payout-(symbol==='KBANK'?12:dps)/eps)<1e-10,symbol);
 const unknown=scoreQuality({...args,years:ys.map(y=>({...y,payoutEps:null})),ttmEps:99,dividends:[{date:'2026-05-15',amount:dps}],asOf:new Date('2026-11-11')});
 assert.equal(unknown.payout,null); // no TTM or other-year fallback
}
assert.equal(versions.filter(r=>r.statementModel==='bank'&&r.scope==='audited-consolidated-current-year').length,64);
assert.ok(versions.filter(r=>r.symbol==='SET:SCB').every(r=>r.fiscalYear>=2022));
const latest=bankScoringYears(versions,'SET:KBANK','2026-11-11').at(-1);
const tiscoYears=bankScoringYears(versions,'SET:TISCO','2026-11-11');
const tisco2023=tiscoYears.find(r=>r.fiscalYear===2023);
assert.equal(tisco2023.openingEquity,42787386000);
assert.equal(tisco2023.roe,7301113000/((42787386000+42444870000)/2));
assert.equal(tisco2023.openingAssets,null);
assert.equal(tisco2023.roa,null);
const tiscoQuality=scoreQuality({...args,years:tiscoYears,history:{years:tiscoYears}});
assert.ok(tiscoQuality.roe3>0);
assert.equal(tiscoQuality.roa3,null);
assert.equal(latest.roa,latest.totalNetIncome/((latest.assets+latest.openingAssets)/2));
assert.equal(latest.ebit,null);
assert.equal(latest.operatingCashFlow,null);
assert.equal(latest.eps,null);
const observation={...bank,date:'2020-03-31',symbol:'SET:KBANK',forwardTotal:.2,score:100,mos:.5};
assert.equal(summariseBacktest([observation]).totals.portfolio,null);
const separated=summariseBacktest([observation,{...observation,qualityModel:'general',symbol:'SET:TEST'}]);
assert.equal(separated.rules.filter(r=>r.id==='roeLevel').length,2);
console.log('Bank thresholds, model exclusions, risk evidence gates, period/basis checks, reviewed statements and ROA basis passed');
