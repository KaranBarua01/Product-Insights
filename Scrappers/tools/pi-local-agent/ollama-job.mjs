#!/usr/bin/env node
/** Fixed, outbound-safe Windows Ollama diagnostics; no remote shell or custom website inputs.
 * The private GitHub job can select only ollama_health or ollama_1up.
 * Never send model prompts, extracted page text, local paths or secrets to GitHub.
 */
import {writeFile} from 'node:fs/promises';
import {dirname,join,relative,resolve,sep,isAbsolute,basename} from 'node:path';
import {fileURLToPath} from 'node:url';
import {performance} from 'node:perf_hooks';
import {extract} from '../../dist/engine.js';
import {validatePublicUrl} from '../../dist/safety.js';
import {assertPublicDns} from '../research-lab-security.mjs';
import {createPlaywrightBrowserCapture} from '../node-browser.mjs';
import {runResearch} from '../research-planner.mjs';
import {extractProductIntelligence} from '../product-intelligence.mjs';
import {loadInstalledTaxonomy} from '../research-taxonomy-store.mjs';
import {probeOllama,enrichWithLocalOllama,mergeOllamaProducts} from '../ollama-mapping.mjs';

export const JOB_SCHEMA='pi-ollama-agent-result/v1';
export const MODEL='qwen3:4b-instruct';
export const COMPANY_URL='https://1up-usa.com/';
const HOST='1up-usa.com';
const SCRAPPERS=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const OUTPUTS=resolve(SCRAPPERS,'local-data/pi-local-agent/outputs');
const clean=s=>String(s??'').replace(/\s+/g,' ').trim();
const limited=(s,n=170)=>clean(s).slice(0,n);
const utc=()=>new Date().toISOString();
function safeCode(e){
  const m=String(e?.code||e?.name||'failure').toLowerCase().replace(/[^a-z_]/g,'').slice(0,40);
  return m||'failure';
}
export function fixedOutputPath(action,out){
  if(!['ollama_health','ollama_1up'].includes(action))throw Error('Unknown fixed action');
  if(typeof out!=='string'||isAbsolute(out)||out.includes('..')||out.includes('\\'))throw Error('Invalid local output path');
  const target=resolve(SCRAPPERS,out);
  if(dirname(target)!==OUTPUTS||!/^[-_a-zA-Z0-9]{8,64}-ollama_(?:health|1up)\.json$/.test(basename(target))||
    !basename(target).endsWith('-'+action+'.json'))throw Error('Output must be a fixed job file');
  return target;
}
export async function health({fetcher=fetch}={}){
  const started=performance.now();
  const check=await probeOllama({fetcher,preferredModel:MODEL});
  if(check.status!=='ready')return {schemaVersion:JOB_SCHEMA,action:'ollama_health',status:'unavailable',
    model:MODEL,localhostOnly:true,check:'model_not_ready',reason:limited(check.reason,110),
    latencyMs:Math.round(performance.now()-started)};
  try{
    const reply=await fetcher('http://127.0.0.1:11434/api/chat',{
      method:'POST',redirect:'error',headers:{'Content-Type':'application/json'},
      signal:AbortSignal.timeout(100000),
      body:JSON.stringify({model:MODEL,stream:false,think:false,format:'json',
        options:{temperature:0,num_ctx:512,num_predict:32},keep_alive:'2m',
        messages:[{role:'system',content:'Return exactly one valid JSON object with ok set to true. No other content.'},
          {role:'user',content:'Diagnostic only: reply {"ok":true}.'}]})
    });
    if(!reply.ok)return {schemaVersion:JOB_SCHEMA,action:'ollama_health',status:'failed',
      model:MODEL,localhostOnly:true,check:'http_'+reply.status,
      latencyMs:Math.round(performance.now()-started)};
    const raw=await reply.text();
    if(raw.length>12000)throw Error('Model response too large');
    const result=JSON.parse(raw);
    const response=JSON.parse(result?.message?.content||'null');
    const okay=response?.ok===true;
    return {schemaVersion:JOB_SCHEMA,action:'ollama_health',status:okay?'completed':'failed',
      model:MODEL,localhostOnly:true,check:okay?'inference_passed':'invalid_inference_reply',
      latencyMs:Math.round(performance.now()-started),responsesReturned:1};
  }catch(e){return {schemaVersion:JOB_SCHEMA,action:'ollama_health',status:'failed',
    model:MODEL,localhostOnly:true,check:safeCode(e),
    latencyMs:Math.round(performance.now()-started)};}
}

function safeSourceUrl(value){
  try{const u=new URL(value);return u.protocol==='https:'&&u.hostname===HOST?u.href:null;}catch{return null;}
}
function claim(x,key){
  const label=limited(x?.[key],100);
  const quote=limited(x?.evidence?.quote,160);
  return label&&quote?{name:label,quote}:null;
}
export function summarize1up({research,productIntelligence,model,reference,events=[],durationMs=0}){
  const pi=productIntelligence||{},ollama=model||{},pages=(research?.pages||[]).slice(0,7);
  const products=(pi.products||[]).slice(0,15).map(p=>({
    name:limited(p.name,130),sourceUrl:safeSourceUrl(p.sourceUrl),
    method:limited(p.extractionMethod,65),
    quote:limited(p.evidence?.[0]?.quote,180),
    reviewStatus:'unverified_source_candidate',
    materials:(p.materials||[]).slice(0,3).map(x=>claim(x,'material')).filter(Boolean),
    components:(p.components||[]).slice(0,3).map(x=>claim(x,'component')).filter(Boolean),
    taxonomy:{
      status:limited(p.taxonomy?.status||'not_mapped',60),
      suggestions:(p.taxonomy?.suggestions||[]).slice(0,2).map(x=>({
        code:limited(x.code,90),label:limited(x.label,125),
        method:limited(x.method||'candidate_only',60)
      }))
    }
  })).filter(x=>x.name&&x.sourceUrl);
  const candidates=products.filter(x=>x.method==='local_ollama_exact_source_quote').length;
  const used=pages.filter(p=>['completed','partial'].includes(p.status)).length;
  return {
    schemaVersion:JOB_SCHEMA,action:'ollama_1up',status:'completed',
    target:COMPANY_URL,sourcePolicy:'single_approved_host_robots_respected',
    durationMs:Math.round(durationMs),
    acquisition:{status:limited(research?.status,50),pagesVisited:pages.length,pagesUsable:used,
      pages:pages.map(p=>({url:safeSourceUrl(p.url),status:limited(p.status,30),strategy:limited(p.strategy,15),
        title:limited(p.title,100),textChars:Number(p.textChars||0),
        warning:limited(p.warnings?.[0]||p.reason,120)})).filter(p=>p.url)},
    model:{name:limited(ollama.model||MODEL,75),status:limited(ollama.status,48),
      pagesAnalyzed:Number(ollama.pagesAnalyzed||0),
      acceptedCandidates:Number(ollama.products?.length||0),reason:limited(ollama.reason,110)},
    taxonomy:{installed:Boolean(reference?.nodes?.length),nodes:Number(reference?.nodes?.length||0),
      nodeHash:reference?.manifest?.nodeHash||null,masterChanged:false},
    output:{products:products.length,localAiProducts:candidates,
      productsWithMaterials:products.filter(x=>x.materials.length).length,
      productsWithComponents:products.filter(x=>x.components.length).length,
      taxonomyProposals:products.reduce((n,p)=>n+p.taxonomy.suggestions.length,0),
      products},
    events:events.slice(-6).map(x=>({status:limited(x.status,55),step:Number(x.step||0),
      reason:limited(x.reason,110)})),
    quality:'unverified_candidates_not_accuracy',
    limitations:['Only seven selected same-host pages; no complete catalog assurance.',
      'Page evidence and AI suggestions require human review; no bill of materials or production ownership confirmed.',
      'Manufacturing processes, suppliers and production OS were not inferred or updated.']
  };
}
export async function run1up({fetcher=fetch}={}){
  const started=performance.now(),events=[];
  const ready=await probeOllama({fetcher,preferredModel:MODEL});
  if(ready.status!=='ready')return {summary:{schemaVersion:JOB_SCHEMA,action:'ollama_1up',
    status:'unavailable',model:{name:MODEL,status:ready.status,reason:limited(ready.reason,110)},
    quality:'no_investigation_performed'},details:null};
  let reference=null;try{reference=await loadInstalledTaxonomy();}catch(e){events.push({status:'taxonomy_unavailable'});}
  // No caller-controlled URL. Validate fixed HTTPS target and DNS before each request.
  const approved=validatePublicUrl(COMPANY_URL);
  if(approved.hostname!==HOST)throw Error('Unexpected fixed target');
  await assertPublicDns(HOST);
  const guardedFetch=async(input,init)=>{
    const candidate=validatePublicUrl(typeof input==='string'?input:input.url||String(input));
    if(candidate.hostname!==HOST)throw Error('Cross-host request rejected');
    await assertPublicDns(HOST);
    return fetcher(input,init);
  };
  const browser=createPlaywrightBrowserCapture({headless:true});
  const captured=[];
  const research=await runResearch({url:COMPANY_URL,maxPages:7,delayMs:550,
    onProgress:e=>{if(events.length<70)events.push(e);},
    extractPage:async target=>{
      const result=await extract({url:target,mode:'auto',maxPdfPages:4},
        {fetcher:guardedFetch,browser},{allowedHosts:[HOST],timeoutMs:10500,maxHtmlPages:1},'none');
      captured.push({...result,url:result.sourceUrl||target});
      return result;
    }});
  const deterministic=extractProductIntelligence({
    companyName:'1UP USA',rootUrl:COMPANY_URL,pages:captured
  });
  const model=await enrichWithLocalOllama({rootUrl:COMPANY_URL,rawPages:captured,
    taxonomyNodes:reference?.nodes||[],preferredModel:MODEL,fetcher,
    onProgress:e=>{if(events.length<70)events.push(e);}});
  const productIntelligence=mergeOllamaProducts(deterministic,model);
  const summary=summarize1up({research,productIntelligence,model,reference,
    events,durationMs:performance.now()-started});
  // Additional source traces stay on the user's own PC, never in a GitHub issue.
  const details={schemaVersion:JOB_SCHEMA,action:'ollama_1up',createdAt:utc(),
    research,productIntelligence,localInference:{status:model.status,reason:model.reason||null,
      model:model.model,acceptedProducts:model.products||[]},taxonomyReference:summary.taxonomy};
  return {summary,details};
}
async function main(){
  const [action,flag,out]=process.argv.slice(2);
  if(flag!=='--out'||process.argv.length!==5)throw Error('Expected fixed action and fixed output file');
  const target=fixedOutputPath(action,out);
  let result;
  try{
    result=action==='ollama_health'?{summary:await health(),details:null}:await run1up();
  }catch(e){result={summary:{schemaVersion:JOB_SCHEMA,action,status:'failed',
    errorCode:safeCode(e),note:'Inspect local agent console and source access; no private diagnostics were uploaded.'},details:null};}
  await writeFile(target,JSON.stringify(result.summary,null,2),{encoding:'utf8',flag:'wx'});
  // Local diagnostic written only after summary successfully written.
  if(result.details){const details=target.replace(/\.json$/,'-evidence.json');
    await writeFile(details,JSON.stringify(result.details,null,2),{encoding:'utf8',flag:'wx'});}
  // 'unavailable' is a valid diagnostic outcome; status remains explicit in JSON.
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))
  main().catch(e=>{console.error('PI Ollama job failed:',safeCode(e));process.exitCode=1;});
