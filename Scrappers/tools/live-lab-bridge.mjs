#!/usr/bin/env node
/** Outbound-only bridge from approved local Research Lab to Cloudflare Worker.
 * No inbound listener, network exposure, queue shell execution or OS connector.
 * Local Node 24+. Use distinct token from private GitHub agent credentials.
 */
import {setTimeout as delay} from 'node:timers/promises';
import {validateTarget,sanitizeEvents,sanitizeCompleted,allowedHosts} from '../../live-lab/src/protocol.js';

const LOCAL='http://127.0.0.1:8790';
const APPROVED='1up-usa.com,hoshizakiamerica.com,labconco.com,cmcsupply.com,phillipsmedisize.com,dronenerds.com';
const remoteRaw=process.env.PI_LIVE_LAB_URL||'';
const key=process.env.PI_LIVE_LAB_AGENT_KEY||'';
if(key.length<24||key.length>160)throw Error('Set PI_LIVE_LAB_AGENT_KEY to the private Cloudflare agent secret');
if(!remoteRaw)throw Error('Set PI_LIVE_LAB_URL to your protected *.workers.dev live Lab address');
const remote=new URL(remoteRaw);
if(remote.protocol!=='https:'||remote.username||remote.password||remote.port||
  !remote.hostname.endsWith('.workers.dev')||remote.pathname!=='/'||
  remote.search||remote.hash)throw Error('For pilot, PI_LIVE_LAB_URL must be a plain HTTPS Cloudflare workers.dev origin');
const ORIGIN=remote.origin;
const allowed=allowedHosts(APPROVED);
let run=true,active=false,seen=0,interrupted=false;
const stop=()=>{run=false;console.log('Bridge stop requested. It will stop after the current local call.')};
process.on('SIGINT',stop);process.on('SIGTERM',stop);
async function cloud(path,body={},timeoutMs=15000){
  const controller=AbortSignal.timeout(timeoutMs);
  const res=await fetch(ORIGIN+path,{
    method:'POST',redirect:'error',
    headers:{'Authorization':'Bearer '+key,'Content-Type':'application/json'},
    body:JSON.stringify(body),signal:controller});
  let data;try{data=await res.json()}catch{throw Error('Cloudflare returned non-JSON response for '+path);}
  if(!res.ok)throw Error('Cloudflare '+path+' returned HTTP '+res.status+': '+String(data.error||'Access or service error').slice(0,180));
  return data;
}
async function local(path,{method='GET',body=null,token=null,timeoutMs=10000}={}){
  const res=await fetch(LOCAL+path,{method,redirect:'error',
    headers:{...(token?{'x-lab-token':token}:{}),
      ...(body?{'Content-Type':'application/json'}:{})},
    body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(timeoutMs)});
  const raw=await res.text();
  if(!res.ok)throw Error('Local Research Lab '+path+' returned HTTP '+res.status+': '+raw.slice(0,160));
  try{return JSON.parse(raw)}catch{throw Error('Local Research Lab did not return valid JSON');}
}
async function localToken(){
  const health=await local('/health');
  if(health.service!=='InsideJob Research Lab'||health.access!=='loopback_only')
    throw Error('Local port 8790 is not the expected loopback-only InsideJob Research Lab');
  const response=await fetch(LOCAL+'/',{redirect:'error',signal:AbortSignal.timeout(9000)});
  if(!response.ok)throw Error('Cannot reach local Research Lab interface');
  const html=await response.text();
  const m=html.match(/<meta name="lab-token" content="([0-9a-f]{64})"/);
  if(!m)throw Error('Local Lab is missing its CSRF session token');
  return m[1];
}
function lastEvents(events,start,host){
  return sanitizeEvents((Array.isArray(events)?events:[]).slice(start),host).slice(-12);
}
async function originalTaxonomyAnchors(report,token){
  try{
    const pi=report?.productIntelligence||{};
    const keywords=[...(pi.products||[]).slice(0,8).map(x=>x.name),
      ...(pi.categories||[]).slice(0,8).map(x=>x.name)]
      .join(' ').toLowerCase().replace(/[^a-z0-9]+/g,' ').split(' ')
      .filter(x=>x.length>=4&&!['product','products','industrial','company','manufacturing',
        'systems','components','equipment','heavy','light','duty','shop','made'].includes(x));
    const selected=[...new Set(keywords)].slice(0,12);
    const reference=await local('/api/taxonomy/master-preview',{
      method:'POST',body:{keywords:selected},token,timeoutMs:9000});
    return reference.status==='installed'?reference:
      {status:'not_loaded',totalNodes:0,nodeHash:null,anchors:[]};
  }catch(e){
    console.warn('Original master taxonomy preview unavailable:',String(e.message).slice(0,150));
    return {status:'not_loaded',totalNodes:0,nodeHash:null,anchors:[]};
  }
}

async function finish(id,status,result=null,error=null){
  let problem=null;
  for(let i=0;i<3;i++){
    try{return await cloud('/api/agent/finish',{id,status,result,error},23000);}
    catch(e){problem=e;await delay(1500+i*1700);}
  }
  throw Error('Could not deliver final result to Cloudflare: '+String(problem?.message||problem));
}
async function execute(job){
  const target=validateTarget(job.url,allowed);
  if(job.host!==target.host||![3,7,12].includes(job.maxPages)||
    job.mode!=='auto'||job.browser!=='headless')
    throw Error('Remote job options were rejected by local fixed safety policy');
  console.log('Live investigation accepted:',target.host,'pages:',job.maxPages);
  const token=await localToken();
  const body={url:target.url,maxPages:job.maxPages,strategy:'auto',browser:'headless'};
  let done=false,cursor=0,cancelSent=false,reportPromise;
  // The local Lab runs one bounded request; poll status separately to relay progress.
  reportPromise=local('/api/run',{method:'POST',body,token,timeoutMs:430000})
    .then(value=>{done=true;return value;},error=>{done=true;throw error;});
  while(!done&&run){
    try{
      const status=await local('/api/status',{timeoutMs:8000});
      const events=status.events||[],batch=lastEvents(events,cursor,target.host);
      cursor=events.length;
      if(batch.length){
        const response=await cloud('/api/agent/progress',{id:job.id,events:batch},14000);
        if(response.cancelRequested&&!cancelSent){
          await local('/api/cancel',{method:'POST',body:{},token,timeoutMs:7000});
          cancelSent=true;
        }
      }else{
        const response=await cloud('/api/agent/progress',{id:job.id,events:[]},14000);
        if(response.cancelRequested&&!cancelSent){
          await local('/api/cancel',{method:'POST',body:{},token,timeoutMs:7000});cancelSent=true;
        }
      }
    }catch(e){console.warn('Progress unavailable; run continues:',String(e.message).slice(0,140));}
    await delay(1700);
  }
  if(!run&&!done){
    try{await local('/api/cancel',{method:'POST',body:{},token,timeoutMs:7000});}
    catch{}
  }
  const value=await reportPromise;
  if(!value.ok||!value.report)throw Error('Local research did not produce an actual report');
  const reference=await originalTaxonomyAnchors(value.report,token);
  const sanitized=sanitizeCompleted({...value,taxonomyReference:reference},target.host);
  await finish(job.id,'completed',sanitized);
  console.log('Completed real research:',target.host,
    'pages:',sanitized.acquisition.pagesVisited,
    'product candidates:',sanitized.productIntelligence.products.length);
}
async function main(){
  console.log('Product Insights live bridge · outbound Cloudflare connection only');
  console.log('Cloudflare:',ORIGIN);
  console.log('Approved site hosts:',APPROVED);
  console.log('No localhost port exposed. Team requests are restricted to listed hosts.');
  // Do not claim heartbeat/online until the underlying Lab is reachable.
  await localToken();
  console.log('Local Lab healthy; polling Cloudflare every 3 seconds.');
  let errors=0;
  while(run){
    try{
      await localToken();
      await cloud('/api/agent/heartbeat');
      if(!active){
        const result=await cloud('/api/agent/next');
        if(result.job){
          active=true;
          try{await execute(result.job);}
          catch(e){
            console.warn('Live investigation failed:',String(e.message||e).slice(0,230));
            try{await finish(result.job.id,'failed',null,String(e.message||e).slice(0,230));}
            catch(problem){console.error('Could not publish failure:',String(problem.message).slice(0,200));}
          }finally{active=false;}
        }
      }
      errors=0;
    }catch(e){
      errors++;
      console.warn('Cloudflare / local heartbeat failed:',String(e.message||e).slice(0,190));
      if(errors>8)console.warn('Live Lab is disconnected; check Worker URL, secrets, and local Research Lab.');
    }
    if(run)await delay(2900);
  }
  console.log('Live bridge stopped; no background process remains.');
}
main().catch(e=>{console.error('Bridge start failed:',String(e.message||e));process.exitCode=1;});
