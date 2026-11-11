import {readFile,writeFile,access,stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {archiveObservation} from './statement-archive-observation.mjs';
const symbols=process.argv.includes('--banks') ? ['KBANK','BBL','KTB','TTB','KKP','TISCO','SCB'] : ['PTT','ADVANC','HMPRO','KCE','BCP','MINT','PTTEP'];
const files=[];
let previousFiles=[];
try{previousFiles=JSON.parse(await readFile('data/statement-archive-manifest.json','utf8')).files;}catch{}
for(const symbol of symbols){
 let register;try{register=JSON.parse(await readFile(`data/statement-registers/${symbol}.json`,'utf8'));}catch{continue;}
 for(const row of register.records){
  if(!row.source.includes('FILEID=')||row.status!=='Audited')continue;
  const tag=createHash('sha256').update(row.source).digest('hex').slice(0,12);
  const previous=previousFiles.find(r=>r.source===row.source&&r.sha256);
  let path=previous?.path??`data/statement-evidence/${symbol}-${row.fiscalYear}-${tag}.zip`;
  try{
   let cached=false;try{await access(path);cached=true;}catch{}
   if(!cached||process.argv.includes('--refresh')){
    const response=await fetch(row.source,{signal:AbortSignal.timeout(60000)});
    if(!response.ok)throw Error('HTTP '+response.status);
    const buffer=Buffer.from(await response.arrayBuffer());
    if(buffer[0]!==80||buffer[1]!==75)throw Error('Not a ZIP archive');
    const hash=createHash('sha256').update(buffer).digest('hex');
    if(cached&&hash!==(previous?.sha256??createHash('sha256').update(await readFile(path)).digest('hex'))){
      path=`data/statement-evidence/${symbol}-${row.fiscalYear}-${tag}-${hash.slice(0,12)}.zip`;
    }
    await writeFile(path,buffer);
   }
   const bytes=await readFile(path);
   const sha256=createHash('sha256').update(bytes).digest('hex');
   const observedAt=(!cached||process.argv.includes('--refresh'))?new Date().toISOString():(await stat(path)).mtime.toISOString();
   files.push({...row,path,sha256,...archiveObservation(previous,sha256,observedAt)});
   console.log(symbol,row.fiscalYear,bytes.length);
  }catch(error){files.push({...row,error:error.message});console.log(symbol,row.fiscalYear,error.message);}
 }
}
await writeFile('data/statement-archive-manifest.json',JSON.stringify({files:[...previousFiles.filter(r=>!symbols.includes(r.symbol?.slice(4))),...files]},null,2)+'\n');
