"""Promote explicitly reviewed current-year MD&A columns, never comparative/future values.
Re-run after build-bank-risk-data.py. Latest captured annual releases are conservative
availability bounds; earlier unreviewed versions remain in the source manifest only.
"""
import json,re,hashlib,datetime
from pathlib import Path
flat=lambda s:re.sub(r'\s+','',s).lower()
manifest=json.loads(Path('data/bank-risk-history-manifest.json').read_text(encoding='utf-8'))['records']
latest={}
for r in manifest:
 k=(r['symbol'],r['fiscalYear'])
 if k not in latest or r['publishedAt']>latest[k]['publishedAt']:latest[k]=r
now=datetime.datetime.now(datetime.timezone.utc).isoformat()
# Values in percentage points, explicitly reviewed year-end current-year columns.
values={
 'KBANK':[(18.84,3.32,130.92),(17.96,3.30,148.45),(18.32,3.34,160.60),(19.62,3.65,148.60),(18.80,3.93,149.19),(18.77,3.76,159.08),(18.81,3.19,154.26),(19.41,3.19,152.23),(20.25,3.18,153.27)],
 'BBL':[(18.32,3.2,173.6),(18.17,3.9,160.2),(17.96,3.4,190.9),(20.04,3.4,220.2),(18.34,3.9,186.8),(19.57,3.2,225.8),(19.13,3.1,260.8),(19.57,2.7,314.7),(20.35,2.7,334.3)],
 'KTB':[(16.60,3.97,121.57),(17.20,4.19,121.71),(18.21,4.53,125.74),(19.01,4.33,131.76),(19.11,3.81,147.3),(20.12,3.50,168.8),(19.80,3.26,179.7),(20.71,3.08,181.3),(21.42,2.99,188.6)],
 'TTB':[(18.1,2.53,143),(17.3,2.35,143),(17.5,2.76,152),(29.7,2.30,120),(19.6,2.50,None),(19.3,2.81,None),(20.0,2.73,138),(20.7,2.62,155),(19.3,2.59,151)],
 'KKP':[(18.53,5.6,110.1),(16.45,5.0,109.8),(16.29,4.1,114.8),(16.60,4.0,111.2),(18.28,3.2,170.9),(17.35,3.3,175.1),(16.63,3.4,154.4),(16.61,3.3,164.6),(17.35,4.3,134.2)],
 'TISCO':[(19.59,2.54,139.8),(20.72,2.32,196.5),(22.91,2.86,169.8),(22.10,2.40,183.7),(21.9,2.50,210.5),(23.2,2.4,236.8),(20.6,2.09,258.8),(19.51,2.22,189.9),(18.6,2.35,155.3)],
 'SCB':[(18.9,3.34,159.7),(18.8,3.44,159.9),(18.9,3.37,158.0)]}
keys=['capitalAdequacy','npl','nplCoverage']
# Reviewed table/narrative page positions prevent sector-aggregate and bank-only matches.
pages={
 'KBANK':[[37]*3,[42]*3,[40]*3,[43]*3,[53]*3,[51]*3,[57]*3,[62]*3,[47]*3],
 'BBL':[[6]*3,[6]*3,[6]*3,[8]*3,[7]*3,[7]*3,[8]*3,[8]*3,[7]*3],
 'KTB':[[11,12,12],[12,13,13],[15,12,11],[16,13,13],[18,14,14],[15,13,13],[18,15,15],[18,15,15],[19,16,16]],
 'TTB':[[16,11,8],[14,10,10],[16,12,12],[18,15,15],[18,14,None],[21,17,None],[20,16,16],[21,17,17],[21,19,19]],
 'KKP':[[12,2,7],[10,2,6],[11,14,7],[10,13,6],[12,15,10],[10,13,8],[10,13,2],[11,14,3],[10,13,3]],
 'TISCO':[[7,5,6],[7,6,6],[12,9,9],[11,9,9],[16,11,12],[15,11,12],[14,10,11],[15,11,11],[16,12,12]],
 'SCB':[[19,20,20],[20,21,21],[22,23,23]]}

def anchor_for(text,value,key,s,y):
 # Retain a contiguous exact source anchor including the actual reported value.
 # Word splitting in legacy PDF fonts is ignored, but numeric column order is not.
 patterns=[f'{value:.2f}',f'{value:.1f}',f'{value:g}']
 matches=[]
 for v in patterns:
  pat=r'(?<![\d.])'+r'\s*'.join(re.escape(c) for c in v)+r'(?![\d.])'
  for m in re.finditer(pat,text):matches.append(m)
 assert matches,(s,y,key,value,'value absent from reviewed page')
 # Pick a value occurrence near its metric label; subsequent audit verifies the context.
 words={'capitalAdequacy':r'capital|BIS|CAR','npl':r'NPL|non.performing','nplCoverage':r'coverage|reserve|allowance'}[key]
 def distance(m):
  labels=list(re.finditer(words,text,re.I));return min([abs(m.start()-l.start()) for l in labels] or [100000])
 m=min(matches,key=distance);return text[max(0,m.start()-110):min(len(text),m.end()+90)].strip()
rows=[]
for s,series in values.items():
 for i,vs in enumerate(series):
  y=(2022 if s=='SCB' else 2016)+i;r=latest[('SET:'+s,y)];ps=json.loads(Path(r['path']).with_suffix('.pages.json').read_text(encoding='utf-8'))
  assert hashlib.sha256(Path(r['path']).read_bytes()).hexdigest()==r['sha256']
  assert hashlib.sha256(Path(r['releaseEvidenceFile']).read_bytes()).hexdigest()==r['releaseEvidenceSha256']
  # KTB uses its KTB abbreviation; other issuers use the full corporate name.
  identity=flat(' '.join(p['text'] for p in ps[:10]))
  assert any(n in identity for n in {'KBANK':['kasikornbank'],'BBL':['bangkokbank'],'KTB':['krungthai','ktb'],'TTB':['tmb','ttb'],'KKP':['kiatnakin'],'TISCO':['tiscofinancialgroup'],'SCB':['scbx']}[s]),(s,y,'issuer')
  fromday=(datetime.date.fromisoformat(r['publishedAt'])+datetime.timedelta(days=1)).isoformat();metrics={};omissions={}
  for j,(key,v) in enumerate(zip(keys,vs)):
   if v is None:
    omissions[key]='No explicitly reported consolidated coverage ratio verified in this annual MD&A; ECL amounts are not silently converted into a reported ratio.';continue
   p=pages[s][i][j];text=ps[p-1]['text'];scope='consolidated';status='reported';definition='Issuer-reported year-end current-year ratio; use the source definition and accounting regime for this fiscal year, not a later comparative.'
   if key=='capitalAdequacy':
    if s=='KBANK':scope='financial-conglomerate'
    if s in ['KTB','SCB']:scope='regulatory-group'
    if s=='KTB' and y>=2018:status='reported-preliminary'
    if s=='TTB' and y<=2019:scope='bank-only'
    if s=='TISCO':
     scope='bank-only' if y<=2019 else 'regulatory-group'
     if y==2024:status='projected'
    if s=='KKP' and y<=2019:scope='unresolved-regulatory-scope'
   elif s=='KKP':
    scope='commercial-banking-portfolio'
    definition='Issuer-reported banking portfolio '+('gross NPL ratio, including POCI from TFRS9 adoption in 2020.' if key=='npl' else 'coverage ratio; from 2020 the disclosed NPL denominator excludes POCI. This is not silently rebased to match the separate gross NPL ratio.')
   elif s=='TISCO':scope='group-loan-portfolio'
   decimals=2 if s in ['KBANK','KTB'] else (0 if s=='TTB' and key=='nplCoverage' else 1)
   if key=='capitalAdequacy' and s in ['BBL','KKP']:decimals=2
   if s=='KTB' and key=='nplCoverage' and y>=2020:decimals=1
   if s=='TTB' and key=='npl':decimals=2
   if s=='TISCO':decimals=(2 if key=='npl' and y!=2021 or key=='capitalAdequacy' and (y<=2019 or y==2023) else 1)
   if s=='SCB' and key=='npl':decimals=2
   anchor=anchor_for(text,v,key,s,y)
   metrics[key]={'value':v/100,'reportedPercent':v,'reportedDecimals':decimals,'status':status,'scope':scope,'definition':definition,'asOf':f'{y}-12-31',
    'source':r['source'],'publishedAt':r['publishedAt'],'availableFrom':fromday,'historicalAvailableFrom':fromday,'availabilityBasis':'sec-mda-announcement-next-day',
    'listingSource':r['listingSource'],'releaseEvidenceFile':r['releaseEvidenceFile'],'releaseEvidenceSha256':r['releaseEvidenceSha256'],
    'evidenceFile':r['path'],'sha256':r['sha256'],'pdfPage':p,'anchor':anchor,'observedAt':r['observedAt'],'earliestPublicationVerified':False}
  rows.append({'symbol':'SET:'+s,'fiscalYear':y,'asOf':f'{y}-12-31','assessmentProfile':'group-capital-and-reported-banking-portfolio' if s=='KKP' else 'group','metrics':metrics,'omissions':omissions,'reviewedAt':now,'reviewMethod':'explicit-current-year-columns; issuer-period-scope; latest-captured-release-conservative-date'})
Path('data/bank-risk-history-reviewed.json').write_text(json.dumps({'version':1,'checkedAt':now,'rows':rows},ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
current=json.loads(Path('data/bank-risk.json').read_text(encoding='utf-8'));current['rows']=[r for r in current['rows'] if r['fiscalYear']==2025]+rows
current['description']='Reviewed FY2016–2025 annual bank risk disclosures (SCBX from 2022). Bank-only, unresolved scopes, projected values and absent metrics cannot qualify. Dates use latest reviewed SEC MD&A releases plus one day; TISCO FY2025 final capital retains observation-based availability.'
Path('data/bank-risk.json').write_text(json.dumps(current,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print('Promoted',len(rows),'historical issuer-years;',sum(len(r['metrics']) for r in rows),'source metrics')
