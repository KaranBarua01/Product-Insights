/**
 * Product Insights - provider-neutral, GitHub-pinned local update engine.
 * It never executes shell from a GitHub job, never deploys to Cloudflare,
 * and never reads/writes the data/, results/, runtime/, or credentials trees.
 * Staging is online. Activation and rollback require localhost to be stopped.
 */
import {createHash,randomUUID} from 'node:crypto';
import {readFile,writeFile,mkdir,rm,lstat,rename,copyFile,open} from 'node:fs/promises';
import {resolve,join,dirname,relative,sep} from 'node:path';

export const REPO='KaranBarua01/Product-Insights';
export const STABLE_CHANNEL='https://raw.githubusercontent.com/'+REPO+'/main/local/unified-lab/channels/stable.json';
const SOURCE_ROOT='local/unified-lab/';
const SCHEMA='pi-local-update/v1';
const HASH=/^[0-9a-f]{64}$/;
const SHA=/^[0-9a-f]{40}$/;
const ID=/^[a-z0-9][a-z0-9._-]{0,47}$/;
const TOP=/^(?:app|benchmark|engine|tests|updater)\//;
const ROOT_FILES=new Set(['start.mjs','start.ps1','runtime-smoke.mjs','verify-runtime.mjs','START_LOCALHOST.bat','START_WITH_AGENT.bat','START_UPDATED_TEST.bat','RUN_REGRESSION_TESTS.bat','README.txt','VALIDATION.txt']);
const DENIED=new Set(['data','results','runtime','local-data','node_modules','.git','.github','.env','secrets','credentials']);
const SAFE_EXT=/\.(?:mjs|js|json|css|html|txt|ps1|bat|md)$/i;
const MAX_FILES=80,MAX_TOTAL=6_000_000,MAX_FILE=500_000;
const digest=x=>createHash('sha256').update(x).digest('hex');
const isWithin=(root,path)=>path===root||path.startsWith(root+sep);
const installedFile=root=>join(root,'local-data','pi-updates','installed.json');
const updateRoot=root=>join(root,'local-data','pi-updates');

function cleanPath(path){
 if(typeof path!=='string'||path.length>180||path.startsWith('/')||path.includes('\\')||path.includes(':')||path.includes('%')||path.includes('//'))throw Error('Invalid update file path');
 const parts=path.split('/');
 if(parts.some(p=>!p||p==='.'||p==='..'||p.startsWith('.')||DENIED.has(p.toLowerCase())))throw Error('Prohibited update path');
 if(!TOP.test(path)&&!ROOT_FILES.has(path))throw Error('File outside source allowlist');
 if(!SAFE_EXT.test(path))throw Error('Unsupported file extension');
 return path;
}
export function validateManifest(x){
 if(!x||typeof x!=='object'||Array.isArray(x))throw Error('Release manifest must be an object');
 const keys=Object.keys(x).sort().join(',');
 if(keys!==['channel','files','minNode','releaseId','schemaVersion','sourceCommit','sourceRepo'].sort().join(','))throw Error('Unexpected release manifest fields');
 if(x.schemaVersion!==SCHEMA||x.channel!=='stable'||x.sourceRepo!==REPO||!SHA.test(x.sourceCommit)||!ID.test(x.releaseId))throw Error('Invalid release identity');
 if(x.minNode!==24||!Array.isArray(x.files)||!x.files.length||x.files.length>MAX_FILES)throw Error('Invalid release constraints');
 let total=0;const names=new Set();
 const files=x.files.map(f=>{
  if(!f||typeof f!=='object'||Array.isArray(f)||Object.keys(f).sort().join(',')!==['bytes','fromSha256','path','sha256'].sort().join(','))throw Error('Unexpected file fields');
  const path=cleanPath(f.path);
  if(names.has(path))throw Error('Duplicate update file');names.add(path);
  if(!Number.isInteger(f.bytes)||f.bytes<0||f.bytes>MAX_FILE||!HASH.test(f.sha256)||!(f.fromSha256===null||HASH.test(f.fromSha256)))throw Error('Invalid file hash or size');
  total+=f.bytes;
  return {path,bytes:f.bytes,sha256:f.sha256,fromSha256:f.fromSha256};
 });
 if(total>MAX_TOTAL)throw Error('Update too large');
 return {...x,files};
}
async function optionalRead(path){try{return await readFile(path)}catch(e){if(e.code==='ENOENT')return null;throw e}}
async function readJson(path){const b=await optionalRead(path);return b?JSON.parse(b.toString('utf8')):null}
async function safeTarget(root,rel){
 const base=resolve(root),path=resolve(base,rel);
 if(!isWithin(base,path)||path===base)throw Error('Update target outside app root');
 let cursor=base;
 for(const part of rel.split('/')){
  cursor=join(cursor,part);
  try{const s=await lstat(cursor);if(s.isSymbolicLink()||(!s.isDirectory()&&cursor!==path))throw Error('Symbolic link or invalid path in update tree');}
  catch(e){if(e.code!=='ENOENT')throw e}
 }
 return path;
}
async function atomicWrite(path,bytes){
 await mkdir(dirname(path),{recursive:true});
 const tmp=path+'.pi-new-'+randomUUID();
 try{await writeFile(tmp,bytes,{flag:'wx'});await rename(tmp,path)}
 finally{await rm(tmp,{force:true}).catch(()=>{})}
}
async function exclusive(root,fn){
 const dir=updateRoot(root);await safeTarget(root,'local-data');await safeTarget(root,'local-data/pi-updates');
 await mkdir(dir,{recursive:true});const lock=join(dir,'operation.lock');
 let handle;try{handle=await open(lock,'wx')}catch(e){if(e.code==='EEXIST')throw Error('Another update operation is active');throw e}
 try{return await fn()}finally{await handle.close();await rm(lock,{force:true})}
}
async function guardedGet(url,fetcher=fetch,max=MAX_FILE){
 const u=new URL(url);
 if(u.protocol!=='https:'||u.hostname!=='raw.githubusercontent.com'||u.username||u.password||u.port||u.hash||u.search)throw Error('Untrusted update source');
 const response=await fetcher(u.href,{method:'GET',redirect:'error',signal:AbortSignal.timeout(15000),headers:{Accept:'application/octet-stream'}});
 if(response.status!==200)throw Error('Update fetch HTTP '+response.status);
 if(Number(response.headers?.get('content-length')||0)>max)throw Error('Update response too large');
 const chunks=[];let count=0;
 if(!response.body)throw Error('Missing update body');
 for await(const chunk of response.body){count+=chunk.byteLength;if(count>max)throw Error('Update size limit exceeded');chunks.push(Buffer.from(chunk))}
 return Buffer.concat(chunks,count);
}
export async function fetchStable(fetcher=fetch){
 const bytes=await guardedGet(STABLE_CHANNEL,fetcher,100_000);
 return validateManifest(JSON.parse(bytes.toString('utf8')));
}
export function sourceUrl(m,f){
 const manifest=validateManifest(m),file=manifest.files.find(x=>x.path===f);
 if(!file)throw Error('File absent from approved manifest');
 return 'https://raw.githubusercontent.com/'+REPO+'/'+manifest.sourceCommit+'/'+SOURCE_ROOT+file.path;
}
export async function status(root){
 const base=resolve(root),updates=updateRoot(base);
 return {installed:await readJson(installedFile(base)),staged:await readJson(join(updates,'staged.json')),journal:await readJson(join(updates,'journal.json'))};
}
export async function check(root,{fetcher=fetch}={}){
 const manifest=await fetchStable(fetcher),s=await status(root);
 return {available:manifest.releaseId!==s.installed?.releaseId,releaseId:manifest.releaseId,sourceCommit:manifest.sourceCommit,installed:s.installed?.releaseId||'legacy-local',staged:s.staged?.releaseId===manifest.releaseId};
}
async function verifyStaged(root,m){
 const base=resolve(root);
 for(const f of m.files){const target=await safeTarget(base,'local-data/pi-updates/staging/'+m.releaseId+'/'+f.path);
  const b=await optionalRead(target);if(!b||b.byteLength!==f.bytes||digest(b)!==f.sha256)throw Error('Staged file hash mismatch: '+f.path);
 }
}
export async function stage(root,{fetcher=fetch,manifest=null}={}){
 return exclusive(resolve(root),async()=>{
  const base=resolve(root),m=validateManifest(manifest||await fetchStable(fetcher)),s=await status(base);
  if(s.journal)throw Error('Interrupted update requires recovery');
  if(s.installed?.releaseId===m.releaseId)return {status:'already_installed',releaseId:m.releaseId};
  const folder=join(updateRoot(base),'staging',m.releaseId);
  await safeTarget(base,'local-data/pi-updates/staging/'+m.releaseId);
  await rm(folder,{recursive:true,force:true});await mkdir(folder,{recursive:true});
  try{
   for(const f of m.files){
    // Never overwrite operator-modified local source.
    const dest=await safeTarget(base,f.path),old=await optionalRead(dest);
    if(f.fromSha256===null?old!==null:old===null||digest(old)!==f.fromSha256)throw Error('Local file differs from expected base: '+f.path);
    const bytes=await guardedGet(sourceUrl(m,f.path),fetcher,f.bytes+1);
    if(bytes.byteLength!==f.bytes||digest(bytes)!==f.sha256)throw Error('Downloaded blob fails SHA-256 verification: '+f.path);
    const staged=await safeTarget(base,'local-data/pi-updates/staging/'+m.releaseId+'/'+f.path);
    await atomicWrite(staged,bytes);
   }
   await verifyStaged(base,m);
   await atomicWrite(join(updateRoot(base),'staged.json'),Buffer.from(JSON.stringify(m)));
   return {status:'staged',releaseId:m.releaseId,files:m.files.length,bytes:m.files.reduce((n,f)=>n+f.bytes,0),activation:'next_offline_start'};
  }catch(e){await rm(folder,{recursive:true,force:true});throw e}
 });
}
export async function recover(root){
 const base=resolve(root),dir=updateRoot(base);
 return exclusive(base,async()=>{
  const journal=await readJson(join(dir,'journal.json'));
  if(!journal)return {status:'clean'};
  if(!ID.test(journal.releaseId)||!Array.isArray(journal.files))throw Error('Invalid recovery journal: manual inspection needed');
  for(const item of [...journal.files].reverse()){
   const path=cleanPath(item.path),dest=await safeTarget(base,path);
   if(item.existed){
    const backup=await safeTarget(base,'local-data/pi-updates/backups/'+journal.releaseId+'/'+path);
    const b=await readFile(backup);
    if(!HASH.test(item.beforeSha256)||digest(b)!==item.beforeSha256)throw Error('Backup integrity check failed; manual recovery required');
    await atomicWrite(dest,b);
   }else await rm(dest,{force:true});
  }
  await rm(join(dir,'journal.json'),{force:true});
  return {status:'rolled_back_incomplete',releaseId:journal.releaseId};
 });
}
export async function activate(root,{offline=()=>Promise.resolve(true),smoke=async()=>{}}={}){
 const base=resolve(root);if(!await offline())throw Error('Stop localhost and active jobs before applying updates');
 return exclusive(base,async()=>{
  const dir=updateRoot(base),m=validateManifest(await readJson(join(dir,'staged.json')));
  if(await readJson(join(dir,'journal.json')))throw Error('Interrupted update needs recovery first');
  if((await readJson(installedFile(base)))?.releaseId===m.releaseId)return {status:'already_installed',releaseId:m.releaseId};
  await verifyStaged(base,m);
  const backups=join(dir,'backups',m.releaseId),records=[];
  for(const f of m.files){
   const dest=await safeTarget(base,f.path),old=await optionalRead(dest);
   if(f.fromSha256===null?old!==null:old===null||digest(old)!==f.fromSha256)throw Error('Local file changed after staging: '+f.path);
   records.push({path:f.path,existed:old!==null,beforeSha256:old?digest(old):null});
  }
  await rm(backups,{recursive:true,force:true});
  for(const record of records)if(record.existed){
   const source=await safeTarget(base,record.path),dest=await safeTarget(base,'local-data/pi-updates/backups/'+m.releaseId+'/'+record.path);
   await mkdir(dirname(dest),{recursive:true});await copyFile(source,dest);
  }
  const previous=await readJson(installedFile(base));
  await atomicWrite(join(dir,'journal.json'),Buffer.from(JSON.stringify({releaseId:m.releaseId,files:records,previous})));
  try{
   for(const f of m.files){
    const bytes=await readFile(await safeTarget(base,'local-data/pi-updates/staging/'+m.releaseId+'/'+f.path));
    if(digest(bytes)!==f.sha256)throw Error('Staging corrupted during activation');
    await atomicWrite(await safeTarget(base,f.path),bytes);
   }
   await smoke(base,m);
   await atomicWrite(installedFile(base),Buffer.from(JSON.stringify({releaseId:m.releaseId,sourceCommit:m.sourceCommit,appliedAt:new Date().toISOString(),previous})));
   await rm(join(dir,'journal.json'),{force:true});
   return {status:'activated',releaseId:m.releaseId,previous:previous?.releaseId||'legacy-local',files:m.files.length};
  }catch(error){
   // Keep the journal and all backed-up files if recovery itself fails.
   for(const record of [...records].reverse()){
    const dest=await safeTarget(base,record.path);
    if(!record.existed)await rm(dest,{force:true});
    else {
     const b=await readFile(await safeTarget(base,'local-data/pi-updates/backups/'+m.releaseId+'/'+record.path));
     if(digest(b)!==record.beforeSha256)throw Error('Activation failed and backup integrity failed: '+record.path);
     await atomicWrite(dest,b);
    }
   }
   await rm(join(dir,'journal.json'),{force:true});
   throw error;
  }
 });
}
export async function rollback(root,{offline=()=>Promise.resolve(true)}={}){
 const base=resolve(root);if(!await offline())throw Error('Stop localhost before rollback');
 return exclusive(base,async()=>{
  const dir=updateRoot(base),installed=await readJson(installedFile(base));
  if(!installed?.releaseId)throw Error('No applied release');
  const m=await readJson(join(dir,'staged.json'));
  if(!m||m.releaseId!==installed.releaseId)throw Error('Rollback manifest missing; manual recovery required');
  const checked=validateManifest(m);
  const backups=join(dir,'backups',installed.releaseId);
  for(const f of checked.files){
   const dest=await safeTarget(base,f.path),current=await optionalRead(dest);
   if(!current||digest(current)!==f.sha256)throw Error('Current file modified; refusing rollback: '+f.path);
   if(f.fromSha256!==null){
    const old=await readFile(await safeTarget(base,'local-data/pi-updates/backups/'+installed.releaseId+'/'+f.path));
    if(digest(old)!==f.fromSha256)throw Error('Backup corrupted: '+f.path);
   }
  }
  for(const f of [...checked.files].reverse()){
   const dest=await safeTarget(base,f.path);
   if(f.fromSha256===null)await rm(dest,{force:true});
   else await atomicWrite(dest,await readFile(join(backups,f.path)));
  }
  if(installed.previous)await atomicWrite(installedFile(base),Buffer.from(JSON.stringify(installed.previous)));
  else await rm(installedFile(base),{force:true});
  return {status:'rolled_back',releaseId:installed.releaseId};
 });
}
