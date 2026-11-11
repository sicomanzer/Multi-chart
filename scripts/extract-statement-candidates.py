"""Create review candidates from explicitly labelled consolidated columns.
Candidates are not added to the application registry by this script.
"""
import json,re,math
from pathlib import Path
from openpyxl.utils import column_index_from_string,get_column_letter

manifest=json.loads(Path('data/statement-workbook-manifest.json').read_text())['files']
receipts=json.loads(Path('data/filing-dates.json').read_text())['entries']
history=json.loads(Path('data/annual-history.json').read_text())['symbols']
from statement_cells import norm,num,label,header,field,profit

results=[]
for rec in manifest:
 if rec['symbol'] in ['SET:KBANK','SET:BBL','SET:KTB','SET:TTB','SET:KKP','SET:TISCO','SET:SCB']:continue
 try:
  assert not rec.get('error'),rec.get('error')
  sheets=json.loads(Path(rec['cells']).read_text(encoding='utf-8'));symbol=rec['symbol'];year=rec['fiscalYear'];bare=symbol[4:]
  # Select statement sections by their actual titles, excluding separate-company sheets.
  def select(pattern):
   found=[s for s in sheets if re.search(pattern,' '.join(str(v) for r in s['rows'][:5] for v in r.values()),re.I) and not re.search('separate|company',s['name'],re.I)]
   assert found,f'No statement {pattern}'
   return found[0]
  bs=select(r'statements?\s+of\s+financial\s+position')
  pl=select(r'(?:income statements?|statements?\s+of\s+(?:(?:comprehensive\s+)?income|profit\s+or\s+loss))')
  cf=select(r'statements?\s+of\s+cash\s+flows?') if bare!='HMPRO' else pl
  if bare=='PTT':
   equity=next(s for s in sheets if s['name'].startswith('BS-Equity') and 'Separate' not in s['name'])
   liability=next(s for s in sheets if s['name'].startswith('BS-Liability') and 'Separate' not in s['name'])
  else:equity=liability=bs
  sections={'bs':bs,'pl':pl,'cf':cf,'eq':equity,'liab':liability}
  headers={k:header(s,year,bare=='PTTEP') for k,s in sections.items()}
  values={};cells={};comparative={};comparative_cells={}
  def take(key,section,pattern,**kw):
   s=sections[section];col,prev,scale=headers[section]
   values[key],cells[key]=field(s,pattern,col,scale,**kw)
   try:comparative[key],comparative_cells[key]=field(s,pattern,prev,scale,**kw)
   except AssertionError:pass
  take('assets','bs',r'^total assets$')
  take('totalDebt','liab',r'^total liabilities$')
  try:
   # BCP 2019 presents a subtotal before perpetual capital, then total parent
   # equity. Use total parent equity consistently across reporting layouts.
   try:take('equity','eq',r'^total owners of the parent$')
   except AssertionError:take('equity','eq',r'^(?:total shareholders. equity attributable|(?:total )?equity attributable to owners)')
  except AssertionError:
   assert bare=='PTTEP' and not any('non-controlling' in norm(v) for r in bs['rows'] for v in r.values()),'Missing parent equity with NCI'
   take('equity','eq',r'^total equity$')
  take('totalEquity','eq',r'^total (?:shareholders. )?equity$')
  for target,origin in [('openingAssets','assets'),('openingEquity','equity')]:
   values[target]=comparative[origin];cells[target]={**cells[origin],'cell':get_column_letter(column_index_from_string(re.sub(r'\d','',cells[origin]['cell']))+2)+re.sub(r'\D','',cells[origin]['cell'])}
  take('revenue','pl',r'^sales and service income$' if bare=='PTT' else (r'^revenue from sale of goods' if bare=='BCP' else r'^total (?:revenues?|income)$'))
  col,prev,scale=headers['pl']
  try:
   values['netIncome'],cells['netIncome']=profit(pl,col,scale)
   try:comparative['netIncome'],comparative_cells['netIncome']=profit(pl,prev,scale)
   except AssertionError:pass
  except AssertionError:
   assert bare=='PTTEP' and not any('non-controlling' in norm(v) for r in pl['rows'] for v in r.values()),'Missing parent profit with NCI'
   take('netIncome','pl',r'^(?:net profit|profit (?:\(loss\) )?for the year)$')
  take('operatingCashFlow','cf',r'^net cash (?:flows? )?(?:provided by \(used in\)|provided by|from|generated from \(used in\)|provided by \(used in\)) operating activities$')
  try:take('ebit','pl',r'^profit (?:\(loss\) )?before (?:finance|financial|interest)')
  except AssertionError:
   take('profitBeforeTax','pl',r'^(?:profit|profit \(loss\)|loss) before (?:income )?tax')
   take('financeCosts','pl',r'^finance costs?(?:$| )|^financial costs?$')
   values['ebit']=values.pop('profitBeforeTax')+abs(values.pop('financeCosts'))
   cells['ebit']={'calculation':'profitBeforeTax + absolute financeCosts','inputs':[cells.pop('profitBeforeTax'),cells.pop('financeCosts')]}
   if 'profitBeforeTax' in comparative and 'financeCosts' in comparative:
    comparative['ebit']=comparative.pop('profitBeforeTax')+abs(comparative.pop('financeCosts'))
    comparative_cells['ebit']={'calculation':'profitBeforeTax + absolute financeCosts','inputs':[comparative_cells.pop('profitBeforeTax'),comparative_cells.pop('financeCosts')]}
  assert abs(values['assets']-values['totalDebt']-values['totalEquity'])<=max(2,scale*2),'Balance sheet does not reconcile'
  receipt=next(r for r in receipts if r['symbol']==symbol and r['fiscalYear']==year)
  assert receipt['availableFrom']>f'{year}-12-31'
  old=next((r for r in history.get(bare,{}).get('years',[]) if r['y']==year),{})
  differences={}
  for f,k in [('assets','asset'),('equity','equity'),('netIncome','np'),('operatingCashFlow','cfo'),('revenue','rev')]:
   if num(old.get(k)):differences[f]={'provider':old[k],'official':values[f],'difference':values[f]-old[k],'relative':(values[f]-old[k])/abs(old[k]) if old[k] else None}
  identity=re.sub('[^a-z]','',rec['companyName'].lower())
  first_text=re.sub('[^a-z]','',' '.join(str(v) for row in bs['rows'][:5] for v in row.values()).lower())
  assert identity in first_text or (bare=='BCP' and 'bangchakpetroleumpubliccompanylimited' in first_text),'Workbook issuer identity mismatch'
  result={**rec,'fields':values,'fieldEvidence':cells,'comparative':comparative,'comparativeEvidence':comparative_cells,'differences':differences,'availableFrom':max(receipt['availableFrom'],rec.get('notBefore') or receipt['availableFrom']),'availabilitySource':receipt['listingSource'],'candidate':True}
  results.append(result);print(symbol,year,'OK',','.join(f'{k}:{v["relative"]:.4%}' for k,v in differences.items() if v['relative'] is not None and abs(v['relative'])>.00001))
 except (AssertionError,StopIteration,KeyError) as e:
  results.append({**rec,'candidate':False,'error':str(e)});print(rec['symbol'],rec['fiscalYear'],'SKIP',str(e))
Path('data/statement-candidates.json').write_text(json.dumps({'records':results},ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
