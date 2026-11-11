/** Structural checks run for every symbol, regardless of watchlist or preset.
 * Consistency is separate from independently reviewed issuer evidence. */
export function auditScreeningRow(row){
 const issues=[];const add=(code,severity='review')=>issues.push({code,severity});
 if(row.score!=null&&row.scoringYearCount===0)add('score-without-statements','error');
 const missing=(row.checks??[]).filter(c=>!c.na&&c.pass===null).map(c=>c.id);
 if(missing.length)add('incomplete-checks');
 if(row.dataIssue)add('unscored-data');
 if(row.dataCoverage!=null&&(!Number.isFinite(row.dataCoverage)||row.dataCoverage<0||row.dataCoverage>1))add('invalid-coverage','error');
 const p=row.payoutEvidence;
 if(row.payout!=null){
  if(p?.epsSource==='provider-unverified')add('payout-eps-unverified');
  if(!p||!Number.isInteger(p.fiscalYear)||p.fiscalYear!==row.dividendFy||!(p.eps>0)||!Number.isFinite(p.dps))add('payout-period-unverified');
  else if(Math.abs(row.payout-p.dps/p.eps)>1e-8)add('payout-math-mismatch','error');
 }
 if(row.ddm?.ok&&row.ddm.d0>0&&p?.dps!=null&&Math.abs(row.ddm.d0-p.dps)>1e-8)add('dividend-model-mismatch','error');
 if(row.residualIncome?.ok&&(row.roe3==null||row.payout==null))add('valuation-missing-input','error');
 if(row.qualityRatiosStale||row.ratiosStale)add('stale-source');
 if(row.dividendPeriodEvidence?.status==='different')add('dividend-period-total-differs');
 if(row.dividendPeriodEvidence?.status==='period-incomplete')add('dividend-operating-period-incomplete');
 const dividendClassification=row.dividendClassification??'unreviewed';
 if(row.ddm?.d0>0&&dividendClassification!=='issuer-verified')add('regular-dividend-unverified');
 return {version:1,status:issues.some(i=>i.severity==='error')?'error':issues.length?'needs-review':'consistent',
  missingChecks:missing,dividendClassification,issues,
  scope:'automated-consistency; not an issuer-filings certification'};
}
