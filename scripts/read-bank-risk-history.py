import json,re
from pathlib import Path
from pypdf import PdfReader
manifest=json.loads(Path('data/bank-risk-history-manifest.json').read_text(encoding='utf-8'))['records']
records=[]
for r in manifest:
 if r.get('error'):records.append(r);continue
 p=Path(r['path']);out=p.with_suffix('.pages.json')
 try:
  if out.exists():pages=json.loads(out.read_text(encoding='utf-8'))
  else:
   doc=PdfReader(p);pages=[{'page':i+1,'text':x.extract_text()} for i,x in enumerate(doc.pages)]
   out.write_text(json.dumps(pages,ensure_ascii=False),encoding='utf-8')
  text=re.sub('[^a-z]','',' '.join(x['text'] for x in pages[:10]).lower())
  expected={'KBANK':['kasikornbank'],'BBL':['bangkokbank'],'KTB':['krungthai'],'TTB':['tmbbank','tmbthanachart','tmb','ttb'],
   'KKP':['kiatnakin'],'TISCO':['tiscofinancialgroup'],'SCB':['scbx']}[r['symbol'][4:]]
  assert any(s in text for s in expected),'PDF issuer does not match requested issuer'
  records.append({**r,'pagesFile':str(out).replace('\\','/'),'pages':len(pages)})
  print(r['symbol'],r['fiscalYear'],r['publishedAt'],len(pages))
 except Exception as e:records.append({**r,'error':str(e)});print(r['symbol'],r['fiscalYear'],'ERROR',str(e))
Path('data/bank-risk-history-pages.json').write_text(json.dumps({'records':records},indent=2)+'\n',encoding='utf-8')
