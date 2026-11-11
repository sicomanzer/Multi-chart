"""Explicitly reviewed FY2025 PDF columns; percentage points -> fractions."""
import json,hashlib,re,datetime
from pathlib import Path
base=Path('data/bank-risk-evidence')
mda={r['symbol']:r for r in json.loads(Path('data/bank-mda-source-manifest.json').read_text(encoding='utf-8'))['records']}
sources={r['name']:r for r in json.loads(Path('data/bank-risk-source-manifest.json').read_text(encoding='utf-8'))['records'] if 'error' not in r}
now=datetime.datetime.now(datetime.timezone.utc).isoformat()
today=datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=7))).date().isoformat()
previous={}
if Path('data/bank-risk.json').exists():
 previous={r['symbol']:r for r in json.loads(Path('data/bank-risk.json').read_text(encoding='utf-8'))['rows'] if r['fiscalYear']==2025}
tomorrow=(datetime.date.fromisoformat(today)+datetime.timedelta(days=1)).isoformat()
precision={s:dict(zip(['capitalAdequacy','npl','nplCoverage'],p)) for s,p in {
 'KBANK':[2,2,2],'BBL':[2,1,1],'KTB':[2,2,1],'TTB':[1,2,0],
 'KKP':[2,1,1],'TISCO':[1,2,1],'SCB':[1,2,1]}.items()}
def metric(symbol,key,value,page,anchor,scope='consolidated',status='reported',definition=''):
 rec=mda[symbol];path=Path(rec['path']);pages=json.loads(path.with_suffix('.pages.json').read_text(encoding='utf-8'))
 text=re.sub(r'\s+',' ',pages[page-1]['text']).strip()
 assert re.sub(r'\s+','',anchor).lower() in re.sub(r'\s+','',text).lower(),(symbol,key,'Missing reviewed anchor')
 assert any(v in re.sub(r'\s+','',text) for v in [str(value),f'{value:.2f}',f'{value:g}']),(symbol,key,'Missing value')
 available=(datetime.date.fromisoformat(rec['publishedAt'])+datetime.timedelta(days=1)).isoformat()
 release=base/f'{symbol}-mda-register.html'
 return {'value':value/100,'reportedPercent':value,'reportedDecimals':precision[symbol][key],'status':status,'scope':scope,'definition':definition,
  'asOf':'2025-12-31','source':rec['source'],'publishedAt':rec['publishedAt'],'availableFrom':available,
  'historicalAvailableFrom':available,'availabilityBasis':'sec-mda-announcement-next-day','listingSource':rec['listingSource'],
  'releaseEvidenceFile':str(release).replace('\\','/'),'releaseEvidenceSha256':hashlib.sha256(release.read_bytes()).hexdigest(),
  'evidenceFile':rec['path'],'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'pdfPage':page,'anchor':anchor,
  'evidenceTextFile':str(path.with_suffix('.pages.json')).replace('\\','/'),'observedAt':now,'earliestPublicationVerified':False}

rows=[]
def add(s,metrics):rows.append({'symbol':'SET:'+s,'fiscalYear':2025,'asOf':'2025-12-31','assessmentProfile':'group-capital-and-reported-banking-portfolio' if s=='KKP' else 'group','metrics':metrics,'reviewedAt':now})
add('KBANK',{
 'capitalAdequacy':metric('KBANK','capitalAdequacy',20.35,61,'Capital Adequacy Ratio 12.00 20.35',scope='financial-conglomerate',definition='KASIKORNBANK FINANCIAL CONGLOMERATE; capital base excludes unapproved period profit as disclosed'),
 'npl':metric('KBANK','npl',3.20,48,'NPLs gross6) to total loans7) 3.20',definition='Gross credit-impaired loans to customers and financial institutions; excludes accrued/undue interest as defined in note 6/7'),
 'nplCoverage':metric('KBANK','nplCoverage',162.75,48,'(Coverage ratio) 162.75',definition='Total ECL including disclosed commitments, financial guarantees, financial institutions, investments and other financial assets / gross NPL'),
})
add('BBL',{
 'capitalAdequacy':metric('BBL','capitalAdequacy',21.78,19,'Total capital 653,040 21.78%',definition='Consolidated total capital / risk-weighted assets'),
 'npl':metric('BBL','npl',3.0,16,'Gross NPL to total loans ratio /1 3.0%',definition='Gross NPL / total loans, including interbank and money-market lending'),
 'nplCoverage':metric('BBL','nplCoverage',324.1,16,'Allowance for expected credit losses to NPL ratio /1 324.1%',definition='Reported consolidated ECL / gross NPL; includes disclosed interbank/money market and commitments/guarantees'),
})
add('KTB',{
 'capitalAdequacy':metric('KTB','capitalAdequacy',22.12,18,'22.12% of its RWA',scope='regulatory-group',status='reported-preliminary',definition='Financial Business Group; notes describe FY2025 regulatory capital data as preliminary; not the bank-only 21.32%'),
 'npl':metric('KTB','npl',2.90,14,'NPL Ratio 2.90%',definition='Principal less deferred revenue, including interbank and money-market items'),
 'nplCoverage':metric('KTB','nplCoverage',203.6,14,'Coverage Ratio (3) 203.6%',definition='Reported ECL including interbank, loans, commitments and guarantees / NPL'),
})
add('TTB',{
 'capitalAdequacy':metric('TTB','capitalAdequacy',19.5,21,'Capital Adequacy Ratio (CAR) 19.5%',definition='Consolidated Basel III total capital ratio, rounded to one decimal in MD&A'),
 'npl':metric('TTB','npl',2.87,19,'NPL ratio stood at 2.8 7%',definition='Consolidated Stage 3/NPL ratio excluding accrued interest receivables'),
 'nplCoverage':metric('TTB','nplCoverage',152.0,19,'coverage ratio stood at 152%',definition='Consolidated ECL / NPL, reported rounded percentage'),
})
add('KKP',{
 'capitalAdequacy':metric('KKP','capitalAdequacy',17.36,9,'was at 17.36%',definition='Consolidated Basel III ratio, excluding not-yet-incorporated FY2025 profit; not bank-only 16.43% or hypothetical 18.58%'),
 'npl':metric('KKP','npl',4.4,12,'Total NPLs 15,133 4.4',scope='commercial-banking-portfolio',definition='KKP disclosed banking-loan portfolio including POCI, cross-checked against its official financial highlights. Used only under the explicit banking-portfolio assessment profile, not labelled an accounting-consolidated IFRS Stage 3 ratio'),
 'nplCoverage':metric('KKP','nplCoverage',137.2,11,'increased to 137.2%',scope='commercial-banking-portfolio',definition='KKP issuer-reported banking-portfolio coverage, cross-checked against official financial highlights. The published ratio uses an NPL basis excluding POCI; the 4.4% NPL ratio includes POCI. Kept as two separately defined published metrics; no silent rebasing or claim of a common IFRS denominator'),
})
tisco_cap=metric('TISCO','capitalAdequacy',19.0,16,'BIS Ratio 19.0',scope='regulatory-group',status='projected',definition='Superseded for current scoring by audited annual-report financial-note ratio 18.97%; this MD&A table explicitly labels projected figures')
ar=sources['TISCO-2025-ar'];p=Path(ar['path']);text=json.loads(p.with_suffix('.pages.json').read_text(encoding='utf-8'))[318]['text']
assert '18.97' in text and 'Financial' in text and 'Business' in text
tisco_cap.update({'value':.1897,'reportedPercent':18.97,'reportedDecimals':2,'status':'reported','definition':'Financial Business Group total capital / risk assets in annual-report financial notes; excludes the projected MD&A 19.0% and standalone TISCO Bank 20.53%',
 'source':ar['source'],'publishedAt':None,'availableFrom':today,'historicalAvailableFrom':tomorrow,
 'availabilityBasis':'first-observed-official-document','listingSource':None,'evidenceFile':ar['path'],'sha256':ar['sha256'],'pdfPage':319,
 'releaseEvidenceFile':None,'releaseEvidenceSha256':None,
 'anchor':'Total capital to risk assets 18.97','evidenceTextFile':str(p.with_suffix('.pages.json')).replace('\\','/'),
 'dateNote':'Exact release date of this IR PDF is not independently confirmed. Live use begins on observation date; historical use begins next day. The unavailable SEC annual archive is not used to backdate this PDF.'})
old_cap=previous.get('SET:TISCO',{}).get('metrics',{}).get('capitalAdequacy',{})
if old_cap.get('sha256')==tisco_cap['sha256'] and old_cap.get('availabilityBasis')=='first-observed-official-document':
 for key in ['observedAt','availableFrom','historicalAvailableFrom']:tisco_cap[key]=old_cap[key]
tisco_cap['rejectedAlternative']={'reportedPercent':19.0,'status':'projected','source':mda['TISCO']['source'],'pdfPage':16}
add('TISCO',{
 'capitalAdequacy':tisco_cap,
 'npl':metric('TISCO','npl',2.28,12,'NPL ratio of 2.28%',scope='group-loan-portfolio',definition='TISCO Group NPL / loans excluding accrued interest under BOT guideline'),
 'nplCoverage':metric('TISCO','nplCoverage',172.1,12,'coverage ratio was at 172.1%',scope='group-loan-portfolio',definition='TISCO Group expected credit loss allowance / NPL'),
})
add('SCB',{
 'capitalAdequacy':metric('SCB','capitalAdequacy',18.9,19,'Capital Adequacy Ratio 18.9%',scope='regulatory-group',definition='SCBX Financial Group consolidated regulatory ratio; not SCB Bank-only 19.0%'),
 'npl':metric('SCB','npl',3.29,20,'NPL ratio 3.29%',definition='SCBX consolidated NPL ratio; not SCB Bank-only 3.12% or a product-level ratio'),
 'nplCoverage':metric('SCB','nplCoverage',160.8,20,'(Coverage ratio) 160.8%',definition='SCBX consolidated allowance including interbank, commitments and guarantees / NPL'),
})
history=Path('data/bank-risk-history-reviewed.json')
if history.exists():rows+=json.loads(history.read_text(encoding='utf-8'))['rows']
Path('data/bank-risk.json').write_text(json.dumps({'version':1,'checkedAt':now,'description':'Reviewed annual bank risk metrics. Scope and status are per metric; unresolved scopes and projected values are not eligible for model scoring. TISCO FY2025 final-note capital has observation-based availability only. No current data is copied into earlier backtests.','rows':rows},ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print('Wrote 7 issuer-years / 21 reported metrics; KKP uses explicit disclosed banking-portfolio profile')
