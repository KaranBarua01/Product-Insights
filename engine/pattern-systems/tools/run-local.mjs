#!/usr/bin/env node
import {readFile,writeFile} from 'node:fs/promises';
import {inspectWebsite} from '../dist/inspect.js';
import {normalizeResults,exportMatrixCsv} from '../dist/patterns.js';
const file=process.argv[2],out=process.argv[3]??'pattern-results';
if(!file){console.error('Usage: npm run build && node tools/run-local.mjs sites.csv [output-prefix]');process.exit(2);}
const contents=await readFile(file,'utf8');
function splitCsv(text){
 const rows=[];let row=[],cell='',quote=false;
 for(let i=0;i<text.length;i++){
  const ch=text[i];if(ch==='"'&&quote&&text[i+1]==='"'){cell+='"';i++;}else if(ch==='"'){quote=!quote;}else if(ch===','&&!quote){row.push(cell);cell='';}else if((ch==='\n'||ch==='\r')&&!quote){if(ch==='\r'&&text[i+1]==='\n')i++;row.push(cell);if(row.some(x=>x.trim()))rows.push(row);row=[];cell='';}else cell+=ch;
 }
 if(cell||row.length){row.push(cell);rows.push(row);}return rows;
}
const lines=splitCsv(contents);
const header=lines[0]?.map(s=>s.toLowerCase().trim())??[];
const urlColumn=header.findIndex(s=>['url','website','domain','website_url'].includes(s));
const nameColumn=header.findIndex(s=>['company','name','company_name'].includes(s));
const rows=urlColumn<0?lines:lines.slice(1);
const entries=rows.map(r=>({url:(r[urlColumn<0?0:urlColumn]??'').trim(),companyName:nameColumn<0?undefined:(r[nameColumn]??'').trim()}));
const results=[];
for(const [i,x] of entries.entries()){
 if(!/^https?:\/\//i.test(x.url)){console.warn(`Skipping row ${i+1}: no absolute URL`);continue;}
 try{const r=await inspectWebsite(x.url,{companyName:x.companyName,maxPages:3});results.push(r);console.log(`${i+1}/${entries.length}: ${r.host} (${r.status}; ${r.pages.length} pages)`);}catch(e){console.warn(`${i+1}: ${String(e)}`);}
}
await writeFile(`${out}.json`,JSON.stringify({runs:results,report:normalizeResults(results)},null,2));
await writeFile(`${out}.csv`,exportMatrixCsv(results));
console.log(`Wrote ${out}.json and ${out}.csv`);
