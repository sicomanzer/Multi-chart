"""Verify FY2025 reported basic EPS for same-year payout only, not EPS growth."""
import json,sys,hashlib
from pathlib import Path
sys.path.insert(0,str(Path('.tools/python-deps')))
import xlrd
from openpyxl import load_workbook
spec={'KBANK':('COMPREHENSIVE INCOME','G59',20.63),'BBL':('Income','H96',24.10177735937424),'KTB':('PL (E)','F86',3.45),'TTB':('PL 8-9','E70',.22),'KKP':('Comprehensive income 7-8','D104',7.17),'TISCO':('PL & CF','D79',8.32),'SCB':('PL','D78',14.103494770555406)}
p=Path('data/statement-versions.json');data=json.loads(p.read_text(encoding='utf-8'))
from openpyxl.utils.cell import coordinate_to_tuple
for s,(sheet,cell,expected) in spec.items():
 r=next(r for r in data['versions'] if r['symbol']=='SET:'+s and r['fiscalYear']==2025 and r['scope']=='audited-consolidated-current-year')
 path=Path(r['evidenceFile']);raw=path.read_bytes();assert hashlib.sha256(raw).hexdigest()==r['sha256']
 if raw[:2]==b'PK':book=load_workbook(path,data_only=True);v=book[sheet][cell].value
 else:
  book=xlrd.open_workbook(file_contents=raw);row,col=coordinate_to_tuple(cell);v=book.sheet_by_name(sheet).cell_value(row-1,col-1)
 assert abs(v-expected)<1e-10
 r['fields']['payoutEps']=v;r['cells']['payoutEps']={'sheet':sheet,'cell':cell,'scale':1,'label':'FY2025 consolidated basic EPS, THB per ordinary share; payout use only'}
 r['payoutEpsVerified']=True
 r['payoutEpsBasis']='current-year-reported-basic-EPS; same-year-payout-only; no historical split-adjusted growth certification'
# Explicit annual report classification, kept separate from EPS/growth units.
r=next(r for r in data['versions'] if r['symbol']=='SET:KBANK' and r['fiscalYear']==2025)
ar=Path('data/bank-risk-evidence/KBANK-2025-ar.pdf')
pages=json.loads(ar.with_suffix('.pages.json').read_text(encoding='utf-8'))
assert 'special dividend of Baht 2.00' in pages[3]['text']
assert '14.00' in pages[3]['text'] and '12.00' in pages[3]['text']
r['regularDividend']={'regularDps':12.0,'totalDps':14.0,'fiscalYear':2025,
 'availableFrom':'2026-11-12','liveAvailableFrom':'2026-11-11','availabilityBasis':'first-observed-next-day',
 'source':'https://www.kasikornbank.com/en/IR/FinanInfoReports/financialReports/y2025-onereport-en.pdf',
 'evidenceFile':str(ar).replace('\\','/'),'sha256':hashlib.sha256(ar.read_bytes()).hexdigest(),'pdfPage':4}
p.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print('Verified 7 FY2025 basic EPS cells; historical growth flags unchanged')
