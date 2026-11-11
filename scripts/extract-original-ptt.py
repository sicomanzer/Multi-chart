"""Extract explicitly reviewed cells; never guess a workbook layout or units."""
import hashlib, json
from pathlib import Path
from openpyxl import load_workbook

base=Path('data/statement-evidence')
dates=json.loads(Path('data/filing-dates.json').read_text(encoding='utf-8'))['entries']
history=json.loads(Path('data/annual-history.json').read_text(encoding='utf-8'))['symbols']['PTT']['years']
layouts={
 2016: {'assets':('BS-Assets Consol','H46'),'openingAssets':('BS-Assets Consol','J46'),'totalDebt':('BS-Liability Consol','H39'),'equity':('BS-Equity Consol','I28'),'openingEquity':('BS-Equity Consol','K28'),'totalEquity':('BS-Equity Consol','I30'),'revenue':('PL_Accum','G13'),'netIncome':('Cash flow','I13'),'operatingCashFlow':('Cash flow','I75'),'ebit':('PL_Accum','G28'),'reportedEps':('PL_Accum','G50')},
 2017: {'assets':('BS-Assets Consol','H44'),'openingAssets':('BS-Assets Consol','J44'),'totalDebt':('BS-Liability Consol','H38'),'equity':('BS-Equity Consol','I30'),'openingEquity':('BS-Equity Consol','K30'),'totalEquity':('BS-Equity Consol','I32'),'revenue':('PL_Accum','G13'),'netIncome':('Cash flow','I13'),'operatingCashFlow':('Cash flow','I76'),'ebit':('PL_Accum','G25'),'reportedEps':('PL_Accum','G47')},
 2018: {'assets':('BS-Assets Consol','H43'),'openingAssets':('BS-Assets Consol','J43'),'totalDebt':('BS-Liability Consol','H37'),'equity':('BS-Equity Consol','I31'),'openingEquity':('BS-Equity Consol','K31'),'totalEquity':('BS-Equity Consol','I33'),'revenue':('PL_Accum','G13'),'netIncome':('Cash flow','I13'),'operatingCashFlow':('Cash flow','I76'),'ebit':('PL_Accum','G25'),'reportedEps':('PL_Accum','G47')},
}
files={2016:'201702/17011197',2017:'201802/18012989',2018:'201902/19015405'}
versions=[]; comparisons=[]
for year,layout in layouts.items():
 path=base/f'PTT-{year}-statements.xlsx';w=load_workbook(path,data_only=True)
 assert 'Consolidated financial statements' in [c.value for row in w['PL_Accum'] for c in row]
 assert w['PL_Accum']['G10'].value==year
 assert 'Unit: Baht' in [c.value for row in w['PL_Accum'] for c in row]
 fields={k:w[s][c].value for k,(s,c) in layout.items()}
 assert all(isinstance(v,(int,float)) for v in fields.values()), fields
 assert abs(fields['assets']-fields['totalDebt']-fields['totalEquity'])<1
 date=next(r for r in dates if r['symbol']=='SET:PTT' and r['fiscalYear']==year)
 versions.append({'symbol':'SET:PTT','fiscalYear':year,'asOf':f'{year}-12-31','availableFrom':date['availableFrom'],
  'availabilitySource':date['listingSource'],'availabilityBasis':'conservative-annual-report-receipt-next-day',
  'source':f'https://market.sec.or.th/public/idisc/Download?FILEID=dat/news/{files[year]}.zip',
  'evidenceFile':str(path).replace('\\','/'),'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),
  'reviewed':True,'scope':'audited-consolidated-current-year','earliestVersionVerified':False,
  'perShareBasisVerified':False,'unit':'THB','fields':fields,
  'cells':{k:{'sheet':s,'cell':c} for k,(s,c) in layout.items()}})
 old=next(r for r in history if r['y']==year)
 for field,key in [('netIncome','np'),('revenue','rev'),('assets','asset'),('equity','equity'),('operatingCashFlow','cfo'),('reportedEps','eps')]:
  comparisons.append({'fiscalYear':year,'field':field,'provider':old[key],'original':fields[field],'difference':fields[field]-old[key],
   'note':'EPS is not comparable until share basis/corporate actions are reconciled' if field=='reportedEps' else 'Original THB versus provider THB; small differences may be rounding'})
Path('data/statement-versions.json').write_text(json.dumps({'version':1,'description':'Reviewed official historical statement snapshots. Availability is conservative, earliest filing version is not certified. No current-provider fallback in original mode.','versions':versions},indent=2)+'\n',encoding='utf-8')
(base/'PTT-comparison.json').write_text(json.dumps(comparisons,indent=2)+'\n',encoding='utf-8')
print(json.dumps({'reviewedVersions':len(versions),'comparisons':comparisons},indent=2))
