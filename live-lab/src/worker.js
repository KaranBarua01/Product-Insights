/* Hosted Cloudflare control-plane for real laptop-run website research.
 * No Cloudflare-side crawling, no raw scraped HTML, no OS writes.
 */
import {validateStart,hostOf,LIVE_SCHEMA,sanitizeOriginalTaxonomy,ORIGINAL_TAXONOMY_SCHEMA} from './protocol.js';
import {uiHtml,uiJs,uiCss} from './ui.js';
import {runEnrichment,SCHEMA as ENRICHMENT_SCHEMA} from './ai-enrichment.js';
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{
  'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',
  'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}});
const notFound=()=>json({error:'Not found'},404);
const text=(value,type)=>new Response(value,{headers:{
  'Content-Type':type,'Cache-Control':'no-store',
  'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',
  'Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; form-action 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"}});
const clip=(v,n=240)=>String(v??'').slice(0,n);
async function auth(req,secret){
  const a=req.headers.get('Authorization')||'';
  if(!secret||a.length>320||!a.startsWith('Bearer '))return false;
  const candidate=a.slice(7);
  if(candidate.length<24||candidate.length>160)return false;
  const encode=new TextEncoder();
  const [known,provided]=await Promise.all([
    crypto.subtle.digest('SHA-256',encode.encode(String(secret))),
    crypto.subtle.digest('SHA-256',encode.encode(candidate))
  ]);
  const x=new Uint8Array(known),y=new Uint8Array(provided);
  let diff=0;for(let i=0;i<x.length;i++)diff|=x[i]^y[i];
  return diff===0;
}
function bodyLimit(req,max){
  const len=Number(req.headers.get('content-length')||0);
  if(len>max)throw Error('Request exceeded size limit');
}
async function parse(req,max=10000){
  bodyLimit(req,max);
  if(!req.headers.get('content-type')?.startsWith('application/json'))throw Error('JSON request required');
  const raw=await req.text();
  if(raw.length>max)throw Error('Request exceeded size limit');
  return JSON.parse(raw);
}
const RUN_LIMIT=8,STALE_MS=9*60*1000,AI_STALE_MS=100_000;
function initial(){return{schemaVersion:LIVE_SCHEMA,lastAgentAt:0,active:null,runs:[],originalTaxonomy:null,revision:0};}
function cleanStale(s,now){
  const run=s.runs.find(x=>x.id===s.active);
  if(!run){s.active=null;return;}
  if(now-run.createdAt>STALE_MS&&['queued','running'].includes(run.status)){
    run.status='failed';run.error='Laptop disconnected or investigation exceeded demo time limit';
    run.finishedAt=now;s.active=null;
  }
}
function publicRun(run,full=false){
  if(!run)return null;
  const queuedAt=run.enrichment?.queuedAt||run.finishedAt;
  const aiTimedOut=run.enrichment?.status==='queued'&&queuedAt&&Date.now()-queuedAt>AI_STALE_MS;
  const displayedEnrichment=aiTimedOut?{schemaVersion:ENRICHMENT_SCHEMA,status:'failed',
    reason:'Cloudflare AI enrichment exceeded the demo time limit; raw research remains available'}:run.enrichment;
  const base={id:run.id,url:run.url,status:run.status,createdAt:run.createdAt,
    startedAt:run.startedAt,finishedAt:run.finishedAt,maxPages:run.maxPages,
    browser:'local_headless_browser',error:run.error||null,
    cancelRequested:!!run.cancelRequested,events:(run.events||[]).slice(-35),
    aiStatus:displayedEnrichment?.status||'not_started',
    enrichmentAttempts:run.enrichmentAttempts||0,
    taxonomyNodesAdded:displayedEnrichment?.workingTaxonomy?.newWorkingNodes||0};
  if(full){base.result=run.result||null;base.enrichment=displayedEnrichment||null;}
  return base;
}
export class LabSession{
  constructor(ctx,env){this.ctx=ctx;this.env=env;}
  async update(fn){
    return this.ctx.storage.transaction(async txn=>{
      const state=(await txn.get('state'))||initial(),now=Date.now();
      cleanStale(state,now);
      const response=fn(state,now);
      state.revision=(state.revision||0)+1;
      state.runs=state.runs.slice(0,RUN_LIMIT);
      await txn.put('state',state);
      return response;
    });
  }
  async fetch(req){
    const url=new URL(req.url),path=url.pathname,method=req.method;
    if(method==='GET'&&path==='/state'){
      const s=(await this.ctx.storage.get('state'))||initial();
      cleanStale(s,Date.now());
      return json({schemaVersion:LIVE_SCHEMA,
        laptop:{online:Date.now()-s.lastAgentAt<22000,lastSeenAt:s.lastAgentAt||null},
        activeRunId:s.active,
        runs:s.runs.map(x=>publicRun(x,false)),revision:s.revision});
    }
    if(method==='GET'&&path==='/original-taxonomy'){
      const state=(await this.ctx.storage.get('state'))||initial();
      return json(state.originalTaxonomy||{schemaVersion:ORIGINAL_TAXONOMY_SCHEMA,
        status:'not_loaded',totalNodes:0,nodeHash:null,nodes:[],masterModified:false,syncedAt:null});
    }
    if(method==='GET'&&path.startsWith('/run/')){
      const state=(await this.ctx.storage.get('state'))||initial();
      const run=state.runs.find(r=>r.id===path.slice('/run/'.length));
      return run?json(publicRun(run,true)):notFound();
    }
    if(method!=='POST')return notFound();
    let input={};
    try{input=await parse(req,path==='/original-taxonomy'?1_600_000:180000);}catch(e){return json({error:clip(e.message)},400);}
    try{
      if(path==='/original-taxonomy'){
        // Protected bridge may synchronize the real catalog, never invent or mutate nodes.
        const snapshot=sanitizeOriginalTaxonomy(input.snapshot);
        return await this.update((state,now)=>{
          state.originalTaxonomy={...snapshot,syncedAt:now};
          return json({ok:true,status:snapshot.status,totalNodes:snapshot.totalNodes,
            nodeHash:snapshot.nodeHash,masterModified:false});
        });
      }
      if(path==='/create'){
        const v=validateStart(input,this.env.ALLOWED_TEST_HOSTS);
        return await this.update((s,now)=>{
          if(s.active)return json({error:'One investigation at a time; finish or cancel the current run'},409);
          if(now-s.lastAgentAt>=22000)return json({error:'Laptop browser worker is offline. Start the laptop bridge first.'},503);
          const run={id:crypto.randomUUID(),...v,createdAt:now,startedAt:null,finishedAt:null,
            status:'queued',error:null,cancelRequested:false,events:[],result:null};
          s.runs.unshift(run);s.active=run.id;
          return json({ok:true,run:publicRun(run)});
        });
      }
      if(path==='/cancel'){
        return await this.update(s=>{
          const run=s.runs.find(r=>r.id===s.active);
          if(!run)return json({error:'No active investigation'},409);
          run.cancelRequested=true;
          return json({ok:true,id:run.id,message:'Stop requested; current website page will finish'});
        });
      }
      if(path==='/heartbeat'){
        return await this.update((s,now)=>{
          s.lastAgentAt=now;
          return json({ok:true,activeRunId:s.active});
        });
      }
      if(path==='/next'){
        return await this.update(s=>{
          const run=s.runs.find(r=>r.id===s.active);
          if(!run||run.status!=='queued')return json({job:null});
          run.status='running';run.startedAt=Date.now();
          return json({job:{id:run.id,url:run.url,host:run.host,
            maxPages:run.maxPages,mode:'auto',browser:'headless'}});
        });
      }
      if(path==='/progress'){
        return await this.update(s=>{
          const run=s.runs.find(r=>r.id===s.active);
          if(!run||run.id!==input.id||run.status!=='running')return json({error:'No matching active run'},409);
          s.lastAgentAt=Date.now();
          const added=(Array.isArray(input.events)?input.events:[]).slice(-16)
            .map(e=>({time:clip(e.time,35),status:clip(e.status,60),strategy:clip(e.strategy,20),
              url:typeof e.url==='string'&&hostOf(e.url)===run.host?clip(e.url,500):null,
              reason:clip(e.reason,180),chars:typeof e.chars==='number'?Math.max(0,Math.min(1000000,e.chars)):null}));
          run.events.push(...added);run.events=run.events.slice(-65);
          return json({ok:true,cancelRequested:!!run.cancelRequested});
        });
      }
      if(path==='/reenrich'){
        return await this.update((s,now)=>{
          const run=s.runs.find(x=>x.id===input.id);
          if(!run||run.status!=='completed'||!run.result)
            return json({error:'A completed real website investigation is required for AI recovery'},409);
          const status=run.enrichment?.status||'not_started';
          const queuedAt=run.enrichment?.queuedAt||run.finishedAt||now;
          const timedOut=status==='queued'&&now-queuedAt>AI_STALE_MS;
          if(status==='queued'&&!timedOut)
            return json({error:'Cloudflare AI is already running for this test'},409);
          const hasProposals=!!run.enrichment?.workingTaxonomy?.aiGeneratedNodes||
            !!run.enrichment?.proposals?.titleProductCandidates?.length;
          if(status==='completed'&&hasProposals)
            return json({error:'AI working proposals already exist for this test'},409);
          if((run.enrichmentAttempts||0)>=2)
            return json({error:'AI retries are limited to two per investigation'},429);
          const usable=(run.result.acquisition?.pages||[])
            .some(p=>['completed','partial'].includes(p.status)&&p.url);
          if(!usable)return json({error:'No usable website pages exist for AI recovery'},409);
          run.enrichmentAttempts=(run.enrichmentAttempts||0)+1;
          run.aiGeneration=(run.aiGeneration||0)+1;
          run.enrichment={schemaVersion:ENRICHMENT_SCHEMA,status:'queued',queuedAt:now,
            message:'Workers AI is examining real visited page titles for missing product candidates'};
          run.events.push({time:new Date(now).toISOString(),status:'ai_retry_started',
            strategy:'Cloudflare Workers AI',url:null,
            reason:timedOut?'Previous AI invocation timed out':'Retry requested for missing AI proposals',chars:null});
          run.events=run.events.slice(-65);
          return json({ok:true,id:run.id,result:run.result,generation:run.aiGeneration});
        });
      }
      if(path==='/enrichment'){
        return await this.update(s=>{
          const run=s.runs.find(x=>x.id===input.id);
          if(!run||run.status!=='completed'||run.enrichment?.status!=='queued')
            return json({error:'Enrichment does not match a completed waiting run'},409);
          if(Number(input.generation??0)!==Number(run.aiGeneration||0))
            return json({error:'Outdated AI attempt cannot overwrite a newer retry'},409);
          const result=input.enrichment;
          if(!result||result.schemaVersion!==ENRICHMENT_SCHEMA||
            !['completed','failed','unavailable','insufficient_source_evidence'].includes(result.status))
            return json({error:'Invalid enrichment state'},400);
          if(JSON.stringify(result).length>145000)return json({error:'Enrichment result too large'},413);
          run.enrichment=result;
          run.events.push({time:new Date().toISOString(),status:'ai_'+result.status,
            strategy:'Cloudflare Workers AI',url:null,
            reason:clip(result.reason||result.message||'',180),chars:null});
          run.events=run.events.slice(-65);
          return json({ok:true,id:run.id,status:run.enrichment.status});
        });
      }
      if(path==='/finish'){
        return await this.update((s,now)=>{
          const run=s.runs.find(r=>r.id===s.active);
          if(!run||run.id!==input.id||run.status!=='running')return json({error:'No matching active run'},409);
          const outcome=input.status==='completed'?'completed':'failed';
          if(outcome==='completed'){
            if(!input.result||input.result.schemaVersion!==LIVE_SCHEMA||
              hostOf(input.result.company?.url)!==run.host)
              return json({error:'Result schema/host mismatch'},400);
            const bytes=JSON.stringify(input.result);
            if(bytes.length>168000)return json({error:'Result too large'},413);
            run.result=input.result;
            run.aiGeneration=0;
            run.enrichment={schemaVersion:ENRICHMENT_SCHEMA,status:'queued',queuedAt:now,
              message:'Cloudflare Workers AI is generating an unverified working taxonomy'};
          }else run.error=clip(input.error||'Research failed or source access blocked',230);
          run.status=outcome;run.finishedAt=now;s.active=null;
          return json({ok:true,id:run.id,status:run.status});
        });
      }
    }catch(e){return json({error:clip(e?.message||'Invalid request')},400);}
    return notFound();
  }
}
async function doRequest(env,path,method='GET',body=null){
  const id=env.LAB_STATE.idFromName('one-approved-laptop-v1');
  const object=env.LAB_STATE.get(id);
  return object.fetch(new Request('https://internal.lab'+path,{
    method,headers:method==='POST'?{'Content-Type':'application/json'}:{},
    body:method==='POST'?JSON.stringify(body):undefined
  }));
}
async function completeAiEnrichment(env,id,facts,generation=0){
  let enrichment;
  try{enrichment=await runEnrichment(env,facts);}
  catch(e){enrichment={schemaVersion:ENRICHMENT_SCHEMA,status:'failed',
    reason:clip(e?.message||'AI inference failed',200),originalTaxonomyModified:false,osWritePerformed:false};}
  try{
    const stored=await doRequest(env,'/enrichment','POST',{id,enrichment,generation});
    if(!stored.ok)console.warn('AI result was not persisted:',stored.status,await stored.text());
  }
  catch(e){console.error('Could not persist AI working edition',String(e?.message||e).slice(0,140));}
}
export default {
  async fetch(request,env,ctx){
    const url=new URL(request.url),path=url.pathname,method=request.method;
    const base={'Cache-Control':'no-store'};
    if(method==='GET'&&path==='/')return text(uiHtml,'text/html; charset=utf-8');
    if(method==='GET'&&path==='/assets/app.js')return text(uiJs,'text/javascript; charset=utf-8');
    if(method==='GET'&&path==='/assets/style.css')return text(uiCss,'text/css; charset=utf-8');
    if(method!=='POST'&&method!=='GET')return notFound();
    const agent=path.startsWith('/api/agent/');
    const authorized=await auth(request,agent?env.LAB_AGENT_KEY:env.LAB_VIEW_KEY);
    if(!authorized)return json({error:'Access denied: valid team or agent key required'},401);
    if(!env.LAB_STATE)return json({error:'Hosted investigation state is not configured'},503);
    if(method==='POST'){
      const origin=request.headers.get('Origin');
      if(origin&&origin!==url.origin)return json({error:'Cross-origin modification denied'},403);
    }
    try{
      if(method==='GET'&&path==='/api/session')
        return json({ok:true,schemaVersion:LIVE_SCHEMA,allowedHosts:[...new Set(
          String(env.ALLOWED_TEST_HOSTS||'').split(',').map(x=>x.trim()).filter(Boolean))]});
      if(method==='GET'&&path==='/api/state')
        return doRequest(env,'/state');
      if(method==='GET'&&path==='/api/original-taxonomy')
        return doRequest(env,'/original-taxonomy');
      if(method==='GET'&&/^\/api\/runs\/[0-9a-f-]{36}$/.test(path))
        return doRequest(env,'/run/'+path.split('/').at(-1));
      if(method==='POST'&&/^\/api\/runs\/[0-9a-f-]{36}\/recover-ai$/.test(path)){
        if(!ctx?.waitUntil)return json({error:'Cloudflare background execution is unavailable'},503);
        const id=path.split('/')[3];
        const response=await doRequest(env,'/reenrich','POST',{id});
        if(!response.ok)return response;
        const data=await response.json();
        ctx.waitUntil(completeAiEnrichment(env,id,data.result,data.generation));
        return json({ok:true,id,aiStatus:'queued',
          message:'Workers AI recovery started from existing website evidence; no new laptop crawl required'});
      }
      if(method==='POST'&&path==='/api/runs'){
        const data=await parse(request,4000);
        return doRequest(env,'/create','POST',data);
      }
      if(method==='POST'&&path==='/api/cancel')
        return doRequest(env,'/cancel','POST',{});
      if(agent&&method==='POST'){
        if(path==='/api/agent/original-taxonomy'){
          const payload=await parse(request,1_600_000);
          return doRequest(env,'/original-taxonomy','POST',{snapshot:sanitizeOriginalTaxonomy(payload.snapshot)});
        }
        if(path==='/api/agent/heartbeat')return doRequest(env,'/heartbeat','POST',{});
        if(path==='/api/agent/next')return doRequest(env,'/next','POST',{});
        if(path==='/api/agent/progress'){
          const data=await parse(request,18000);
          return doRequest(env,'/progress','POST',data);
        }
        if(path==='/api/agent/finish'){
          const data=await parse(request,175000);
          const stored=await doRequest(env,'/finish','POST',data);
          if(stored.ok&&data.status==='completed'){
            if(ctx?.waitUntil)ctx.waitUntil(completeAiEnrichment(env,data.id,data.result,0));
            else console.warn('Worker execution context missing; AI enrichment cannot be scheduled');
          }
          return stored;
        }
      }
      return notFound();
    }catch(e){return json({error:clip(e?.message||'Unable to process request')},400);}
  }
};
