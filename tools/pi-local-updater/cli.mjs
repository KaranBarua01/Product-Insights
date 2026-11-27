#!/usr/bin/env node
// Node 24+, no npm dependencies or AI vendor SDK. Called from app root.
import {resolve,join} from 'node:path';
import {connect} from 'node:net';
import {spawnSync} from 'node:child_process';
import {status,check,stage,recover,activate,rollback} from './core.mjs';
const [command='status',where='.']=process.argv.slice(2);
const root=resolve(where);
function offline(){
 return new Promise(resolve=>{
  const socket=connect({host:'127.0.0.1',port:8791});
  let done=false;const finish=v=>{if(done)return;done=true;socket.destroy();resolve(v)};
  socket.once('connect',()=>finish(false));socket.once('error',()=>finish(true));socket.setTimeout(1500,()=>finish(false));
 });
}
function smoke(app){
 const args=['--experimental-sqlite','--test','engine/test.mjs','tests/integration.test.mjs','tests/queue-agent.test.mjs','tests/acquisition-phase4.test.mjs','benchmark/pinned-fetch.test.mjs'];
 const env={...process.env};delete env.PI_AGENT_GITHUB_TOKEN;
 const r=spawnSync(process.execPath,args,{cwd:app,env,stdio:'inherit',windowsHide:true,timeout:180000});
 if(r.error||r.status!==0)throw Error('Post-update regression tests failed (automatic rollback requested)');
}
async function run(){
 if(Number(process.versions.node.split('.')[0])<24)throw Error('Node.js 24 or newer is required');
 let result;
 if(command==='status')result=await status(root);
 else if(command==='check')result=await check(root);
 else if(command==='stage')result=await stage(root);
 else if(command==='auto'){const release=await check(root);result=release.available?await stage(root):{status:'up_to_date',installed:release.installed};}
 else if(command==='recover'){if(!await offline())throw Error('Stop the lab before recovery');result=await recover(root);}
 else if(command==='activate'){result=await activate(root,{offline,smoke});}
 else if(command==='rollback'){result=await rollback(root,{offline});}
 else if(command==='activate-if-staged'){
  const current=await status(root);
  if(current.journal)result=await recover(root);
  else if(!current.staged||current.staged.releaseId===current.installed?.releaseId)result={status:'no_pending_release'};
  else if(current.staged.releaseId===current.rejected?.releaseId)result={status:'quarantined_previous_version_retained',releaseId:current.staged.releaseId};
  else{
   try{result=await activate(root,{offline,smoke});}
   catch(e){
    const after=await status(root);
    if(after.rejected?.releaseId!==current.staged.releaseId||after.journal)throw e;
    result={status:'failed_release_rolled_back',releaseId:current.staged.releaseId,detail:String(e.message||e)};
   }
  }
 }else throw Error('Unknown fixed updater action');
 console.log(JSON.stringify(result,null,2));
}
run().catch(e=>{console.error('PI_UPDATE_ERROR:',String(e?.message||e));process.exitCode=1});
