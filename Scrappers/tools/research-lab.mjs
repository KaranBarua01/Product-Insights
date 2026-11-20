#!/usr/bin/env node
/** Localhost-only, per-run host approval; uses the existing compiled Scrappers engine. */
import {createServer} from 'node:http';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {extract,limitedPatternAnalysis} from '../dist/engine.js';
import {validatePublicUrl} from '../dist/safety.js';
import {createPlaywrightBrowserCapture} from './node-browser.mjs';
import {MAX_PAGES,parseTaxonomy,runResearch} from './research-planner.mjs';
import {extractProductIntelligence} from './product-intelligence.mjs';
import {probeOllama} from './ollama-mapping.mjs';
import {enrichKnownProductsWithOllama,mergeKnownProductEnrichment} from './ollama-known-products.mjs';
import {buildBusinessView,normalizeOsSnapshot,osSnapshotTemplate} from './lab-business.mjs';
import {businessCss,businessMarkup} from './lab-business-shell.mjs';
import {installTaxonomy,loadInstalledTaxonomy,makeManifest} from './research-taxonomy-store.mjs';
import {stage2Analyze,callStage2,stage2Config} from './research-stage2.mjs';
import {listTaxonomyProposals,enqueueTaxonomyProposals,reviewTaxonomyProposal,publishApprovedTaxonomy,loadWorkingTaxonomy} from './research-stage2-store.mjs';
import {assertPublicDns} from './research-lab-security.mjs';
import {loadOemProcessReference} from './oem-process-reference.mjs';
import {buildResearchGraph} from './research-relationship-graph.mjs';
import {proposePartHypotheses} from './ollama-relationships.mjs';
import {appendResearchEdition,readResearchEdition,publicEditionSummary} from './research-edition-store.mjs';

const port=Number(process.env.RESEARCH_LAB_PORT||8790),host='127.0.0.1';
if(!Number.isInteger(port)||port<1024||port>65535)throw Error('RESEARCH_LAB_PORT must be between 1024 and 65535');
const token=randomBytes(32).toString('hex');
const BASE=dirname(fileURLToPath(import.meta.url));
let taxonomyNodes=[],taxonomySource='not_loaded',taxonomyManifest=null,masterTaxonomy=null,taxonomyAliases=[],workingEdition=null;
const aiSettings=stage2Config();
const state={busy:false,cancel:false,events:[],report:null,osSnapshot:null,lastError:null,phase:'idle'};
const CSP="default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; object-src 'none'; form-action 'self'; frame-ancestors 'none'";
const common={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Frame-Options':'DENY'};
function send(res,body,status=200,headers={}){res.writeHead(status,{...common,...headers});res.end(body);}
function json(res,value,status=200){send(res,JSON.stringify(value),status,{'Content-Type':'application/json; charset=utf-8'});}
function logEvent(event){state.events.push({time:new Date().toISOString(),...event});if(state.events.length>90)state.events.shift();}
async function readBody(req,maxBytes=8000){
  if(Number(req.headers['content-length']||0)>maxBytes)throw Error('Request body too large');
  let total=0;const chunks=[];
  for await(const chunk of req){total+=chunk.length;if(total>maxBytes)throw Error('Request body too large');chunks.push(chunk);}
  return Buffer.concat(chunks).toString('utf8');
}
function validRequest(req,method){
  const h=(req.headers.host||'').toLowerCase();
  if(h!==`${host}:${port}`&&h!==`localhost:${port}`)return false;
  if(method==='POST'){
    const origin=req.headers.origin;
    if(origin&&origin!==`http://${host}:${port}`&&origin!==`http://localhost:${port}`)return false;
    const provided=req.headers['x-lab-token'];
    if(typeof provided!=='string')return false;
    const a=Buffer.from(provided),b=Buffer.from(token);
    if(a.length!==b.length||!timingSafeEqual(a,b))return false;
  }
  return true;
}
function html(){return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="lab-token" content="${token}"><title>InsideJob · Local Research Lab</title><style>
:root{--ink:#243146;--sub:#66778a;--accent:#097b86;--border:#dbe3eb;--surface:#fff;--bg:#f3f6fa}*{box-sizing:border-box}body{background:var(--bg);margin:0;color:var(--ink);font:14px/1.55 system-ui,-apple-system,Segoe UI,sans-serif}header{background:#16283e;color:white;padding:24px max(20px,calc((100vw - 1180px)/2));border-bottom:4px solid #087e85}header h1{margin:0;font-size:24px}header p{margin:5px 0 0;color:#bbd1e0}main{max-width:1200px;margin:auto;padding:24px 20px 60px}.grid{display:grid;grid-template-columns:2fr 1fr;gap:16px}.card{background:white;border:1px solid var(--border);border-radius:12px;padding:20px;margin-bottom:16px;box-shadow:0 3px 15px #24314608}h2{font-size:17px;margin:0 0 10px}label{display:block;font-weight:650;font-size:12px;color:#526277;margin:10px 0 5px}input,select,button{font:inherit}input[type=url],input[type=number],input[type=text],select{border:1px solid #bac8d6;border-radius:7px;padding:10px 9px;background:white;color:var(--ink);width:100%}.formgrid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}button{border:1px solid #bccad7;border-radius:7px;background:#fff;padding:9px 12px;cursor:pointer;font-weight:650}button.primary{background:var(--accent);border-color:var(--accent);color:#fff}button:disabled{opacity:.5;cursor:default}.actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:15px}.tag{display:inline-block;font-size:11px;padding:2px 7px;border-radius:99px;background:#eff3f8;color:#526277;margin-right:6px}.warn{background:#fff6e9;color:#865b27;border:1px solid #f2daba;padding:9px;border-radius:7px;margin:8px 0}.ok{color:#087c5a}.small{color:var(--sub);font-size:12px}.stats{display:flex;flex-wrap:wrap;gap:9px;margin:12px 0}.stats span{border:1px solid var(--border);background:#f7f9fb;border-radius:8px;padding:8px 12px}.scroll{overflow:auto}table{width:100%;border-collapse:collapse;min-width:680px}th,td{text-align:left;padding:9px 10px;border-bottom:1px solid var(--border);vertical-align:top;font-size:12px}th{color:var(--sub);background:#f8fafc}a{color:#056b9b;overflow-wrap:anywhere}pre{white-space:pre-wrap;overflow-wrap:anywhere;color:#456070;font-size:12px}.events{max-height:170px;overflow:auto;white-space:pre-wrap;background:#f7f9fb;border-radius:8px;padding:10px;font:12px/1.5 ui-monospace,monospace}details{margin:7px 0;padding:10px;border:1px solid var(--border);border-radius:7px}summary{cursor:pointer;font-weight:650}input[type=file]{max-width:100%}@media(max-width:850px){.grid,.formgrid{grid-template-columns:1fr}} ${businessCss}</style></head><body>
<header><div class="header-row"><div><h1>Product Insights · Intelligence Lab</h1><p>One real research engine · Two audience-specific views</p></div><nav class="mode-switch" aria-label="Choose intelligence display"><button type="button" id="mode-business" class="is-active" aria-pressed="true">Product Insights · Manuel</button><button type="button" id="mode-technical" aria-pressed="false">Technical View · Engineering</button></nav></div></header><main>${businessMarkup}<section id="technical-view" hidden aria-label="Technical investigation and evidence console">
<div class="grid"><section class="card"><h2>Live company investigation</h2><form id="run-form"><label for="site">Company website</label><input id="site" type="url" required placeholder="https://manufacturer.example.com" value="https://www.hoshizakiamerica.com/" maxlength="2048"><div class="formgrid"><div><label for="pages">Page budget</label><input id="pages" type="number" min="1" max="${MAX_PAGES}" value="7"></div><div><label for="strategy">Extraction strategy</label><select id="strategy"><option value="auto">Auto: HTML → Browser</option><option value="S02">Chromium on every page</option><option value="S01">HTML only</option></select></div><div><label for="browser">Chromium display</label><select id="browser"><option value="headless">Background browser</option><option value="visible">Visible Chrome window</option><option value="none">Disabled</option></select></div></div><div class="actions"><button class="primary" id="start" type="submit">Research website</button><button type="button" id="cancel" disabled>Stop after current page</button><a id="export" href="/api/export" hidden download>Download evidence JSON</a></div></form></section>
<section class="card"><h2>OEM Taxonomy · Installed Reference</h2><p id="taxonomy-status" class="small" aria-live="polite">Checking installed taxonomy on this PC…</p><div id="taxonomy-details" class="small"></div><details id="taxonomy-install-panel"><summary>Install or replace taxonomy (one time per PC)</summary><p class="small">Choose the existing OEM Industry Taxonomy Explorer HTML or JSON once. The lab validates and stores normalized nodes on this PC, automatically reloads them on later starts, and never sends them to Cloudflare or commits them to the public repository.</p><label for="taxonomy-file">Local taxonomy file</label><input type="file" id="taxonomy-file" accept=".html,.json,.txt"></details><p class="small">The displayed initialization is real: loading an installed reference and validating its integrity. Mapping results are unverified suggestions; enrichment will require separate review.</p></section></div>
<section class="card" id="stage2-card"><h2>Stage 2 · AI Research &amp; Taxonomy Enrichment</h2><p id="stage2-status" class="small">Checking available research intelligence...</p><div class="actions"><button type="button" id="stage2-refresh">Refresh proposals</button><button type="button" class="primary" id="stage2-publish">Publish approved working edition</button><a id="stage2-taxonomy-export" href="/api/stage2/taxonomy/export" download="insidejob-taxonomy-working-edition.json">Export working taxonomy JSON</a></div><div id="stage2-proposals"></div><p class="small">AI-generated taxonomy suggestions require a review decision. Publishing changes only a local, versioned working edition; the original master taxonomy is never rewritten and Cloudflare is not automatically updated.</p></section>
<section class="card"><h2>Live execution</h2><p id="status" class="small">Ready. No website requests have been made.</p><div id="events" class="events" role="log" aria-live="polite"></div></section>
<section id="result-card" class="card" hidden><h2>Evidence report</h2><div id="summary" class="stats"></div><div id="results"></div></section>
</section><p class="small">Safety: Runs locally on 127.0.0.1 only. Websites must resolve to public addresses; robots.txt, access restrictions, rate limits and exact-host boundaries are respected. Preflight DNS is not a pinned-egress sandbox: never expose this prototype to remote users or untrusted networks. No CAPTCHA bypass is attempted. No manufacturing or supplier qualification is inferred.</p></main><script src="/app.js" defer></script><script src="/business-app.js" defer></script></body></html>`;}
async function activateWorkingTaxonomy(){
  if(!masterTaxonomy)return;
  try{
    const active=await loadWorkingTaxonomy(masterTaxonomy);
    taxonomyNodes=active.nodes;taxonomyAliases=active.aliases;workingEdition=active.edition;taxonomyManifest=active.manifest;
    taxonomySource=workingEdition?'local_reviewed_working_edition':taxonomySource;
  }catch(e){
    taxonomyNodes=masterTaxonomy.nodes;taxonomyAliases=[];workingEdition=null;taxonomyManifest=masterTaxonomy.manifest;
    logEvent({status:'taxonomy_warning',reason:String(e.message||e).slice(0,180)});
  }
}
async function loadOptionalTaxonomy(){
  const input=process.env.RESEARCH_LAB_TAXONOMY_FILE;
  if(!input){
    const stored=await loadInstalledTaxonomy();
    if(stored){masterTaxonomy=stored;taxonomyNodes=stored.nodes;taxonomyManifest=stored.manifest;taxonomySource='installed_local_file';await activateWorkingTaxonomy();}
    return;
  }
  const data=await readFile(resolve(input),'utf8');
  taxonomyNodes=parseTaxonomy(data);taxonomySource='configured_file';taxonomyManifest=makeManifest(taxonomyNodes,{sourceName:input,sourceHash:null,installedAt:null});masterTaxonomy={nodes:taxonomyNodes,manifest:taxonomyManifest};await activateWorkingTaxonomy();
}
async function runJob(body){
  const u=validatePublicUrl(body.url);
  const maxPages=Number(body.maxPages||7);
  if(!Number.isInteger(maxPages)||maxPages<1||maxPages>MAX_PAGES)throw Error(`maxPages must be 1-${MAX_PAGES}`);
  const strategy=body.strategy||'auto',browserMode=body.browser||'headless';
  if(!['auto','S01','S02'].includes(strategy)||!['none','headless','visible'].includes(browserMode))throw Error('Invalid browser or strategy');
  if(strategy==='S02'&&browserMode==='none')throw Error('Chromium strategy requires a browser');
  await assertPublicDns(u.hostname);
  let patternAnalysis,patternStatus='not_requested';
  if(process.env.RESEARCH_LAB_PATTERN_MODE==='local'){
    try{
      const file=pathToFileURL(resolve(BASE,'../../engine/pattern-systems/dist/inspect.js')).href;
      const {inspectWebsite}=await import(file);
      const observed=await inspectWebsite(u.href,{maxPages:2});
      patternAnalysis=limitedPatternAnalysis(observed);
      patternStatus=patternAnalysis?'sampled':'no_usable_patterns';
      logEvent({status:'patterns',url:u.href,reason:patternStatus});
    }catch(e){patternStatus='unavailable';logEvent({status:'patterns',url:u.href,reason:String(e.message||e)});}
  }
  const browser=browserMode==='none'?undefined:createPlaywrightBrowserCapture({headless:browserMode!=='visible',slowMoMs:browserMode==='visible'?120:0,inspectHoldMs:browserMode==='visible'?1200:0});
  const fetcher=async(input,init)=>{
    const target=validatePublicUrl(typeof input==='string'?input:input.url||String(input));
    if(target.hostname!==u.hostname)throw Error('Cross-host fetch not approved');
    await assertPublicDns(target.hostname);
    return fetch(input,init);
  };
  const rawProductEvidence=[];
  const report=await runResearch({url:u.href,maxPages,delayMs:350,taxonomyNodes,shouldContinue:()=>!state.cancel,
    prioritizeLinks:aiSettings.configured?async({rootUrl,page,links})=>{
      const planned=await callStage2('plan',{rootUrl,pageSummary:page.snippet,links}, {config:aiSettings});
      return (planned.prioritizedIds||[]).map(id=>links[id-1]?.url).filter(Boolean);
    }:null,
    onProgress:logEvent,extractPage:async target=>{
      await assertPublicDns(u.hostname);
      const extracted=await extract({url:target,mode:strategy,maxPdfPages:8,...(patternAnalysis?{patternAnalysis}:{})},{fetcher,...(browser?{browser}:{})},{allowedHosts:[u.hostname],timeoutMs:9000,maxHtmlPages:1},patternAnalysis?'supplied':'none');
      rawProductEvidence.push({...extracted,url:extracted.sourceUrl||target});
      return extracted;
    }});
  const enriched=await stage2Analyze(report,{nodes:taxonomyNodes,aliases:taxonomyAliases,
    client:(action,payload)=>callStage2(action,payload,{config:aiSettings}),onProgress:logEvent});
  if(masterTaxonomy&&enriched.stage2.proposals.length){
    try{enriched.stage2.queue=await enqueueTaxonomyProposals(enriched.stage2.proposals,{baseNodeHash:masterTaxonomy.manifest.nodeHash});}
    catch(e){enriched.stage2.errors.push('Review queue could not be persisted: '+String(e.message||e).slice(0,150));}
  }
  const deterministic=extractProductIntelligence({companyName:u.hostname,rootUrl:u.href,pages:rawProductEvidence});
  // Source-extracted products are authoritative IDs; local Ollama adds review-only
  // component/material evidence and chooses from read-only taxonomy candidates.
  const ollama=await enrichKnownProductsWithOllama({rootUrl:u.href,rawPages:rawProductEvidence,
    knownProducts:deterministic.products,taxonomyNodes,onProgress:logEvent});
  const productIntelligence=mergeKnownProductEnrichment(deterministic,ollama);
  // The source file is a pinned, gitignored, local CODE asset. An absent or invalid
  // reference never blocks website research; no taxonomy / OS write is attempted.
  let processReference=null;
  try{processReference=await loadOemProcessReference();}
  catch(e){logEvent({status:'process_reference_warning',
    reason:String(e?.message||e).slice(0,150)});}
  const relationshipAi=await proposePartHypotheses({
    products:productIntelligence.products,
    processNames:processReference?.processNames||[],
    enabled:process.env.RESEARCH_LAB_RELATIONSHIP_AI==='1'&&!!processReference,
    model:'qwen3:4b-instruct'});
  const researchGraph=buildResearchGraph({companyName:u.hostname,companyUrl:u.href,
    products:productIntelligence.products,processReference,aiParts:relationshipAi.proposals});
  let editionResult=null,editionSummary=null;
  try{
    editionResult=await appendResearchEdition(researchGraph);
    editionSummary=publicEditionSummary(await readResearchEdition());
    logEvent({status:'working_edition',reason:'JSON edition '+editionResult.version+
      ' · '+researchGraph.counts.products+' product candidates · '+
      researchGraph.counts.processHypotheses+' possible process links'});
  }catch(e){logEvent({status:'working_edition_warning',
    reason:String(e?.message||e).slice(0,150)});}
  return {...enriched,productIntelligence,researchGraph,
    relationshipAi:{status:relationshipAi.status,model:relationshipAi.model,
      attemptedProducts:relationshipAi.attemptedProducts,
      hypotheses:relationshipAi.proposals.length,reason:relationshipAi.reason||null},
    editionSummary,lab:{ollama:{
    status:ollama.status,model:ollama.model||null,pagesAnalyzed:ollama.pagesAnalyzed||0,
    productsReviewed:ollama.productsReviewed||0,acceptedClaims:ollama.acceptedClaims||0,
    rejectedClaims:ollama.rejectedClaims||0,
    taxonomyStatus:ollama.taxonomy?.status||'not_loaded',
    candidatesAccepted:ollama.acceptedClaims||0,reason:ollama.reason||null,
    localhostOnly:true,taxonomyMasterModified:false},runtime:'Node.js localhost',execution:'existing Scrappers extract()',strategy,browser:browserMode,patternStatus,
    taxonomy:taxonomySource,taxonomyNodeCount:taxonomyNodes.length,taxonomyManifest,
    localEditionVersion:workingEdition?.version||0,stage2AiConfigured:aiSettings.configured}};
}
async function handler(req,res){
  if(!validRequest(req,req.method)){return json(res,{error:'Local-only request rejected'},403);}
  const u=new URL(req.url||'/',`http://${host}:${port}`),path=u.pathname;
  if(req.method==='GET'&&path==='/')return send(res,html(),200,{'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':CSP});
  if(req.method==='GET'&&path==='/app.js')return send(res,await readFile(join(BASE,'research-lab-ui.js'),'utf8'),200,{'Content-Type':'text/javascript; charset=utf-8'});
  if(req.method==='GET'&&path==='/business-app.js')return send(res,await readFile(join(BASE,'research-lab-business-ui.js'),'utf8'),200,{'Content-Type':'text/javascript; charset=utf-8'});
  if(req.method==='GET'&&path==='/api/ollama/status')return json(res,await probeOllama());
  if(req.method==='GET'&&path==='/health')return json(res,{service:'InsideJob Research Lab',status:'ready',port,access:'loopback_only',taxonomyLoaded:taxonomyNodes.length,taxonomyManifest,stage2AiConfigured:aiSettings.configured,localEditionVersion:workingEdition?.version||0});
  if(req.method==='GET'&&path==='/api/status')return json(res,{busy:state.busy,phase:state.phase,events:state.events,lastError:state.lastError,hasReport:!!state.report,taxonomyNodes:taxonomyNodes.length,taxonomySource,taxonomyManifest,stage2AiConfigured:aiSettings.configured,localEditionVersion:workingEdition?.version||0});
  if(req.method==='GET'&&path==='/api/working-edition/summary'){
    try{return json(res,publicEditionSummary(await readResearchEdition()));}
    catch(e){return json(res,{error:'Working edition unavailable',reason:String(e.message).slice(0,110)},503);}
  }
  if(req.method==='GET'&&path==='/api/process-reference/status'){
    try{const ref=await loadOemProcessReference();return json(res,ref?{
      status:'loaded',counts:ref.counts,sourceHash:ref.sourceSha256,
      reviewStatus:ref.reviewStatus}:{status:'not_loaded',counts:null});}
    catch(e){return json(res,{status:'invalid_reference',reason:String(e.message).slice(0,110)},503);}
  }
  // This is an authenticated read-only transfer for the EXISTING outbound-only
  // Cloudflare bridge. The source JSON is never committed to the public repo.
  if(req.method==='POST'&&path==='/api/process-reference/snapshot'){
    try{
      const ref=await loadOemProcessReference();
      if(!ref)return json(res,{status:'not_loaded',sourceHash:null,counts:null,
        processNames:[],roles:[],prevalences:[],edgeRows:[]});
      return json(res,{status:'loaded',sourceHash:ref.sourceSha256,counts:ref.counts,
        processNames:ref.processNames,
        roles:['primary shaping','secondary','joining','finishing','assembly'],
        prevalences:['dominant','common','occasional'],
        edgeRows:ref.nodes.filter(n=>n.level===3).map(n=>({
          code:n.code,links:ref.decode(n.code,{max:80}).map(p=>({
            name:p.name,role:p.role,prevalence:p.prevalence,
            materialContext:p.materialContext}))}))});
    }catch(e){return json(res,{error:'OEM process reference unavailable',
      reason:String(e.message).slice(0,120)},503);}
  }
  if(req.method==='GET'&&path==='/api/report')return json(res,state.report||{error:'No finished research run'},state.report?200:404);
  if(req.method==='GET'&&path==='/api/business')
    return json(res,{business:state.report?buildBusinessView(state.report,state.osSnapshot):null,
      osSnapshot:state.osSnapshot?{company:state.osSnapshot.company,source:state.osSnapshot.source}:null});
  if(req.method==='GET'&&path==='/api/os/template')
    return send(res,JSON.stringify(osSnapshotTemplate(),null,2),200,{
      'Content-Type':'application/json; charset=utf-8',
      'Content-Disposition':'attachment; filename="os-snapshot-template.json"'});
  if(req.method==='GET'&&path==='/api/os/handoff'){
    if(!state.report)return json(res,{error:'No research handoff is available yet'},404);
    return send(res,JSON.stringify(buildBusinessView(state.report).handoff,null,2),200,{
      'Content-Type':'application/json; charset=utf-8',
      'Content-Disposition':'attachment; filename="product-insights-os-candidates.json"'});
  }
  if(req.method==='POST'&&path==='/api/os/snapshot'){
    if(state.busy)return json(res,{error:'Cannot change OS snapshot during research'},409);
    if(!String(req.headers['content-type']||'').startsWith('application/json'))
      return json(res,{error:'Expected JSON company export'},415);
    const next=normalizeOsSnapshot(JSON.parse(await readBody(req,180000)));
    state.osSnapshot=next;
    return json(res,{ok:true,osSnapshot:{company:next.company,source:next.source},
      business:state.report?buildBusinessView(state.report,state.osSnapshot):null});
  }
  if(req.method==='POST'&&path==='/api/os/clear'){
    if(state.busy)return json(res,{error:'Cannot change OS snapshot during research'},409);
    state.osSnapshot=null;
    return json(res,{ok:true,osSnapshot:null,
      business:state.report?buildBusinessView(state.report):null});
  }
  if(req.method==='GET'&&path==='/api/export'){
    if(!state.report)return json(res,{error:'No research report yet'},404);
    return send(res,JSON.stringify(state.report,null,2),200,{'Content-Type':'application/json; charset=utf-8','Content-Disposition':'attachment; filename="insidejob-local-research.json"'});
  }
  if(req.method==='POST'&&path==='/api/taxonomy/master-preview'){
    const data=JSON.parse(await readBody(req,4500));
    const input=Array.isArray(data?.keywords)?data.keywords.slice(0,15):[];
    const words=[...new Set(input.map(x=>String(x||'').toLowerCase().replace(/[^a-z0-9]+/g,'').slice(0,38))
      .filter(x=>x.length>=3))];
    if(!masterTaxonomy?.nodes?.length)return json(res,{status:'not_loaded',totalNodes:0,anchors:[]});
    const scored=masterTaxonomy.nodes.map(n=>{
      const label=String(n.label||'').toLowerCase(),path=String(n.path||'').toLowerCase();
      const points=words.reduce((sum,w)=>sum+(label.includes(w)?3:0)+(path.includes(w)?1:0),0);
      return {node:n,points};
    }).filter(x=>x.points>0).sort((a,b)=>b.points-a.points||a.node.level-b.node.level);
    return json(res,{status:'installed',source:'original_master_local_read_only',
      totalNodes:masterTaxonomy.manifest.totalNodes,nodeHash:masterTaxonomy.manifest.nodeHash,
      anchors:scored.slice(0,80).map(({node:n})=>({code:n.code,label:n.label,path:n.path,level:n.level})),
      selectedOnly:true,masterModified:false});
  }
  if(req.method==='GET'&&path==='/api/stage2/parents'){
    return json(res,{parents:taxonomyNodes.filter(n=>n.level<=2).map(n=>({code:n.code,label:n.label,path:n.path,level:n.level}))});
  }
  if(req.method==='POST'&&path==='/api/stage2/manual-proposal'){
    if(state.busy)return json(res,{error:'Cannot propose taxonomy edits during research'},409);
    if(!masterTaxonomy||!state.report)return json(res,{error:'Install a taxonomy and research a company first'},409);
    const body=JSON.parse(await readBody(req,3000));
    const product=(state.report.families||[]).find(p=>p.leadId===body.leadId);
    if(!product||product.taxonomy.status!=='gap_or_insufficient_evidence')return json(res,{error:'Select an unmapped product FAMILY from the latest research report'},400);
    const kind=body.kind==='alias'?'alias':'new_node',label=String(body.label||'').trim();
    const reason=String(body.reason||'').trim();
    if(label.length<4||label.length>150||reason.length<15||reason.length>500)return json(res,{error:'Label must be 4-150 characters, and rationale 15-500'},400);
    if(!product.quote||String(product.quote).length<12)return json(res,{error:'No sufficient quoted source evidence for this gap'},400);
    const node=taxonomyNodes.find(n=>n.code===(kind==='alias'?body.existingCode:body.parentCode));
    if(!node||(kind==='alias'?node.level<2:node.level>2))return json(res,{error:'Choose a valid existing parent (L0-L2) or alias target (L2-L3)'},400);
    const supported=(state.report.pages||[]).some(p=>p.url===product.sourceUrl&&(
      [String(p.aiText||p.snippet||''),String(p.title||''),...(p.headings||[])]
        .some(text=>text.toLowerCase().replace(/\s+/g,' ').includes(String(product.quote).toLowerCase().replace(/\s+/g,' ')))||
      (p.structuredProducts||[]).some(found=>found.name.toLowerCase().replace(/\s+/g,' ').trim()===String(product.quote).toLowerCase().replace(/\s+/g,' ').trim())
    ));
    if(!supported)
      return json(res,{error:'Evidence quote cannot be located on the sampled source page'},400);
    const proposed={kind,label,reason,productName:product.name,sourceUrl:product.sourceUrl,quote:product.quote,
      parentCode:kind==='new_node'?node.code:null,existingCode:kind==='alias'?node.code:null,source:'manual_presenter_proposal'};
    const result=await enqueueTaxonomyProposals([proposed],{baseNodeHash:masterTaxonomy.manifest.nodeHash});
    return json(res,{ok:true,...result});
  }
  if(req.method==='GET'&&path==='/api/stage2/proposals')return json(res,{...(await listTaxonomyProposals()),
    aiConfigured:aiSettings.configured,localEditionVersion:workingEdition?.version||0,
    taxonomySource,taxonomyNodeCount:taxonomyNodes.length});
  if(req.method==='GET'&&path==='/api/stage2/taxonomy/export'){
    if(!workingEdition)return json(res,{error:'No locally published working edition yet'},404);
    return send(res,JSON.stringify(workingEdition,null,2),200,{'Content-Type':'application/json; charset=utf-8',
      'Content-Disposition':'attachment; filename="insidejob-taxonomy-working-edition.json"'});
  }
  if(req.method==='POST'&&path==='/api/stage2/review'){
    if(state.busy)return json(res,{error:'Cannot approve taxonomy during research'},409);
    const body=JSON.parse(await readBody(req,3000));
    const reviewed=await reviewTaxonomyProposal({id:body.id,decision:body.decision,reason:body.reason||''});
    return json(res,{ok:true,proposal:reviewed});
  }
  if(req.method==='POST'&&path==='/api/stage2/publish'){
    if(state.busy)return json(res,{error:'Cannot publish taxonomy during research'},409);
    if(!masterTaxonomy)return json(res,{error:'Install the original taxonomy first'},409);
    const result=await publishApprovedTaxonomy(masterTaxonomy);
    await activateWorkingTaxonomy();
    state.report=null;
    return json(res,{ok:true,...result});
  }
  // Local authenticated read-only snapshot for the protected Cloudflare viewer.
  // Uses original master, never the AI working edition; no file paths or secrets.
  if(req.method==='POST'&&path==='/api/taxonomy/master-snapshot'){
    if(!masterTaxonomy?.nodes?.length)return json(res,{status:'not_loaded',nodes:[],totalNodes:0,nodeHash:null});
    const master=masterTaxonomy;
    return json(res,{status:'installed',totalNodes:master.nodes.length,
      nodeHash:master.manifest.nodeHash,sourceName:master.manifest.sourceName,
      nodes:master.nodes.map(n=>({code:n.code,label:n.label,path:n.path,level:n.level})),
      masterModified:false});
  }
  if(req.method==='GET'&&path==='/api/taxonomy/manifest')return json(res,{loaded:taxonomyNodes.length>0,source:taxonomySource,manifest:taxonomyManifest});
  if(req.method==='GET'&&path==='/api/taxonomy'){
    const q=(u.searchParams.get('q')||'').toLowerCase().trim();
    return json(res,{count:taxonomyNodes.length,results:q?taxonomyNodes.filter(n=>n.label.toLowerCase().includes(q)||n.code.toLowerCase().includes(q)).slice(0,20):[]});
  }
  if(req.method==='POST'&&path==='/api/taxonomy'){
    if(state.busy)return json(res,{error:'Cannot change taxonomy during research'},409);
    if(!String(req.headers['content-type']||'').startsWith('text/plain'))return json(res,{error:'Expected plain-text taxonomy file'},415);
    const content=await readBody(req,7_000_000);
    const {nodes,manifest}=await installTaxonomy(content,{fileName:req.headers['x-taxonomy-name']});
    taxonomyNodes=nodes;taxonomyManifest=manifest;taxonomySource='installed_local_file';masterTaxonomy={nodes,manifest};await activateWorkingTaxonomy();
    state.report=null;
    return json(res,{ok:true,nodeCount:taxonomyNodes.length,source:taxonomySource,manifest});
  }
  if(req.method==='POST'&&path==='/api/cancel'){
    state.cancel=true;return json(res,{ok:true,cancelRequested:state.busy});
  }
  if(req.method==='POST'&&path==='/api/run'){
    if(state.busy)return json(res,{error:'One research run at a time'},409);
    if(!String(req.headers['content-type']||'').startsWith('application/json'))return json(res,{error:'Expected JSON'},415);
    const body=JSON.parse(await readBody(req,5000));
    if(!body||typeof body.url!=='string'||body.url.length>2048)return json(res,{error:'Public website URL required'},400);
    state.busy=true;state.phase='researching';state.cancel=false;state.lastError=null;state.report=null;state.events=[];
    try{
      const report=await runJob(body);state.report=report;state.phase=report.status;
      return json(res,{ok:true,report,business:buildBusinessView(report,state.osSnapshot)});
    }catch(e){state.lastError=String(e?.message||e);state.phase='failed';return json(res,{error:state.lastError},400);}
    finally{state.busy=false;}
  }
  return json(res,{error:'Not found'},404);
}
await loadOptionalTaxonomy().catch(e=>{process.stderr.write('Taxonomy could not be loaded; running without it: '+e.message+'\n');});
const server=createServer((req,res)=>handler(req,res).catch(e=>json(res,{error:String(e?.message||e).slice(0,240)},400)));
server.requestTimeout=180_000;
server.listen(port,host,()=>process.stdout.write(`InsideJob Research Lab: http://${host}:${port}\nLocal only. New domains are preflighted per run; Cloudflare allowlists are unchanged.\n`));