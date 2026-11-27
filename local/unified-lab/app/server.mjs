import {createServer} from 'node:http';
import {readFileSync,existsSync,mkdirSync,writeFileSync,renameSync,readdirSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes,randomUUID,timingSafeEqual} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import engine from '../engine/worker.mjs';
import {acquire,runtimeStatus,validateBudget,PIN} from './acquisition.mjs';
import {makePacket,runOllama,aggregate,ollamaHealth,MODEL,OLLAMA} from './intelligence.mjs';
import {readLocalUpdateStatus} from './update-status.mjs';
import {makeOutcomeWorklist,validateOutcomeReview} from './final-outcome.mjs';
const ROOT=fileURLToPath(new URL('../',import.meta.url));
const HERE=dirname(fileURLToPath(import.meta.url));
const FILES={'acquisition':'00_acquisition_report.json','shared':'01_shared_input.json','ollama':'02_ollama_results.json','summary':'03_validated_summary.json','run':'04_run_status.json','full':'05_full_report.json','outcome':'06_final_outcome_review.json'};
const safeFile=(dir,file,data)=>{const p=join(dir,file);writeFileSync(p+'.tmp',JSON.stringify(data,null,2)+'\n','utf8');renameSync(p+'.tmp',p);};
const readJSON=p=>JSON.parse(readFileSync(p,'utf8'));
const CORSLESS={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Frame-Options':'DENY'};
const CSP="default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; object-src 'none'; form-action 'self'; frame-ancestors 'none'";
const str=(x,n=300)=>typeof x==='string'?x.slice(0,n):'';
const countsFrom=(db)=>Object.fromEntries(['product_types','categories','materials','manufacturing_processes','inference_rules'].map(t=>[t,db.prepare('SELECT count(*) AS n FROM '+t).get().n]));
export function createLab({root=ROOT,port=8790,resultsDir=join(root,'results'),acquisition=acquire,ollamaBase=OLLAMA,runtime=runtimeStatus,dbPath=join(root,'data','knowledge.sqlite'),restore=true}={}){
 const db=new DatabaseSync(dbPath,{readOnly:true});const counts=countsFrom(db),token=randomBytes(32).toString('hex');const adapter={prepare(sql){return{bind(...args){const stmt=db.prepare(sql);return{async all(){return{results:stmt.all(...args)}},async first(){return stmt.get(...args)||null}}}}}};
 const html=readFileSync(join(HERE,'index.html'),'utf8').replace('__LAB_TOKEN__',token);
 const files={'/':{data:html,type:'text/html; charset=utf-8'},'/app.js':{data:readFileSync(join(HERE,'app.js')),type:'application/javascript; charset=utf-8'},'/style.css':{data:readFileSync(join(HERE,'style.css')),type:'text/css; charset=utf-8'}};
 mkdirSync(resultsDir,{recursive:true});
 const initial=()=>({id:null,phase:'idle',busy:false,revision:0,cancelRequested:false,started_at:null,finished_at:null,config:null,error:null,events:[],pages:[],report:null,packet:null,results:[],summary:null,engineering:[],outcomeReview:null,dir:null,controller:null});
 let s=initial(),ollamaCache=null,ollamaChecked=0,queueAgent=null;
 function write(key,data){if(s.dir)safeFile(s.dir,FILES[key],data);}
 function status(){return {local_update:readLocalUpdateStatus(root),queue_agent:queueAgent?.snapshot()||{configured:false,connected:false,phase:"not_configured",paused:false},id:s.id,phase:s.phase,busy:s.busy,revision:s.revision,cancelRequested:s.cancelRequested,config:s.config,started_at:s.started_at,finished_at:s.finished_at,error:s.error,events:s.events,pages:s.pages,counts,acquisition_runtime:runtime(root),ollama:ollamaCache,summary:s.summary?{metrics:s.summary.metrics,products:s.summary.products.length,claims:s.summary.claims.length}:null,batches:s.results.map(({batch_id,status,metrics,checks,error,context_warning})=>({batch_id,status,metrics,checks:checks?{quotes_valid:checks.quotes_valid,quotes_total:checks.quotes_total,rejected:checks.rejected?.length,invalid_reference_ids:checks.invalid_reference_ids}:null,error,context_warning})),sample:s.packet?.sample||null,available:Object.fromEntries(Object.entries(FILES).map(([k,v])=>[k,!!s.dir&&existsSync(join(s.dir,v))]))};}
 function persist(){write('run',{...status(),events:s.events});}
 function event(e){s.revision++;s.events.push({...e,time:new Date().toISOString()});if(s.events.length>350)s.events.shift();if(e.phase==='acquisition'&&e.step){const row={...(s.pages[e.step-1]||{}),...e};s.pages[e.step-1]=row;}if(e.phase&&['patterns','acquisition','knowledge','ai','engineering'].includes(e.phase))s.phase=e.phase;persist();console.log(`[${e.phase||s.phase}] ${e.message||e.status||''}${e.url?' '+e.url:''}`);}
 async function callEngine(path,method='GET',data){const r=await engine.fetch(new Request('http://127.0.0.1'+path,{method,...(method==='POST'?{headers:{'content-type':'application/json'},body:JSON.stringify(data)}:{})}),{PRODUCT_INSIGHTS_DB:adapter});return {status:r.status,body:await r.json()};}
 async function refreshOllama(force=false){if(force||!ollamaCache||Date.now()-ollamaChecked>7000){ollamaCache=await ollamaHealth(ollamaBase);ollamaChecked=Date.now();}return ollamaCache;}
 function output(){return {run_id:s.id,requested_url:s.report?.requestedUrl||s.config?.url||null,sample:s.packet?.sample||null,acquisition:s.report?{status:s.report.status,coverage:s.report.coverage,evidenceQuality:s.report.evidenceQuality||null,pattern_assessments:s.report.pattern_assessments||[],benchmarkAcquisition:s.report.benchmarkAcquisition,products:s.report.products||[],warnings:s.report.warnings||[],pages:(s.report.pages||[]).map((p,i)=>({id:i+1,url:p.url,title:p.title,status:p.status,strategy:p.strategy,reason:p.reason,textChars:p.textChars,snippet:p.snippet,aiText:p.aiText,structuredProducts:p.structuredProducts,headings:p.headings,warnings:p.warnings,quality:p.quality||null,technicalReview:p.technicalReview||null,evidenceWindows:p.evidenceWindows||[]}))}:null,summary:s.summary,engineering:s.engineering,outcome_review:s.outcomeReview,provider:s.config?.provider||null,note:'Local draft V2 reference, not live Cloudflare. Observed website proposals and inferred engineering hypotheses require human review. No procurement or supplier matching.'};}
 function updateSummary(){if(!s.packet)return;s.summary=aggregate(s.packet,s.results);write('summary',s.summary);s.revision++;}
 async function enrichEngineering(){
  const leads=new Map();for(const p of s.summary?.products||[])leads.set(p.name.toLowerCase(),{name:p.name,source:'Ollama website proposal',category_id:p.category_id||null,category_candidates:p.category_candidates||[],model_hypotheses:p.engineering_hypotheses||[]});for(const p of s.report?.products||[]){const name=str(p.name||p.productName||p.label,150);if(name&&!leads.has(name.toLowerCase()))leads.set(name.toLowerCase(),{name,source:'Structured extraction lead',category_id:null,category_candidates:[],model_hypotheses:[]});}
  s.engineering=[];let i=0;const list=[...leads.values()].slice(0,120);for(const p of list){if(s.cancelRequested)break;const name=p.name.slice(0,150);let retrieval=[],exact=[],context=null;const q=name.trim();if(q.length>=2){const r=await callEngine('/v1/knowledge/search?kind=products&limit=8&q='+encodeURIComponent(q.slice(0,120)));retrieval=r.body.results||[];for(const candidate of retrieval.filter(x=>x.name.toLowerCase()===q.toLowerCase()).slice(0,3)){const detail=await callEngine('/v1/knowledge/products/'+encodeURIComponent(candidate.id));if(detail.status===200)exact.push(detail.body);}}if(p.category_id){const r=await callEngine('/v1/knowledge/categories/'+encodeURIComponent(p.category_id));if(r.status===200)context=r.body;}const rule=await callEngine('/v1/engineering/infer','POST',{product_name:name});s.engineering.push({...p,retrieval_candidates:retrieval,exact_product_classification:exact,category_context:context,deterministic_rule:rule.body});i++;if(i===list.length||i%10===0)event({phase:'engineering',status:'completed_item',message:`Retrieved industrial context for ${i}/${list.length} product leads`});}
  s.revision++;
 }
 async function executeAI(){
  if(!s.packet?.batches.length){event({phase:'ai',status:'skipped',message:'No usable extracted text. No AI analysis was invented.'});return;}
  if(s.config.provider!=='ollama'){event({phase:'ai',status:'skipped',message:'Deterministic-only mode selected; frozen evidence available for external review.'});return;}
  const h=await refreshOllama(true);if(!h.model_ready){event({phase:'ai',status:'unavailable',message:h.reachable?'Required model not installed: '+MODEL:'Ollama not reachable; use Retry AI once it is running.'});return;}
  const completed=new Map(s.results.filter(x=>x.status==='completed').map(r=>[r.batch_id,r]));const remaining={...s.packet,batches:s.packet.batches.filter(b=>!completed.has(b.batch_id))};
  // Preserve original batch IDs, original input hashes and successful previous results.
  if(!remaining.batches.length){event({phase:'ai',status:'completed',message:'All frozen batches already completed.'});return;}
  await runOllama(remaining,{base:ollamaBase,signal:s.controller.signal,totalBatches:s.packet.batches.length,cancelled:()=>s.cancelRequested,onProgress:e=>event({...e,total:s.packet.batches.length}),onBatch:async rec=>{const map=new Map(s.results.map(x=>[x.batch_id,x]));map.set(rec.batch_id,rec);s.results=[...map.values()].sort((a,b)=>a.batch_id-b.batch_id);write('ollama',{model:MODEL,batches_expected:s.packet.batches.length,batches_finished:s.results.length,results:s.results});updateSummary();}});
 }
 async function job(retry=false){try{
  if(!retry){event({phase:'acquisition',status:'started',message:'Research started: '+s.config.url});s.report=await acquisition(root,s.config,{progress:event,cancelled:()=>s.cancelRequested});write('acquisition',s.report);s.pages=(s.report.pages||[]).map((p,i)=>({step:i+1,maxPages:s.config.maxPages,url:p.url,title:p.title,status:p.status,chars:p.textChars,reason:p.reason,strategy:p.strategy}));s.revision++;
   event({phase:'knowledge',status:'started',message:'Preparing frozen evidence and retrieving V2 reference candidates'});s.packet=makePacket(s.report,db,s.config.maxPages);write('shared',s.packet);write('ollama',{model:MODEL,batches_expected:s.packet.batches.length,batches_finished:0,results:[]});updateSummary();event({phase:'knowledge',status:'completed',message:`${s.packet.sample.pages_usable}/${s.packet.sample.pages_attempted} usable pages; ${s.packet.batches.length} frozen AI batches`});
  }
  if(!s.cancelRequested)await executeAI();updateSummary();if(!s.cancelRequested){event({phase:'engineering',status:'started',message:'Matching extracted product leads against the knowledge database and rule engine'});await enrichEngineering();}
  if(s.cancelRequested)s.phase='cancelled';else if(!s.packet?.batches.length)s.phase='no_usable_evidence';else if(s.config.provider==='ollama'&&s.summary.metrics.batches_completed<s.packet.batches.length)s.phase='partial';else s.phase='complete';
 }catch(e){s.error=String(e.message||e).slice(0,500);s.phase=s.cancelRequested?'cancelled':'failed';console.error(s.error);}finally{s.busy=false;s.finished_at=new Date().toISOString();s.revision++;try{persist();write('full',output());}catch(e){console.error('Report save failed:',e.message);}console.log('Run '+(s.id||'')+': '+s.phase);}}
 if(restore){try{const dirs=readdirSync(resultsDir,{withFileTypes:true}).filter(d=>d.isDirectory()&&/^\d{4}-\d{2}-\d{2}T[0-9Z-]+_[0-9a-f-]+$/.test(d.name)).map(d=>d.name).sort().reverse();for(const id of dirs){const dir=join(resultsDir,id);if(!existsSync(join(dir,FILES.run)))continue;const old=readJSON(join(dir,FILES.run));s={...initial(),id,dir,phase:old.busy?'interrupted':old.phase,revision:1,config:old.config,started_at:old.started_at,finished_at:old.finished_at,error:old.error,events:old.events||[],pages:old.pages||[]};if(existsSync(join(dir,FILES.acquisition)))s.report=readJSON(join(dir,FILES.acquisition));if(existsSync(join(dir,FILES.shared)))s.packet=readJSON(join(dir,FILES.shared));if(existsSync(join(dir,FILES.ollama)))s.results=readJSON(join(dir,FILES.ollama)).results||[];if(s.packet)s.summary=aggregate(s.packet,s.results);if(existsSync(join(dir,FILES.full)))s.engineering=readJSON(join(dir,FILES.full)).engineering||[];if(s.report&&s.packet&&existsSync(join(dir,FILES.outcome))){try{s.outcomeReview=validateOutcomeReview(makeOutcomeWorklist(s.id,s.report,s.packet),readJSON(join(dir,FILES.outcome)));}catch(e){console.warn('Saved engineering review not restored:',e.message);}}break;}}catch(e){console.warn('Could not restore previous run:',e.message);s=initial();}}
 function send(res,code,body,type='application/json; charset=utf-8',extra={}){res.writeHead(code,{...CORSLESS,'Content-Type':type,...extra});res.end(type.startsWith('application/json')?JSON.stringify(body):body);}
 function local(req){const p=server.address()?.port||port,hosts=[`127.0.0.1:${p}`,`localhost:${p}`];return hosts.includes(req.headers.host)&&(!req.headers.origin||hosts.map(h=>'http://'+h).includes(req.headers.origin));}
 function authorized(req){const supplied=req.headers['x-lab-token'];if(typeof supplied!=='string'||supplied.length!==token.length)return false;return timingSafeEqual(Buffer.from(supplied),Buffer.from(token));}
 async function body(req,limit=8192){if(!String(req.headers['content-type']||'').startsWith('application/json'))throw Error('application/json required');let n=0,chunks=[];for await(const c of req){n+=c.length;if(n>limit)throw Error('Request too large');chunks.push(c);}return JSON.parse(Buffer.concat(chunks).toString('utf8'));}
 function beginRun(b,origin=null){
  if(s.busy)throw Error('Research is already running');if(!b||typeof b.url!=='string'||b.url.length>2048)throw Error('Valid public website URL required');let url;try{url=new URL(b.url);if(url.protocol!=='https:'||url.username||url.password||url.port)throw Error('bad URL');}catch{throw Error('Enter a public HTTPS website');}
  const maxPages=validateBudget(Number(b.maxPages??50)),strategy=b.strategy||'auto',browser=b.browser||'none',provider=b.provider||'deterministic';if(!['auto','S01','S03'].includes(strategy)||browser!=='none'||!['ollama','deterministic'].includes(provider))throw Error('Invalid research options');if(!runtime(root).ready)throw Error('Acquisition runtime not ready; use START_LOCALHOST.bat');
  const id=new Date().toISOString().replace(/[:.]/g,'-')+'_'+randomUUID();const dir=join(resultsDir,id);mkdirSync(dir);s={...initial(),id,dir,busy:true,phase:'starting',revision:1,started_at:new Date().toISOString(),config:{url:url.href,maxPages,strategy,browser,provider,...(origin?{origin:'github_queue',queue_issue:origin.issue,queue_job_id:origin.job_id}:{origin:'dashboard'})},controller:new AbortController()};persist();const completion=job().then(()=>status());return {id,completion};
 }
 const server=createServer(async(req,res)=>{try{
  if(!local(req))return send(res,403,{error:'Local host/origin required'});const u=new URL(req.url,'http://127.0.0.1'),p=u.pathname;
  if(req.method==='POST'&&!authorized(req))return send(res,403,{error:'Local session token required'});
  if(req.method==='GET'&&Object.hasOwn(files,p)){const f=files[p];return send(res,200,f.data,f.type,{'Content-Security-Policy':CSP});}
  if(req.method==='GET'&&(p==='/health'||p==='/api/status')){await refreshOllama();return send(res,200,{ok:true,...status()});}
  if(req.method==='GET'&&p==='/api/results')return send(res,200,output());
  if(req.method==='GET'&&p==='/api/outcome/worklist'){
   if(s.busy||!s.report||!s.packet)return send(res,409,{error:'Complete deterministic collection first'});
   return send(res,200,makeOutcomeWorklist(s.id,s.report,s.packet),'application/json; charset=utf-8',{'Content-Disposition':'attachment; filename="final_outcome_worklist.json"'});
  }
  if(req.method==='POST'&&p==='/api/outcome/review'){
   if(s.busy||!s.report||!s.packet)return send(res,409,{error:'Complete deterministic collection first'});
   const b=await body(req,1048576);
   if(s.busy||!s.report||!s.packet)return send(res,409,{error:'Current run is not ready'});
   const review=validateOutcomeReview(makeOutcomeWorklist(s.id,s.report,s.packet),b);
   write('outcome',review);s.outcomeReview=review;s.revision++;persist();write('full',output());
   return send(res,200,{ok:true,products:review.products.length});
  }
  if(req.method==='GET'&&p.startsWith('/api/export/')){const key=p.slice('/api/export/'.length);if(!Object.hasOwn(FILES,key)||!s.dir||!existsSync(join(s.dir,FILES[key])))return send(res,404,{error:'Export not available'});const data=readFileSync(join(s.dir,FILES[key]));res.writeHead(200,{...CORSLESS,'Content-Type':'application/json; charset=utf-8','Content-Disposition':`attachment; filename="${FILES[key]}"`});return res.end(data);}
  if(req.method==='POST'&&p==='/api/run'){
   if(s.busy)return send(res,409,{error:'Research is already running'});const b=await body(req);if(s.busy)return send(res,409,{error:'Research is already running'});if(!runtime(root).ready)return send(res,503,{error:'Acquisition runtime not ready; use START_LOCALHOST.bat'});
   const run=beginRun(b);return send(res,202,{ok:true,id:run.id});
  }
  if(req.method==='POST'&&p==='/api/queue/pause'){const b=await body(req);if(!queueAgent)return send(res,503,{error:'Queue agent not configured'});if(typeof b.paused!=='boolean')throw Error('paused must be boolean');return send(res,200,queueAgent.pause(b.paused));}
  if(req.method==='POST'&&p==='/api/cancel'){if(s.busy){s.cancelRequested=true;s.controller?.abort();s.revision++;persist();}return send(res,200,{ok:true,cancelRequested:s.cancelRequested});}
  if(req.method==='POST'&&p==='/api/retry-ai'){if(s.busy)return send(res,409,{error:'Research is running'});if(!s.packet?.batches.length)return send(res,409,{error:'No frozen evidence to analyze'});s.busy=true;s.cancelRequested=false;s.controller=new AbortController();s.config.provider='ollama';s.error=null;s.finished_at=null;s.revision++;persist();send(res,202,{ok:true,id:s.id});void job(true);return;}
  if(req.method==='POST'&&p==='/api/ollama/check')return send(res,200,await refreshOllama(true));
  if(req.method==='GET'&&(p.startsWith('/v1/knowledge/')||p==='/v1/knowledge/search')){const r=await callEngine(u.pathname+u.search);return send(res,r.status,r.body);}
  if(req.method==='POST'&&p==='/v1/engineering/infer'){const r=await callEngine(p,'POST',await body(req));return send(res,r.status,r.body);}
  return send(res,404,{error:'Not found'});
 }catch(e){console.error('API error:',e.message);if(!res.headersSent)send(res,400,{error:str(e.message,300)||'Invalid request'});else res.end();}});
 server.on('close',()=>{queueAgent?.stop();s.cancelRequested=true;s.controller?.abort();try{db.close();}catch{}});
 return {server,listen:()=>new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',()=>{server.off('error',reject);resolve(server.address().port);});}),close:()=>new Promise(resolve=>server.close(resolve)),getState:()=>s,setQueueAgent:agent=>{queueAgent=agent;},startQueueRun:(config,origin)=>beginRun(config,origin)};
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){const lab=createLab({port:Number(process.env.PI_LAB_PORT||8791)});try{const p=await lab.listen();console.log(`Product Insights Research Lab: http://127.0.0.1:${p}/`);}catch(e){console.error(e.message);process.exitCode=1;}}
