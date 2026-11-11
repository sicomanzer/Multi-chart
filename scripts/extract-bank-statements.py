"""Review consolidated bank statements; never manufacture industrial EBIT/FCF."""
import json,re
from pathlib import Path
from openpyxl.utils import get_column_letter,column_index_from_string
from statement_cells import norm,num,label,field
BANKS=['KBANK','BBL','KTB','TTB','KKP','TISCO','SCB']
records=json.loads(Path('data/statement-workbook-manifest.json').read_text(encoding='utf-8'))['files']
receipts=json.loads(Path('data/filing-dates.json').read_text(encoding='utf-8'))['entries']

def bank_header(sheet,year):
 rows=sheet['rows'][:20];text=norm(' '.join(str(v) for row in rows for v in row.values()))
 assert 'consolidated' in text,'No consolidated header'
 assert 'baht' in text and 'dollar' not in text,'Currency not exclusively THB'
 scale=1000 if ('thousand' in text or re.search(r"baht\s*:\s*'000",text)) else 1
 for row in rows:
  for cell,value in row.items():
   if re.match(rf'^(?:{year}(?:\.0)?(?:$|\s*\()|31 december {year}|december 31,? {year})',norm(value)):
    col=re.sub(r'\d','',cell)
    assert column_index_from_string(col)>=3,'Year found in title, not a statement column'
    return col,get_column_letter(column_index_from_string(col)+2),scale
 raise AssertionError('No current-year consolidated column')

results=[]
for rec in records:
 if rec['symbol'][4:] not in BANKS:continue
 try:
  assert not rec.get('error'),rec.get('error')
  ss=json.loads(Path(rec['cells']).read_text(encoding='utf-8'));year=rec['fiscalYear'];bare=rec['symbol'][4:]
  def section(pattern):
   return next(s for s in ss if re.search(pattern,norm(' '.join(str(v) for row in s['rows'][:6] for v in row.values()))))
  bs=section(r'statements? of financial position')
  pl=section(r'statements? of (?:comprehensive income|profit or loss|income)')
  sections={'bs':bs,'pl':pl};headers={k:bank_header(v,year) for k,v in sections.items()}
  identity=re.sub('[^a-z]','',rec['companyName'].lower())
  title=re.sub('[^a-z]','',' '.join(str(v) for row in bs['rows'][:6] for v in row.values()).lower())
  aliases={'TTB':['tmbbankpubliccompanylimited','tmbthanachartbankpubliccompanylimited'],'KKP':['kiatnakinbankpubliccompanylimited']}
  assert identity in title or any(x in title for x in aliases.get(bare,[])),'Issuer identity mismatch'
  fields={};cells={};comparative={};comparative_cells={};comparative_opening={};comparative_opening_cells={}
  def take(key,section,pattern):
   col,prev,scale=headers[section];s=sections[section]
   fields[key],cells[key]=field(s,pattern,col,scale)
   comparative[key],comparative_cells[key]=field(s,pattern,prev,scale)
  take('assets','bs',r'^total assets$');take('totalDebt','bs',r'^total liabilities$')
  take('totalEquity','bs',r'^total (?:shareholders. )?equity$')
  try:take('equity','bs',r'^(?:total owners of the company|total bank.s equity|total equity of the bank|(?:total )?equity attributable|total shareholders. equity attributable)')
  except AssertionError:
   assert not any('non-controlling' in norm(v) for row in bs['rows'] for v in row.values()),'Parent equity missing with NCI'
   take('equity','bs',r'^total (?:shareholders. )?equity$')
  for target,origin in [('openingAssets','assets'),('openingEquity','equity')]:
   fields[target]=comparative[origin];cells[target]=comparative_cells[origin]
  # Some restatement reports explicitly supply 1 January of the prior year.
  # That third consolidated column proves the revised comparative's opening.
  third=get_column_letter(column_index_from_string(headers['bs'][0])+4)
  third_header=norm(' '.join(str(v) for r in bs['rows'][:15] for c,v in r.items() if re.sub(r'\d','',c)==third))
  if ('1 january' in third_header and str(year-1) in third_header) or (f'31 december {year-2}' in third_header):
   for target,origin in [('openingAssets','assets'),('openingEquity','equity')]:
    cell=third+re.sub(r'\D','',cells[origin]['cell'])
    value=next((r[cell] for r in bs['rows'] if cell in r),None)
    assert num(value),'Missing third-column opening value'
    comparative_opening[target]=value*headers['bs'][2]
    comparative_opening_cells[target]={'sheet':bs['name'],'cell':cell,'scale':headers['bs'][2]}
  try:take('netIncome','pl',r'^profit for the year attributable to the company$')
  except AssertionError:take('netIncome','pl',r'^(?:equity holders|owners) of (?:the )?(?:bank|company|parent)')
  take('totalNetIncome','pl',r'^(?:net profit(?: \(loss\))?|(?:total )?profit(?: \(loss\))? for the (?:years?|period)|total profit)$')
  take('revenue','pl',r'^total operating income$')
  # Cash/deposit/loan flows and bank funding costs do not represent industrial EBIT/FCF.
  fields.update({'ebit':None,'operatingCashFlow':None})
  assert abs(fields['assets']-fields['totalDebt']-fields['totalEquity'])<=2000,'Balance does not reconcile'
  receipt=next(r for r in receipts if r['symbol']==rec['symbol'] and r['fiscalYear']==year)
  results.append({**rec,'candidate':True,'statementModel':'bank','fields':fields,'fieldEvidence':cells,
   'comparativeOpening':comparative_opening,'comparativeOpeningEvidence':comparative_opening_cells,
   'comparative':comparative,'comparativeEvidence':comparative_cells,
   'availableFrom':max(receipt['availableFrom'],rec.get('notBefore') or receipt['availableFrom']),
   'availabilitySource':receipt['listingSource']})
  print(bare,year,'OK')
 except (AssertionError,StopIteration,KeyError) as e:
  results.append({**rec,'candidate':False,'error':str(e)});print(rec['symbol'],rec['fiscalYear'],'SKIP',str(e))
Path('data/bank-statement-candidates.json').write_text(json.dumps({'records':results},ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
