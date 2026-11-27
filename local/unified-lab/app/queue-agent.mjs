/** Private issue queue transport. Fixed operations only; no arbitrary commands,
 * arbitrary paths, prompts, shell execution, code updates, or public listening port.
 * Remote collection accepts only validated public HTTPS seeds; the acquisition
 * runtime enforces DNS pinning, exact host, robots, request and byte budgets. */
import {createHash} from 'node:crypto';
import {check as checkAppUpdate,stage as stageAppUpdate,status as appUpdateStatus} from '../updater/core.mjs';
import {spawn} from 'node:child_process';
import {readFileSync,writeFileSync,renameSync,mkdirSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {MODEL,OLLAMA,ollamaHealth} from './intelligence.mjs';

export const REPO='KaranBarua01/PI-Agent-Queue', OWNER='KaranBarua01', REPO_ID=1464395830, OWNER_ID=107566813;
export const QUEUE_LABEL='pi-local-agent-job', JOB_SCHEMA='pi-local-agent/job-v1', RESULT_SCHEMA='pi-local-agent/result-v1';
export const SITES=Object.freeze({research_baja_50:{url:'https://www.bajadesigns.com/',maxPages:50},research_1up_50:{url:'https://1up-usa.com/',maxPages:50},ollama_1up:{url:'https://1up-usa.com/',maxPages:7}});
export const ACTIONS=Object.freeze(['health','ollama_health','run_tests','update_status','update_check','update_stage','collect_website','benchmark_failed34','export_benchmark_evidence',...Object.keys(SITES)]);
export const REMOTE_REVISION='phase4-remote-benchmark-v1';
const RUN_ID=/^[\dTZ-]+_[0-9a-f-]{36}$/;
function publicSeed(raw){
 if(typeof raw!=='string'||raw.length>2048)throw Error('Invalid public HTTPS seed');
 const u=new URL(raw);
 if(u.protocol!=='https:'||u.username||u.password||u.port||u.hash||u.search||!/^([a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z][a-z0-9-]*$/i.test(u.hostname)||/\.(?:local|localhost|internal|test|invalid|example)$/i.test(u.hostname))throw Error('Invalid public HTTPS seed');
 return u.href;
}
function loadFailedCohort(root){
 const raw=readFileSync(join(root,'benchmark','failed34.json'),'utf8');
 if(createHash('sha256').update(raw).digest('hex')!=='63a1d635f011443c04bba78768008632334d3901eaaa52961ab914eaff9dacd0')throw Error('Unexpected failed-company manifest hash');
 const m=JSON.parse(raw);
 if(m.schemaVersion!=='pi-failed-cohort/v1'||m.baselineIssue!==63||m.sourceCommit!=='89ec9c91706396c00d1b34e24d5a3f1bf58742ae'||m.maxPages!==50||m.networkRequestLimit!==360||m.byteLimit!==67108864||!Array.isArray(m.sites)||m.sites.length!==34||new Set(m.sites.map(s=>s.id)).size!==34||m.sites.filter(s=>s.group==='technical_failure').length!==15||m.sites.some(s=>!/^\d{3}$/.test(s.id)||s.baseline?.usable!==0||!['technical_failure','policy_recheck'].includes(s.group)||publicSeed(s.url)!==s.url))throw Error('Failed-company manifest integrity check failed');
 return [...m.sites].sort((a,b)=>Number(a.group==='policy_recheck')-Number(b.group==='policy_recheck')||a.id.localeCompare(b.id));
}
const MAX_AGE=15*60*1000, MAX_EXPORT=2*1024*1024, CHUNK=24000;
const nowISO=()=>new Date().toISOString();
const sha=text=>createHash('sha256').update(text,'utf8').digest('hex');
const base='/repos/'+REPO;
const tokenLike=/(?:github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9]{25,}|sk-(?:proj-)?[A-Za-z0-9_-]{20,}|-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----|\bBearer\s+[A-Za-z0-9._-]{24,})/i;
function safeError(e){const m=String(e?.message||e||'Unknown error');return m.replace(/(?:github_pat_|gh[pousr]_)[A-Za-z0-9_]+/gi,'[REDACTED]').replace(/\bBearer\s+\S+/gi,'Bearer [REDACTED]').replace(/sk-(?:proj-)?[A-Za-z0-9_-]{12,}/g,'[REDACTED]').replace(/[A-Z]:\\[^\r\n]+/gi,'[local path omitted]').slice(0,220);}
export function parseJob(issue,now=Date.now()){
 if(!issue||issue.pull_request||issue.state!=='open'||!Number.isSafeInteger(issue.number)||issue.number<1)throw Error('Not an open issue');
 if(issue.user?.login?.toLowerCase()!==OWNER.toLowerCase()||issue.user?.id!==OWNER_ID||issue.author_association!=='OWNER')throw Error('Not authorized owner');
 if(!(issue.labels||[]).some(x=>x.name===QUEUE_LABEL||x===QUEUE_LABEL))throw Error('Not a labeled queue job');
 const raw=issue.body;if(typeof raw!=='string'||raw.length>2500)throw Error('Invalid job body');
 let j;try{j=JSON.parse(raw);}catch{throw Error('Invalid job JSON');}
 const keys=['schemaVersion','jobId','action','issuedAt','expiresAt',...(j?.action==='collect_website'?['url','maxPages']:j?.action==='export_benchmark_evidence'?['benchmarkIssue','siteId']:[])];
 if(!j||Array.isArray(j)||typeof j!=='object'||Object.keys(j).length!==keys.length||keys.some(k=>!Object.hasOwn(j,k)))throw Error('Unexpected job fields');
 if(j.schemaVersion!==JOB_SCHEMA||!ACTIONS.includes(j.action)||typeof j.jobId!=='string'||!/^[A-Za-z0-9_-]{8,64}$/.test(j.jobId))throw Error('Unknown action or invalid job ID');
 const iso=/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/;
 if(typeof j.issuedAt!=='string'||typeof j.expiresAt!=='string'||!iso.test(j.issuedAt)||!iso.test(j.expiresAt))throw Error('Invalid UTC timestamps');
 const start=Date.parse(j.issuedAt),end=Date.parse(j.expiresAt);
 if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start||end-start>MAX_AGE||start>now+60000||now>=end||now-start>MAX_AGE)throw Error('Expired or future-dated job');
 if(j.action==='collect_website'){j.url=publicSeed(j.url);if(!Number.isInteger(j.maxPages)||j.maxPages<1||j.maxPages>50)throw Error('Invalid page budget');}
 if(j.action==='export_benchmark_evidence'&&(!Number.isSafeInteger(j.benchmarkIssue)||j.benchmarkIssue<1||typeof j.siteId!=='string'||!/^\d{3}$/.test(j.siteId)))throw Error('Invalid benchmark evidence selector');
 return {...j,issueNumber:issue.number};
}
export function makeGitHubApi(token){
 if(typeof token!=='string'||token.length<20)throw Error('Private queue token missing');
 return async (method,path,payload)=>{
  if(path!==base&&!path.startsWith(base+'/'))throw Error('Queue path outside approved repository');
  const r=await fetch('https://api.github.com'+path,{method,headers:{Authorization:'Bearer '+token,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','User-Agent':'product-insights-unified-agent/0.4',...(payload===undefined?{}:{'Content-Type':'application/json'})},body:payload===undefined?undefined:JSON.stringify(payload),redirect:'error',signal:AbortSignal.timeout(25000)});
  if(!r.ok){const e=Error('GitHub queue HTTP '+r.status);e.httpStatus=r.status;throw e;}
  return r.json();
 };
}
function isPrivate(info){return info?.private===true&&info.id===REPO_ID&&info.full_name?.toLowerCase()===REPO.toLowerCase();}
function splitText(text){const parts=[];for(let i=0;i<text.length;){let end=Math.min(i+CHUNK,text.length);if(end<text.length&&/[\uD800-\uDBFF]/.test(text[end-1]))end--;parts.push(text.slice(i,end));i=end;}return parts;}
export function attachment(number,jobId,name,text,secret=''){
 if(!['01_shared_input.json','02_ollama_results.json'].includes(name))throw Error('Attachment type not approved');
 if(typeof text!=='string')return {manifest:{name,status:'missing'},comments:[]};
 if(Buffer.byteLength(text,'utf8')>MAX_EXPORT)return {manifest:{name,status:'too_large_local_only',bytes:Buffer.byteLength(text,'utf8')},comments:[]};
 if((secret&&text.includes(secret))||tokenLike.test(text))return {manifest:{name,status:'sensitive_pattern_local_only'},comments:[]};
 const hash=sha(text),parts=splitText(text),count=parts.length;
 const comments=parts.map((part,i)=>{const marker=`PI_AGENT_ATTACHMENT:${number}:${jobId}:${name}:${hash}:${i+1}/${count}`;const body=marker+'\n\n~~~json\n'+JSON.stringify({schemaVersion:'pi-local-agent/attachment-v1',issueNumber:number,jobId,name,sha256:hash,part:i+1,total:count,text:part})+'\n~~~';if(body.length>65000)throw Error('Attachment chunk exceeds issue comment limit');return {marker,body};});
 return {manifest:{name,status:'shared_private_queue',sha256:hash,bytes:Buffer.byteLength(text,'utf8'),parts:count},comments};
}
async function checkInference(){
 const start=Date.now(),h=await ollamaHealth();if(!h.model_ready)return {status:'blocked',model:MODEL,check:h.reachable?'model_missing':'server_unreachable'};
 try{const r=await fetch(OLLAMA+'/api/chat',{method:'POST',headers:{'content-type':'application/json'},redirect:'error',signal:AbortSignal.timeout(120000),body:JSON.stringify({model:MODEL,messages:[{role:'user',content:'Return exactly this JSON object and no other text: {"status":"ok"}'}],stream:false,format:'json',think:false,options:{temperature:0,num_ctx:2048,num_predict:64}})});if(!r.ok)return {status:'failed',model:MODEL,check:'ollama_http_'+r.status,latencyMs:Date.now()-start};const x=await r.json();let passed=false;try{passed=x.done===true&&JSON.parse(x.message?.content||'').status==='ok';}catch{}return {status:passed?'completed':'failed',model:MODEL,check:passed?'inference_passed':'unexpected_model_response',latencyMs:Date.now()-start,localhostOnly:true};}catch{return {status:'failed',model:MODEL,check:'inference_request_failed',latencyMs:Date.now()-start};}
}
async function runTests(root){
 // Only fixed, shipped tests. No remote strings or GitHub code are executed.
 const args=['--experimental-sqlite','--test','--test-reporter=tap','engine/test.mjs','tests/integration.test.mjs','tests/queue-agent.test.mjs','tests/acquisition-phase4.test.mjs','benchmark/pinned-fetch.test.mjs'];
 return new Promise(resolve=>{let output='',settled=false;const env={...process.env};delete env.PI_AGENT_GITHUB_TOKEN;const child=spawn(process.execPath,args,{cwd:root,env,stdio:['ignore','pipe','pipe'],windowsHide:true});const done=(r)=>{if(settled)return;settled=true;clearTimeout(timer);resolve(r);};const timer=setTimeout(()=>{child.kill();done({status:'failed',check:'test_timeout'});},180000);for(const s of [child.stdout,child.stderr])s.on('data',c=>{output=(output+c.toString()).slice(-160000);});child.on('error',()=>done({status:'failed',check:'test_start_failed'}));child.on('close',code=>{const n=k=>Number(output.match(new RegExp('^# '+k+' (\\d+)','m'))?.[1]||0);done({status:code===0?'completed':'failed',exitCode:code,tests:n('tests'),passed:n('pass'),failed:n('fail'),note:'Packaged local fixture tests, not live-site accuracy.'});});});
}
export function createQueueAgent({root,lab,token='',api=token?makeGitHubApi(token):null,pollMs=15000,commentDelayMs=1100,clock=Date.now,ollamaCheck=checkInference,healthCheck=ollamaHealth,testRunner=()=>runTests(root)}={}){
 const dir=join(root,'local-data'),statePath=join(dir,'queue-state.json');mkdirSync(dir,{recursive:true});
 let state={schemaVersion:'pi-local-agent/state-v2',jobs:{}};
 if(existsSync(statePath)){try{const x=JSON.parse(readFileSync(statePath,'utf8'));if(x.schemaVersion!=='pi-local-agent/state-v2'||!x.jobs||typeof x.jobs!=='object'||Array.isArray(x.jobs))throw Error();state=x;}catch{api=null;}}
 let paused=false,stopped=false,timer=null,pumping=false,active=null;
 const status={configured:!!api,connected:false,paused:false,phase:api?'connecting':'not_configured',last_poll:null,last_issue:null,last_error:api?null:'Private queue token not configured, or local queue state is invalid.',active_job:null,queue:REPO,actions:ACTIONS};
 const save=()=>{const tmp=statePath+'.tmp';writeFileSync(tmp,JSON.stringify(state,null,2)+'\n',{encoding:'utf8',mode:0o600});renameSync(tmp,statePath);};
 const snapshot=()=>({...status,paused,active_job:active?{...active}:null});
 const verify=async()=>{if(!isPrivate(await api('GET',base)))throw Error('Expected verified private PI-Agent-Queue repository');};
 function readArtifacts(record){const result=[];if(!record.runId||!RUN_ID.test(record.runId))return result;const files=['collect_website','export_benchmark_evidence'].includes(record.action)?['01_shared_input.json']:['01_shared_input.json','02_ollama_results.json'];for(const file of files){let text=null;try{text=readFileSync(join(root,'results',record.runId,file),'utf8');}catch{}result.push(attachment(record.issueNumber,record.jobId,file,text,token));}return result;}
 async function existingComments(number){const comments=[];for(let i=1;i<=5;i++){const r=await api('GET',base+'/issues/'+number+'/comments?per_page=100&page='+i);if(!Array.isArray(r))throw Error('Invalid issue comments');comments.push(...r.filter(c=>c.user?.login?.toLowerCase()===OWNER.toLowerCase()&&c.user?.id===OWNER_ID));if(r.length<100)return comments;}throw Error('Too many issue comments; cannot safely de-duplicate');}
 async function report(rec){
  if(stopped)return;await verify();const current=await api('GET',base+'/issues/'+rec.issueNumber);if(current.state!=='open'){rec.status='reported';save();return;}
  const comments=await existingComments(rec.issueNumber);const old=new Set(comments.map(c=>String(c.body||'').split('\n')[0]));
  const parts=readArtifacts(rec);const marker='PI_AGENT_RESULT:'+rec.issueNumber;
  for(const a of parts){for(const c of a.comments){if(stopped)return;if(old.has(c.marker))continue;await api('POST',base+'/issues/'+rec.issueNumber+'/comments',{body:c.body});old.add(c.marker);if(commentDelayMs)await delay(commentDelayMs);}}
  const payload={schemaVersion:RESULT_SCHEMA,issueNumber:rec.issueNumber,jobId:rec.jobId,action:rec.action,status:'ready_to_report',result:rec.result||null,error:rec.error||null,attachments:parts.map(a=>a.manifest),note:'Only fixed actions and bounded benchmark exports. Full reports remain on the PC.'};
  if(!old.has(marker)){const body=marker+'\n\n~~~json\n'+JSON.stringify(payload,null,2)+'\n~~~';if((token&&body.includes(token))||tokenLike.test(body))throw Error('Result contains a sensitive pattern; not shared');await api('POST',base+'/issues/'+rec.issueNumber+'/comments',{body});}
  await api('PATCH',base+'/issues/'+rec.issueNumber,{state:'closed'});rec.status='reported';save();status.last_issue=rec.issueNumber;console.log('GitHub queue: reported issue #'+rec.issueNumber);
 }
 async function execute(j){
  if(j.action==='update_status'){const x=await appUpdateStatus(root);return {status:'completed',action:j.action,installed:x.installed?.releaseId||'legacy-local',staged:x.staged?.releaseId||null,recoveryPending:!!x.journal};}
  if(j.action==='update_check')return {status:'completed',action:j.action,...await checkAppUpdate(root)};
  if(j.action==='update_stage')return {status:'completed',action:j.action,...await stageAppUpdate(root)};
  if(j.action==='health'){const h=await healthCheck();const s=lab.getState();return {status:'completed',action:j.action,agentVersion:'phase4-unified-v04-base',remoteRevision:REMOTE_REVISION,nodeVersion:process.version,workspace:'Unified Local Research Lab (path omitted)',network:'outbound-only',lab_ready:true,lab_busy:!!s.busy,model:MODEL,ollama_ready:h.model_ready,allowed_actions:ACTIONS};}
  if(j.action==='ollama_health')return {...await ollamaCheck(),action:j.action};
  if(j.action==='run_tests')return {...await testRunner(),action:j.action};
  const rec=state.jobs[String(j.issueNumber)];
  if(j.action==='export_benchmark_evidence'){
   const previous=state.jobs[String(j.benchmarkIssue)];
   const row=previous?.action==='benchmark_failed34'&&previous.benchmarkRows?.find(r=>r.siteId===j.siteId);
   if(!row||!RUN_ID.test(row.runId||'')||!existsSync(join(root,'results',row.runId,'01_shared_input.json')))throw Error('No saved packet for that benchmark site');
   rec.runId=row.runId;save();return {status:'completed',action:j.action,benchmarkIssue:j.benchmarkIssue,siteId:j.siteId,run_id:row.runId,provider:'chatgpt',note:'Frozen source packet for external AI; no new crawl or local inference.'};
  }
  if(j.action==='benchmark_failed34'){
   const sites=loadFailedCohort(root);rec.benchmarkRows=[];save();
   for(const site of sites){
    if(stopped||paused||lab.getState().busy)break;
    const issue=await api('GET',base+'/issues/'+j.issueNumber);
    if(issue.state!=='open'||!(issue.labels||[]).some(x=>x.name===QUEUE_LABEL||x===QUEUE_LABEL))break;
    let row={siteId:site.id,company:site.company,url:site.url,group:site.group,status:'failed'};
    try{
     const run=lab.startQueueRun({url:site.url,maxPages:50,provider:'deterministic',strategy:'auto',browser:'none'},{issue:j.issueNumber,job_id:j.jobId});
     active.run_id=run.id;row.runId=run.id;row.startedAt=nowISO();
     const final=await run.completion;const st=lab.getState(),report=st.report||{},q=report.evidenceQuality||{},c=report.coverage||{},sample=final.sample||{};
     const norm=x=>String(x??'').normalize('NFKC').replace(/\s+/g,' ').toLowerCase();
     const native=(report.extracted_pages||[]).map(p=>norm([p.extracted_text,...(p.pdf_pages||[]).map(x=>x.text)].join(' ')));
     const selected=(st.packet?.batches||[]).flatMap(b=>b.input.sources.map(x=>norm(x.text)));
     const anchors=(site.baseline.anchors||[]).map(a=>({phrase:a.phrase,inNativeText:native.some(t=>t.includes(norm(a.phrase))),inSelectedEvidence:selected.some(t=>t.includes(norm(a.phrase)))}));
     const hits=anchors.filter(a=>a.inSelectedEvidence).length,attempted=c.visitedPages??sample.pages_attempted??0,accepted=q.counts?.accepted??0,relevant=q.counts?.relevant??0;
     row={...row,status:final.phase,attempted,retrieved:q.counts?.retrieved??0,accepted,relevant,productCandidates:q.distinctProductCandidates??0,score:q.score??0,selectedAnchorHits:hits,anchors,remainingLeads:c.remainingLeads??0,stopReason:c.stopReason||final.phase,batches:st.packet?.batches?.length??0,network:report.benchmarkAcquisition?.network||null,outcome:!['complete','no_usable_evidence'].includes(final.phase)?'execution_incomplete':relevant>0&&attempted>0&&accepted/attempted>=0.5&&hits>0?'provisional_recovery':accepted>0?'some_evidence_review_required':'still_no_accepted_evidence'};
    }catch(e){row.error=safeError(e);if(token)row.error=row.error.split(token).join('[REDACTED]');}
    rec.benchmarkRows.push(row);save();
    console.log('Failed-cohort '+rec.benchmarkRows.length+'/34: '+site.company+' '+(row.outcome||row.status));
    // Private queue checkpoint; no raw source text or credentials in progress.
    try{await verify();const body='PI_FAILED34_SITE:'+j.issueNumber+':'+site.id+'\n\n~~~json\n'+JSON.stringify({schemaVersion:'pi-failed34/site-v1',issueNumber:j.issueNumber,completed:rec.benchmarkRows.length,total:34,row})+'\n~~~';if((token&&body.includes(token))||tokenLike.test(body))throw Error('Sensitive-pattern progress withheld');await api('POST',base+'/issues/'+j.issueNumber+'/comments',{body});if(commentDelayMs)await delay(commentDelayMs);}catch(e){console.warn('Benchmark checkpoint delivery pending; local results retained.');}
    if(row.status==='cancelled'||stopped||paused)break;
   }
   const rows=rec.benchmarkRows;
   return {status:rows.length===34?'completed':'partial',action:j.action,provider:'chatgpt',completed:rows.length,total:34,baselineIssue:63,sourceCommit:'89ec9c91706396c00d1b34e24d5a3f1bf58742ae',provisionalRecovered:rows.filter(r=>r.outcome==='provisional_recovery').length,someEvidence:rows.filter(r=>r.outcome==='some_evidence_review_required').length,stillNoEvidence:rows.filter(r=>r.outcome==='still_no_accepted_evidence').length,incomplete:rows.filter(r=>!['provisional_recovery','some_evidence_review_required','still_no_accepted_evidence'].includes(r.outcome)).length,rows,note:'Same PC, original seeds and 50-page ceiling; exploratory recovery, not independently verified accuracy. Frozen packets available per site through export_benchmark_evidence.'};
  }
  const site=j.action==='collect_website'?{url:j.url,maxPages:j.maxPages}:SITES[j.action];if(!site)throw Error('Action not allowed');
  const run=lab.startQueueRun({...site,provider:j.action==='collect_website'?'deterministic':'ollama',strategy:'auto',browser:'none'},{issue:j.issueNumber,job_id:j.jobId});
  active.run_id=run.id;rec.runId=run.id;save();
  const final=await run.completion;const summary=final.summary?.metrics||null,sample=final.sample||null;
  return {status:final.phase==='complete'?'completed':final.phase,action:j.action,site:site.url,run_id:run.id,page_budget:site.maxPages,pages_attempted:sample?.pages_attempted??final.pages?.length??0,pages_usable:sample?.pages_usable??0,metrics:summary,products:final.summary?.products??0,claims:final.summary?.claims??0,model:j.action==='collect_website'?null:MODEL,provider:j.action==='collect_website'?'chatgpt':'ollama',lab_phase:final.phase,error:final.error?'Research reported an error; inspect local dashboard.':null};
 }
 async function pumpOnce(){
  if(!api||paused||stopped||pumping)return;pumping=true;status.phase='connecting';
  try{
   await verify();status.connected=true;status.last_error=null;status.last_poll=nowISO();status.phase='ready';
   // Reconnect reporting after an interruption, but never re-run a previous operation.
   for(const rec of Object.values(state.jobs)){if(rec.status==='running'){rec.status='ready_to_report';rec.error='Previous process stopped during job. Not replayed; inspect saved local reports.';save();}if(rec.status==='ready_to_report'){status.phase='reporting';await report(rec);}}
   if(paused||stopped)return;
   const items=await api('GET',base+'/issues?state=open&labels='+encodeURIComponent(QUEUE_LABEL)+'&per_page=50&sort=created&direction=asc');if(!Array.isArray(items))throw Error('Invalid queue response');
   for(const issue of items){if(stopped||paused)break;let j;try{j=parseJob(issue,clock());}catch{continue;}if(state.jobs[String(j.issueNumber)]||Object.values(state.jobs).some(r=>r.jobId===j.jobId))continue;
    if(j.action!=='health'&&lab.getState().busy){status.phase='waiting_for_lab';break;}
    // Recheck current issue and ensure it has not already been completed elsewhere.
    const current=await api('GET',base+'/issues/'+j.issueNumber);try{j=parseJob(current,clock());}catch{continue;}
    const old=await existingComments(j.issueNumber);if(old.some(c=>String(c.body||'').startsWith('PI_AGENT_RESULT:'+j.issueNumber+'\n')))continue;
    if(j.action!=='health'&&lab.getState().busy){status.phase='waiting_for_lab';break;}
    const rec={issueNumber:j.issueNumber,jobId:j.jobId,action:j.action,status:'running',startedAt:nowISO()};state.jobs[String(j.issueNumber)]=rec;save();active={issue:j.issueNumber,action:j.action,job_id:j.jobId};status.phase='running';console.log('GitHub queue: executing issue #'+j.issueNumber+' ('+j.action+')');
    try{rec.result=await execute(j);}catch(e){rec.error=safeError(e);if(token)rec.error=rec.error.split(token).join("[REDACTED]");}
    rec.finishedAt=nowISO();rec.status='ready_to_report';save();status.phase='reporting';await report(rec);active=null;status.phase='ready';break; // One job per scan; check pause/cancel between jobs.
   }
  }catch(e){status.connected=false;status.phase='error';status.last_error=safeError(e);if(token)status.last_error=status.last_error.split(token).join("[REDACTED]");console.warn('GitHub queue: '+status.last_error);}
  finally{active=null;pumping=false;if(paused)status.phase='paused';}
 }
 function schedule(ms){if(!api||stopped)return;timer=setTimeout(async()=>{await pumpOnce();schedule(pollMs);},ms);timer.unref?.();}
 return {start(){if(api&&!stopped&&!timer)schedule(0);},stop(){stopped=true;clearTimeout(timer);status.phase='stopped';},snapshot,pumpOnce,pause(value){paused=!!value;status.phase=paused?'paused':pumping?status.phase:'connecting';return snapshot();}};
}
