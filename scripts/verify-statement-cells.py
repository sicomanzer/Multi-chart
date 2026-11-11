"""Independently reopen the original workbooks and reconcile every model cell."""
import hashlib,json,math,re,sys
from pathlib import Path
sys.path.insert(0,str(Path('.tools/python-deps').resolve()))
import xlrd
from openpyxl import load_workbook
from openpyxl.utils import coordinate_to_tuple
rows=json.loads(Path('data/statement-versions.json').read_text(encoding='utf-8'))['versions']
books={};count=0
for row in rows:
 path=Path(row['evidenceFile']);raw=path.read_bytes()
 assert hashlib.sha256(raw).hexdigest()==row['sha256']
 if str(path) not in books:
  books[str(path)]=load_workbook(path,data_only=True) if raw[:2]==b'PK' else xlrd.open_workbook(file_contents=raw)
 book=books[str(path)]
 def cell_value(evidence):
  if 'calculation' in evidence:
   assert evidence['calculation']=='profitBeforeTax + absolute financeCosts'
   return cell_value(evidence['inputs'][0])+abs(cell_value(evidence['inputs'][1]))
  r,c=coordinate_to_tuple(evidence['cell'])
  value=book[evidence['sheet']][evidence['cell']].value if raw[:2]==b'PK' else book.sheet_by_name(evidence['sheet']).cell_value(r-1,c-1)
  assert isinstance(value,(int,float))
  return value*evidence.get('scale',1)
 keys=['assets','openingAssets','totalDebt','equity','openingEquity','totalEquity','revenue','netIncome','operatingCashFlow','ebit']
 if row.get('statementModel')=='bank':keys+=['totalNetIncome']
 if row.get('payoutEpsVerified'):
  keys+=['payoutEps']
  assert row['cells']['payoutEps']['scale']==1
 for field in keys:
  value=row['fields'][field]
  if value is None:
   assert (row['scope']=='audited-consolidated-comparative' and field in ['openingAssets','openingEquity']) or (row.get('statementModel')=='bank' and field in ['ebit','operatingCashFlow'])
   continue
  assert math.isclose(value,cell_value(row['cells'][field]),rel_tol=1e-12,abs_tol=.01),(row['symbol'],row['fiscalYear'],field)
  count+=1
 assert abs(row['fields']['assets']-row['fields']['totalDebt']-row['fields']['totalEquity'])<=2000
print(f'Passed: {len(rows)} snapshots, {count} model inputs checked against original workbook cells; hashes and balance sheets reconcile')
