"""Read original XLS/XLSX attachments without modifying the workbooks."""
import io,json,sys,zipfile,hashlib
from pathlib import Path
sys.path.insert(0,str(Path('.tools/python-deps').resolve()))
import xlrd
from openpyxl import load_workbook
from openpyxl.utils import get_column_letter
manifest=json.loads(Path('data/statement-archive-manifest.json').read_text())
outputs=[]
for record in manifest['files']:
 if record.get('error'):continue
 path=Path(record['path']);z=zipfile.ZipFile(path)
 books=[n for n in z.namelist() if n.lower().endswith(('.xls','.xlsx'))]
 if len(books)!=1:
  outputs.append({**record,'error':f'Expected one statement workbook, got {books}'});continue
 n=books[0];raw=z.read(n);is_xlsx=raw[:2]==b'PK';out=path.with_suffix('.xlsx' if is_xlsx else '.xls');out.write_bytes(raw)
 sheets=[]
 if is_xlsx:
  w=load_workbook(io.BytesIO(raw),data_only=True)
  for s in w:
   sheets.append({'name':s.title,'rows':[{c.coordinate:c.value for c in row if c.value is not None} for row in s if any(c.value is not None for c in row)]})
 else:
  w=xlrd.open_workbook(file_contents=raw)
  for s in w.sheets():
   sheets.append({'name':s.name,'rows':[{f'{get_column_letter(c+1)}{r+1}':s.cell_value(r,c) for c in range(s.ncols) if s.cell_value(r,c)!=''} for r in range(s.nrows) if any(s.cell_value(r,c)!='' for c in range(s.ncols))]})
 cells=path.with_suffix('.cells.json');cells.write_text(json.dumps(sheets,ensure_ascii=False,default=str)+'\n',encoding='utf-8')
 outputs.append({**record,'workbook':str(out).replace('\\','/'),'workbookSha256':hashlib.sha256(raw).hexdigest(),'member':n,'cells':str(cells).replace('\\','/')})
 print(record['symbol'],record['fiscalYear'],[(s['name'],len(s['rows'])) for s in sheets])
Path('data/statement-workbook-manifest.json').write_text(json.dumps({'files':outputs},indent=2)+'\n')
