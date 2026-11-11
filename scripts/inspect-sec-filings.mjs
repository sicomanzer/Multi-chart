import {readFile} from 'node:fs/promises';
const s=await readFile('sec-filing-source.html','utf8');
const table=[...s.matchAll(/<table\b[^>]*>[\s\S]*?<\/table>/g)].find(m=>m[0].includes('id="gPP06T02"'))?.[0];
console.log(table?.slice(0,5000));
console.log([...s.matchAll(/href=["']([^"']*ViewMore[^"']*)["']/g)].map(m=>m[1]).join('\n'));
