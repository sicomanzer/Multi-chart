import re,math
from openpyxl.utils import column_index_from_string,get_column_letter

norm=lambda s:re.sub(r'\s+',' ',str(s)).strip().lower()
num=lambda x:isinstance(x,(int,float)) and not isinstance(x,bool) and math.isfinite(x)

def label(row,col):
 return norm(' '.join(str(v) for c,v in row.items() if column_index_from_string(re.sub(r'\d','',c))<column_index_from_string(col) and isinstance(v,str) and re.search('[a-zA-Z]',v)))

def header(sheet,year,baht=False):
 rows=sheet['rows'];col=None;factor=1
 if baht:
  for row in rows[:18]:
   for cell,v in row.items():
    if re.search(r'unit\s*:\s*(?:thousand(?: thai)? )?baht',norm(v)):
     col=re.sub(r'\d','',cell);factor=1000 if 'thousand' in norm(v) else 1;break
   if col:break
 else:
  for row in rows[:18]:
   for cell,v in row.items():
    if norm(v).startswith('consolidated'):col=re.sub(r'\d','',cell);break
   if col:break
 assert col, f'No consolidated/THB column in {sheet["name"]}'
 texts=' '.join(str(v) for r in rows[:20] for v in r.values())
 assert re.search(r'\bbaht\b',texts,re.I), 'No baht unit'
 assert not (not baht and re.search('thousand|million|US Dollar',texts,re.I)), 'Non-baht scale requires explicit mapping'
 # The selected data column must carry the current fiscal year itself.
 assert any(str(year) in str(r.get(f'{col}'+re.sub(r'\D','',next(iter(r))),'')) for r in rows[:20]),f'No {year} header in {col}'
 return col,get_column_letter(column_index_from_string(col)+2),factor

def field(sheet,pattern,col,scale=1,allow_continuation=True,limit=None):
 rows=sheet['rows'][:limit];matches=[]
 for i,row in enumerate(rows):
  if not re.search(pattern,label(row,col),re.I):continue
  for j in range(i,min(i+4 if allow_continuation else i+1,len(rows))):
   nr=rows[j];cell=f'{col}'+re.sub(r'\D','',next(iter(nr)));v=nr.get(cell)
   if num(v):
    matches.append((v*scale,{'sheet':sheet['name'],'cell':cell,'scale':scale,'label':label(row,col)}));break
 assert matches,f'No field {pattern} in {sheet["name"]}'
 return matches[0]

def profit(sheet,col,scale):
 rows=sheet['rows']
 for i,row in enumerate(rows):
  if not re.search(r'^(?:total shareholders. equity attributable|(?:total )?equity attributable|owners of (?:the )?(?:parent|company)|equity holders of the company)',label(row,col)):continue
  if 'equity attributable' in label(row,col):continue
  cell=f'{col}'+re.sub(r'\D','',next(iter(row)))
  if num(row.get(cell)):return row[cell]*scale,{'sheet':sheet['name'],'cell':cell,'scale':scale,'label':label(row,col)}
  # Older PTT reports split continuing/discontinued operations, then print a total.
  for nr in rows[i+1:i+6]:
   cell=f'{col}'+re.sub(r'\D','',next(iter(nr)))
   if not label(nr,col) and num(nr.get(cell)):return nr[cell]*scale,{'sheet':sheet['name'],'cell':cell,'scale':scale,'label':'Owner-attributable total after continuing/discontinued operations'}
 raise AssertionError('No owner-attributable profit')
