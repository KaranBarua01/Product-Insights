/** Unified lab adapter for the reviewed, cumulative Phase 1-4 engine. */
import {existsSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createPinnedFetcher,approvedUrl} from '../benchmark/pinned-fetch.mjs';
export const PIN='89ec9c91706396c00d1b34e24d5a3f1bf58742ae';
export const MAX_PAGES=50;
export const RELEASE='phase4-unified-v04-base';
const imp=p=>import(pathToFileURL(p).href);
const rootPath=root=>join(root,'runtime','Product-Insights-'+PIN);
const marker=root=>join(rootPath(root),'.pi-unified-ready.json');
export function validateBudget(n){if(!Number.isInteger(n)||n<1||n>MAX_PAGES)throw Error('Page budget must be 1-50');return n;}
export function runtimeStatus(root){
 const repo=rootPath(root);let ready=false;
 try{ready=JSON.parse(readFileSync(marker(root),'utf8')).revision===PIN&&['Scrappers/dist/engine.js','Scrappers/tools/research-v3.mjs','Scrappers/tools/evidence-quality.mjs','engine/pattern-systems/dist/parse.js','engine/pattern-systems/dist/patterns.js'].every(p=>existsSync(join(repo,p)));}catch{}
 return {ready,revision:PIN,release:RELEASE,network:'DNS-pinned HTTPS; exact host; no browser'};
}
const cache=new Map();
async function load(root){
 if(!runtimeStatus(root).ready)throw Error('Acquisition runtime is not ready. Start using START_LOCALHOST.bat.');
 if(cache.has(root))return cache.get(root);
 const repo=rootPath(root),scr=join(repo,'Scrappers'),tools=join(scr,'tools'),pat=join(repo,'engine','pattern-systems','dist');
 const [{extract},{validatePublicUrl},{runResearchV3,V3_MAX_PAGES},{analyzeHtml,analyzePdf},{classify},{createLocalPdfOcr}]=await Promise.all([imp(join(scr,'dist','engine.js')),imp(join(scr,'dist','safety.js')),imp(join(tools,'research-v3.mjs')),imp(join(pat,'parse.js')),imp(join(pat,'patterns.js')),imp(join(tools,'local-pdf-ocr.mjs'))]);
 if(V3_MAX_PAGES!==MAX_PAGES)throw Error('Unexpected pinned planner page limit');
 const m={extract,validatePublicUrl,runResearchV3,analyzeHtml,analyzePdf,classify,createLocalPdfOcr};cache.set(root,m);return m;
}
const clip=(s,n)=>String(s??'').slice(0,n);
function stopFor(r){
 if(r.status!=='blocked')return '';
 if(/\[rate_limited\]|\bHTTP 429\b/i.test(r.reason))return 'rate_limited';
 if(/\bHTTP (?:401|403|503)\b|access challenge|interstitial|\[robots_denied\]|\[robots_unavailable\]|\[redirect_policy\]/i.test(r.reason))return 'policy_stop';
 return '';
}
/** Pattern detection is passive: analyze only already retrieved native samples.
 * No extra preflight requests or alternate user agent used to evade a denial. */
export async function acquireWithRuntime(m,{url,maxPages=50,strategy='auto',browser='none',origin='dashboard'},{progress=()=>{},cancelled=()=>false,transportFactory=createPinnedFetcher,env=process.env}={}){
 validateBudget(maxPages);
 if(!['auto','S01','S03'].includes(strategy)||browser!=='none')throw Error('This guarded release supports HTTP/PDF only; browser rendering is disabled');
 const u=m.validatePublicUrl(url);approvedUrl(u.href,u.hostname);
 const started=Date.now(),manual=origin==='dashboard',allowLarge=manual&&env.PI_LOCAL_LARGE_PDF==='1',ocrEnabled=manual&&env.PI_LOCAL_PDF_OCR==='1';
 let remainingOcr=6,largeReservations=3,hardStop='',capture=null,htmlCount=0,pdfCount=0,patternStatus='not_assessed';
 const samples=[],attempts=[],rawByUrl=new Map(),patternWarnings=[];
 const transport=transportFactory(u.hostname,{maxRequests:360,maxBytes:67108864,deadline:started+720000,onResponse:({url,status,type})=>{
   if(htmlCount>=2||new URL(url).pathname==='/robots.txt')return;
   capture=null;
   if(status!==200||!/html/i.test(type))return;
   const rec={url,type,chunks:[],size:0};capture=rec;
   return chunk=>{const room=1250000-rec.size;if(room<=0)return;const b=Buffer.from(chunk.subarray(0,room));rec.chunks.push(b);rec.size+=b.length;};
 }});
 const pdfOcr=ocrEnabled?m.createLocalPdfOcr():null;
 const boundedOcr=pdfOcr?async(bytes,pages)=>{const selected=pages.slice(0,remainingOcr);remainingOcr-=selected.length;return selected.length?pdfOcr(bytes,selected):[];}:undefined;
 progress({phase:'patterns',status:'started',message:'Pattern Systems will classify up to two accepted HTML samples and one PDF from the existing crawl; no additional requests',url:u.href});
 const report=await m.runResearchV3({url:u.href,maxPages,delayMs:350,shouldContinue:()=>!hardStop&&!cancelled()&&transport.canContinue(),
   onProgress:e=>progress({...e,phase:'acquisition',message:e.reason||'Visiting source page'}),
   extractPage:async target=>{
     capture=null;
     const mode=/\.pdf(?:$|\?)/i.test(target)?'auto':strategy;
     const larger=allowLarge&&largeReservations>0&&/\.pdf$|(?:catalog(?:ue)?|datasheet|manual|download|technical|document)/i.test(new URL(target).pathname);
     if(larger)largeReservations--;
     const r=await m.extract({url:target,mode,maxPdfPages:15},{fetcher:transport.fetcher,...(boundedOcr?{pdfOcr:boundedOcr}:{})},{allowedHosts:[u.hostname],timeoutMs:9000,maxHtmlPages:1,maxBytesHtml:1250000,maxBytesPdf:larger?12000000:3000000,allowLargePdf:larger},'none');
     attempts.push({requested_url:target,source_url:r.sourceUrl||target,status:r.status,reason:r.reason,attempts:r.attempts||[],routing:r.routing||null});
     hardStop=stopFor(r)||hardStop;
     return r;
   },onEvidence:(r,target)=>{
     const content=r.content||{},txt=String(content.text||'');
     rawByUrl.set(target,{extracted_text:txt.slice(0,40000),extracted_chars:txt.length,export_text_truncated:txt.length>40000,
       tables:content.tables||[],pdf_pages:content.pdfPages||[],pdf_coverage:content.pdfCoverage||null});
     try{
       if(r.strategy==='S03'&&pdfCount<1){samples.push(m.analyzePdf(r.sourceUrl,200,'application/pdf',content.pdfCoverage?content.pdfCoverage.textPages.length>0:undefined));pdfCount++;}
       else if(capture&&capture.url===r.sourceUrl&&htmlCount<2&&capture.size){
         const page=m.analyzeHtml(Buffer.concat(capture.chunks).toString('utf8'),capture.url,200,capture.type);
         page.truncated=r.status==='partial'||capture.size>=1250000;samples.push(page);htmlCount++;
       }
     }catch(e){patternWarnings.push('Pattern sample could not be classified: '+clip(e.message,180));}
     capture=null;
   }});
 capture=null;
 const extracted=report.pages.map(page=>{const requested=page.requestedUrl||page.url;const a=attempts.find(x=>x.requested_url===requested)||{requested_url:requested,source_url:page.url,status:page.status,reason:page.reason,attempts:[],routing:null};const raw=rawByUrl.get(requested);return {...a,status:page.status,retrieval_status:a.status,...(raw||{extracted_text:'',extracted_chars:0,export_text_truncated:false})};});
 // Make all source-backed identities available to the original knowledge engine.
 const candidates=new Map();for(const p of report.pages){if(!p.quality?.accepted)continue;for(const x of p.quality.productIdentities||[]){const key=x.key||x.name+'|'+x.sku;if(!candidates.has(key))candidates.set(key,{name:x.name,sku:x.sku,sourceUrl:p.url,evidenceType:x.locator,reviewStatus:'candidate_requires_review'});}}
 let patternReport={assessments:[],candidates:[]};
 if(samples.length){try{patternReport=m.classify(samples,new Date(started).toISOString());patternStatus='sampled_from_acquisition';}catch(e){patternStatus='unavailable';patternWarnings.push(clip(e.message,180));}}
 progress({phase:'patterns',status:'completed',message:patternStatus,patterns:patternReport.assessments.length});
 const stopReason=hardStop||transport.stopReason()||(cancelled()?'cancelled':report.coverage?.stopReason||'frontier_exhausted');
 return {...report,coverage:{...report.coverage,stopReason},evidenceQuality:report.evidenceQuality?{...report.evidenceQuality,stopReason}:null,products:[...candidates.values()].slice(0,120),extracted_pages:extracted,pattern_assessments:patternReport.assessments,pattern_candidates:patternReport.candidates,
   warnings:[...(report.warnings||[]),...patternWarnings],benchmarkAcquisition:{source_revision:PIN,planner:'cumulative Phase 1-4 V3',patternStatus,pattern_method:'passive accepted native evidence samples; no routing preflight',pattern_samples:samples.length,stopReason,elapsed_ms:Date.now()-started,source_page_limit:maxPages,strategy,browser,network:transport.stats(),ocrEnabled,allowLarge,ai_planning:false}};
}
export async function acquire(root,config,callbacks){return acquireWithRuntime(await load(root),config,callbacks);}
