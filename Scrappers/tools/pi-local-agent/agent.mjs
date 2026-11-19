#!/usr/bin/env node
/** Outbound-only private GitHub Issues transport for fixed Windows test jobs.
 * Never accept a general command string. Never use a public issue queue.
 */
import {readFile,rename,writeFile,lstat} from 'node:fs/promises';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {parseQueueRepo,parseJob,QUEUE_LABEL,RESULT_SCHEMA,sanitizeOutput} from './policy.mjs';
import {workspaceRoot,confinedOutputDir,executeAction} from './runner.mjs';

const API='https://api.github.com';
const token=process.env.PI_AGENT_GITHUB_TOKEN||'';
const queue=parseQueueRepo(process.env.PI_AGENT_QUEUE_REPO);
const owner=String(process.env.PI_AGENT_ALLOWED_AUTHOR||'').trim();
const workspace=process.env.PI_AGENT_WORKSPACE||'';
const flags=process.argv.slice(2);
const once=flags.includes('--once');
const allowTests=process.env.PI_AGENT_ALLOW_TESTS==='1';
const allowLive10=process.env.PI_AGENT_ALLOW_LIVE_10==='1';
const allowDepth7=process.env.PI_AGENT_ALLOW_DEPTH_7==='1';
const allowProducts7=process.env.PI_AGENT_ALLOW_PRODUCTS_7==='1';
if(!token||!owner)throw Error('Set PI_AGENT_GITHUB_TOKEN and PI_AGENT_ALLOWED_AUTHOR locally');
if(flags.some(x=>x!=='--once'))throw Error('Only --once is supported as an optional flag');

async function api(method,path,payload){
  const res=await fetch(API+path,{
    method,headers:{Authorization:'Bearer '+token,Accept:'application/vnd.github+json',
      'X-GitHub-Api-Version':'2022-11-28','User-Agent':'pi-local-agent/0.1',
      ...(payload===undefined?{}:{'Content-Type':'application/json'})},
    body:payload===undefined?undefined:JSON.stringify(payload),
    signal:AbortSignal.timeout(18000),
    redirect:'error'
  });
  if(!res.ok)throw Error('GitHub queue API returned HTTP '+res.status);
  return res.json();
}
function apiPath(suffix=''){return '/repos/'+queue+suffix;}
function scrubError(e){return sanitizeOutput(e?.message||String(e),{secret:token,maxChars:450});}
function stateFile(out){return join(out,'.agent-state.json');}
async function readState(out){
  const file=stateFile(out);
  try{
    if(!(await lstat(file)).isFile())throw Error('Unsafe state file');
    const data=JSON.parse(await readFile(file,'utf8'));
    if(data?.schemaVersion==='pi-local-agent/state-v1'&&data.jobs&&typeof data.jobs==='object'&&!Array.isArray(data.jobs))
      return data;
    throw Error('Invalid local agent state');
  }catch(e){if(e.code==='ENOENT')return {schemaVersion:'pi-local-agent/state-v1',jobs:{}};throw e;}
}
async function saveState(out,state){
  const tmp=join(out,'.state-'+randomBytes(8).toString('hex')+'.tmp');
  await writeFile(tmp,JSON.stringify(state,null,2),{encoding:'utf8',flag:'wx'});
  await rename(tmp,stateFile(out));
}
function payloadForComment(number,job){
  const result={schemaVersion:RESULT_SCHEMA,issueNumber:number,jobId:job.jobId||null,
    action:job.action||null,status:job.status,
    result:job.result||null,error:job.error||null};
  return 'PI_AGENT_RESULT:'+number+'\n\n'+'~~~json\n'+JSON.stringify(result,null,2)+'\n~~~';
}
async function report(issueNumber,record){
  const comments=await api('GET',apiPath('/issues/'+issueNumber+'/comments?per_page=100'));
  const marker='PI_AGENT_RESULT:'+issueNumber;
  if(!Array.isArray(comments)||!comments.some(x=>String(x.body||'').startsWith(marker))){
    await api('POST',apiPath('/issues/'+issueNumber+'/comments'),{body:payloadForComment(issueNumber,record)});
  }
  await api('PATCH',apiPath('/issues/'+issueNumber),{state:'closed'});
}
async function pump(out,state){
  // Finished jobs are reported first; interrupted running jobs are NEVER replayed.
  for(const [number,record] of Object.entries(state.jobs)){
    if(record.status==='ready_to_report'){
      await report(Number(number),record);
      record.status='reported';
      await saveState(out,state);
    }
  }
  const issues=await api('GET',apiPath('/issues?state=open&labels='+encodeURIComponent(QUEUE_LABEL)+'&per_page=50&sort=created&direction=asc'));
  if(!Array.isArray(issues))throw Error('Unexpected GitHub queue response');
  for(const issue of issues){
    if(issue.pull_request||!Number.isSafeInteger(issue.number)||state.jobs[String(issue.number)])continue;
    if(String(issue.user?.login||'').toLowerCase()!==owner.toLowerCase())continue;
    let job,record;
    try{
      job=parseJob(issue,{owner});
      if(job.action==='run_tests'&&!allowTests)throw Error('run_tests disabled; set PI_AGENT_ALLOW_TESTS=1 locally');
      if(job.action==='benchmark_10'&&!allowLive10)throw Error('benchmark_10 disabled; set PI_AGENT_ALLOW_LIVE_10=1 locally');
      if(job.action==='depth_7'&&!allowDepth7)throw Error('depth_7 disabled; set PI_AGENT_ALLOW_DEPTH_7=1 locally');
      if(job.action==='products_7'&&!allowProducts7)throw Error('products_7 disabled; set PI_AGENT_ALLOW_PRODUCTS_7=1 locally');
      record={status:'running',jobId:job.jobId,action:job.action,startedAt:new Date().toISOString()};
      state.jobs[String(issue.number)]=record;
      await saveState(out,state);
      const result=await executeAction(job.action,{workspace,jobId:job.jobId,secret:token});
      record={status:'ready_to_report',jobId:job.jobId,action:job.action,
        result,finishedAt:new Date().toISOString()};
    }catch(e){
      record={status:'ready_to_report',jobId:job?.jobId||null,action:job?.action||null,
        error:scrubError(e),finishedAt:new Date().toISOString()};
    }
    state.jobs[String(issue.number)]=record;
    await saveState(out,state);
    await report(issue.number,record);
    record.status='reported';
    await saveState(out,state);
  }
}
async function main(){
  const root=await workspaceRoot(workspace),out=await confinedOutputDir(root);
  const info=await api('GET',apiPath());
  if(info?.private!==true||info.full_name?.toLowerCase()!==queue.toLowerCase())
    throw Error('PI_AGENT_QUEUE_REPO must be a verified PRIVATE GitHub repository');
  const state=await readState(out);
  console.log('PI Local Agent v0.1 ready. Private queue verified; authorized fixed actions only.');
  console.log('Workspace: Scrappers folder. '+(once?'One queue scan':'Polling queue every 15 seconds'));
  do{
    try{await pump(out,state);}
    catch(e){console.error('Queue error:',scrubError(e));if(once)process.exitCode=1;}
    if(!once)await new Promise(r=>setTimeout(r,15000));
  }while(!once);
}
main().catch(e=>{console.error('Startup rejected:',scrubError(e));process.exitCode=1;});
