/** Read-only optional company context imported locally by the laptop operator.
 * No D1 API credentials or full company dictionary are checked into public Git.
 */
import {readFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const localFile=resolve(dirname(fileURLToPath(import.meta.url)),'..','local-data','d1-company-context.json');
function host(raw){try{return new URL(String(raw).includes('://')?String(raw):'https://'+raw)
  .hostname.toLowerCase().replace(/^www\./,'');}catch{return null;}}
export async function loadD1CompanyContext({companyUrl,filename=process.env.PI_D1_CONTEXT_FILE||localFile}={}){
 const domain=host(companyUrl);if(!domain)return null;
 let data;
 try{const raw=await readFile(filename,'utf8');if(raw.length>500000)throw Error('D1 local context >500KB; export a bounded company subset');data=JSON.parse(raw);}
 catch(e){if(e?.code==='ENOENT')return null;throw e;}
 const rows=Array.isArray(data)?data:Array.isArray(data?.companies)?data.companies:
   Array.isArray(data?.records)?data.records:[data];
 return rows.find(r=>r&&host(r.website)===domain)||null;
}