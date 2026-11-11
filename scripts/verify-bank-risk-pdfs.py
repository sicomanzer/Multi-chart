"""Reopen reviewed PDFs, verify byte hashes and exact evidence anchors."""
import hashlib,json,re
from pathlib import Path
from pypdf import PdfReader
rows=json.loads(Path('data/bank-risk.json').read_text(encoding='utf-8'))['rows'];documents={};count=0
for row in rows:
 for key,m in row['metrics'].items():
  path=Path(m['evidenceFile']);assert hashlib.sha256(path.read_bytes()).hexdigest()==m['sha256']
  if str(path) not in documents:documents[str(path)]=PdfReader(path)
  text=documents[str(path)].pages[m['pdfPage']-1].extract_text()
  flat=lambda s:re.sub(r'\s+','',s).lower()
  assert flat(m['anchor']) in flat(text),(row['symbol'],key,'anchor')
  assert any(flat(v) in flat(text) for v in [str(m['reportedPercent']),f'{m["reportedPercent"]:.2f}',f'{m["reportedPercent"]:g}'])
  assert abs(m['value']-m['reportedPercent']/100)<1e-10
  assert m['asOf']==f'{row["fiscalYear"]}-12-31'
  count+=1
print(f'Passed: {count} reported metrics, original PDF hashes, pages, evidence anchors, percentage units and fiscal periods')
