/**
 * One-time, offline-only adapter for the known Phase4 v0.4-based local agent.
 * This does not authorize arbitrary PowerShell, commands, URLs or GitHub paths.
 */
import {createHash,randomUUID} from 'node:crypto';
import {readFile,writeFile,rename,rm,mkdir} from 'node:fs/promises';
import {join,dirname,resolve} from 'node:path';
const sha=b=>createHash('sha256').update(b).digest('hex');
const AGENT_SHA='46aa67cddcc89b66605afaba763672902a5c7c09a07c591490c9c25054441259';
const START_SHA='2f0c05cee6264a41a91037d4bc79e5de2e412efd5ba7302ed6b35b0455395664';
function once(s,old,next){
 if(s.split(old).length!==2)throw Error('Expected single patch anchor not found');
 return s.replace(old,next);
}
export function patchAgent(s){
 if(s.includes("from '../updater/core.mjs'"))return s;
 s=once(s,"import {createHash} from 'node:crypto';","import {createHash} from 'node:crypto';\nimport {check as checkAppUpdate,stage as stageAppUpdate,status as appUpdateStatus} from '../updater/core.mjs';");
 s=once(s,"'run_tests','collect_website','benchmark_failed34'","'run_tests','update_status','update_check','update_stage','collect_website','benchmark_failed34'");
 s=once(s," async function execute(j){"," async function execute(j){\n  if(j.action==='update_status'){const x=await appUpdateStatus(root);return {status:'completed',action:j.action,installed:x.installed?.releaseId||'legacy-local',staged:x.staged?.releaseId||null,recoveryPending:!!x.journal};}\n  if(j.action==='update_check')return {status:'completed',action:j.action,...await checkAppUpdate(root)};\n  if(j.action==='update_stage')return {status:'completed',action:j.action,...await stageAppUpdate(root)};");
 return s;
}
export function patchStart(s){
 if(s.includes("from './updater/watch.mjs'"))return s;
 s=once(s,"import {fileURLToPath} from 'node:url';","import {fileURLToPath} from 'node:url';\nimport {startUpdateWatcher} from './updater/watch.mjs';");
 s=once(s,"let ownedOllama=null,lab=null,queueAgent=null,closing=false;","let ownedOllama=null,lab=null,queueAgent=null,updateWatcher=null,closing=false;");
 s=once(s,"closing=true;queueAgent?.stop();","closing=true;updateWatcher?.stop();queueAgent?.stop();");
 s=once(s,"queueAgent.start();console.log(queueToken?", "queueAgent.start();updateWatcher=startUpdateWatcher(root);console.log(queueToken?");
 return s;
}
async function atomically(path,value){
 const tmp=path+'.pi-bootstrap-'+randomUUID();
 try{await writeFile(tmp,value,{flag:'wx'});await rename(tmp,path)}
 finally{await rm(tmp,{force:true}).catch(()=>{})}
}
export async function installBridge(root,{allowKnownOnly=true}={}){
 const base=resolve(root),targets=[
  {path:join(base,'app','queue-agent.mjs'),expected:AGENT_SHA,modify:patchAgent},
  {path:join(base,'start.mjs'),expected:START_SHA,modify:patchStart}
 ];
 const changes=[];
 for(const file of targets){
  const bytes=await readFile(file.path),original=bytes.toString('utf8');
  if(allowKnownOnly&&sha(bytes)!==file.expected&&!original.includes("from '../updater/core.mjs'")&&!original.includes("from './updater/watch.mjs'"))throw Error('Unknown local application source; refusing automatic patch: '+file.path.split(/[\\/]/).at(-1));
  const next=file.modify(original);
  changes.push({...file,original,bytes,newBytes:Buffer.from(next),changed:next!==original});
 }
 const backup=join(base,'local-data','pi-updates','bootstrap-'+Date.now());
 await mkdir(backup,{recursive:true});
 const installed=[];
 try{
  for(const [i,file] of changes.entries()){
   if(!file.changed)continue;
   await writeFile(join(backup,i===0?'queue-agent.mjs':'start.mjs'),file.bytes,{flag:'wx'});
   await atomically(file.path,file.newBytes);installed.push(file);
  }
  return {status:'bridge_installed',updated:installed.length,backup:'local-data/pi-updates/'+backup.split(/[\\/]/).at(-1)};
 }catch(e){
  for(const file of installed.reverse())await atomically(file.path,file.bytes);
  throw e;
 }
}
