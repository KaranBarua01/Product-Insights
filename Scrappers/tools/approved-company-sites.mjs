/** Explicit, laptop-operator-approved public company domains.
 * Stored only under gitignored Scrappers/local-data. Never approve from Cloudflare.
 */
import {readFile,writeFile,rename,mkdir,rm} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes} from 'node:crypto';
import {validatePublicCompanyUrl,normalizeApprovedCompanyHosts} from '../../live-lab/src/protocol.js';
import {assertPublicDns} from './research-lab-security.mjs';

export const COMPANY_APPROVALS_SCHEMA='pi-lab-approved-company-hosts/v1';
export const DEFAULT_COMPANY_APPROVALS_PATH=resolve(dirname(fileURLToPath(import.meta.url)),
 '..','local-data','approved-company-websites.json');
const trimmed=x=>String(x||'').trim();
export async function readApprovedCompanies({filePath=DEFAULT_COMPANY_APPROVALS_PATH}={}){
 let raw;
 try{raw=await readFile(filePath,'utf8');}
 catch(e){if(e?.code==='ENOENT')return {schemaVersion:COMPANY_APPROVALS_SCHEMA,hosts:[],modifiedAt:null};throw e;}
 if(raw.length>16000)throw Error('Public company approval list is too large');
 const data=JSON.parse(raw);
 if(data?.schemaVersion!==COMPANY_APPROVALS_SCHEMA)
   throw Error('Public company approval list schema mismatch');
 const hosts=normalizeApprovedCompanyHosts(data.hosts);
 return {schemaVersion:COMPANY_APPROVALS_SCHEMA,hosts,
   modifiedAt:typeof data.modifiedAt==='string'?data.modifiedAt:null};
}
async function store(data,filePath){
 await mkdir(dirname(filePath),{recursive:true,mode:0o700});
 const temp=filePath+'.'+randomBytes(8).toString('hex')+'.tmp';
 try{await writeFile(temp,JSON.stringify(data,null,2),'utf8');await rename(temp,filePath);}
 finally{await rm(temp,{force:true}).catch(()=>{});}
}
export async function approveCompanyUrl(url,{filePath=DEFAULT_COMPANY_APPROVALS_PATH,
 dnsCheck=assertPublicDns}={}){
 const {host}=validatePublicCompanyUrl(url);
 const actualHostname=new URL(url).hostname;
 // Public DNS is checked at approval time AND again before research in Research Lab.
 const addresses=await dnsCheck(actualHostname);
 const current=await readApprovedCompanies({filePath});
 const hosts=normalizeApprovedCompanyHosts([...current.hosts,host]);
 const added=!current.hosts.includes(host);
 if(added)await store({schemaVersion:COMPANY_APPROVALS_SCHEMA,
   hosts,modifiedAt:new Date().toISOString()},filePath);
 return {added,host,hosts,publicAddressCount:Array.isArray(addresses)?addresses.length:0};
}
export async function revokeCompanyHost(name,{filePath=DEFAULT_COMPANY_APPROVALS_PATH}={}){
 const input=trimmed(name);
 const {host}=validatePublicCompanyUrl(input.startsWith('https://')?input:'https://'+input);
 const current=await readApprovedCompanies({filePath});
 const hosts=current.hosts.filter(h=>h!==host);
 const removed=hosts.length!==current.hosts.length;
 if(removed)await store({schemaVersion:COMPANY_APPROVALS_SCHEMA,
   hosts,modifiedAt:new Date().toISOString()},filePath);
 return {host,removed,hosts};
}
