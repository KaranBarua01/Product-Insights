#!/usr/bin/env node
/**
 * Deterministic direct QA: GitHub Actions + Windows/macOS/Linux.
 * OFFLINE: test suite + temporary localhost fixture, NO external websites, NO AI.
 * LOCAL: connect to an already running localhost lab; optionally launch one
 * explicitly requested public website research run. Does not modify taxonomy.
 */
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {once} from 'node:events';
import {mkdtemp,mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import {setTimeout as sleep} from 'node:timers/promises';

const schema='insidejob-direct-qa/1';
const limit=Number(process.env.QA_HTTP_TIMEOUT_MS||12000);
const options={mode:'offline',site:null,port:8790,output:'qa-results'};
for(let i=2;i<process.argv.length;i++){
  const arg=process.argv[i];
  if(arg==='--mode'&&process.argv[i+1])options.mode=process.argv[++i];
  else if(arg==='--site'&&process.argv[i+1])options.site=process.argv[++i];
  else if(arg==='--port'&&process.argv[i+1])options.port=Number(process.argv[++i]);
  else if(arg==='--out'&&process.argv[i+1])options.output=process.argv[++i];
  else if(arg==='--help'){process.stdout.write('Usage: node tools/direct-qa.mjs --mode offline|local [--site https://example.com/] [--port 8790] [--out DIR]\n');process.exit(0);}
  else throw Error('Unknown or incomplete argument: '+arg);
}
if(!['offline','local'].includes(options.mode)||!Number.isInteger(options.port)||options.port<1024||options.port>65535)throw Error('Invalid mode or port');
function checkPublicUrl(value){
  const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password||u.port||u.hostname.length<4||!u.hostname.includes('.'))throw Error('Only plain public HTTPS website URLs are accepted');
  if(u.hostname==='localhost'||u.hostname.endsWith('.local')||/^(?:127|10|192\.168|169\.254)\./.test(u.hostname)||/^(?:172\.(?:1[6-9]|2\d|3[01]))\./.test(u.hostname))throw Error('Private website URLs are not allowed');
  if(u.pathname.length>1024||u.href.length>1800)throw Error('Website URL exceeds length budget');
  return u.href;
}
if(options.site){options.site=checkPublicUrl(options.site);if(options.mode!=='local')throw Error('--site is allowed only in local mode');}
const result={schemaVersion:schema,generatedAt:new Date().toISOString(),mode:options.mode,site:options.site,
  outcomes:[],measurements:{},caveats:['Unit tests and HTTP smoke tests do not establish manufacturing intelligence accuracy.',
    'Model claims, taxonomy suggestions and source pages require human review.'],
  overall:'NOT_TESTED'};
const record=(id,status,detail,data={})=>{result.outcomes.push({id,status,detail,...data});process.stdout.write(id+' '+status+' '+detail+'\n')};
function boundedResponse(url,init={},bytes=300000,timeout=limit){
  return fetch(url,{...init,redirect:'error',signal:AbortSignal.timeout(timeout)}).then(async r=>{
    const declared=Number(r.headers.get('content-length')||0);
    if(declared>bytes)throw Error('HTTP body exceeds byte budget');
    const raw=await r.text();if(raw.length>bytes)throw Error('HTTP body exceeds byte budget');
    return {status:r.status,ok:r.ok,text:raw,headers:r.headers};
  });
}
async function freePort(){
  const server=createServer();server.listen(0,'127.0.0.1');await once(server,'listening');
  const p=server.address().port;server.close();await once(server,'close');return p;
}
async function runTests(){
  const child=spawn(process.platform==='win32'?'npm.cmd':'npm',['test'],{cwd:resolve('.'),shell:process.platform==='win32',env:{...process.env,NO_COLOR:'1'},stdio:['ignore','pipe','pipe']});
  let output='';for(const stream of [child.stdout,child.stderr])stream.on('data',x=>{output=(output+x.toString()).slice(-50000)});
  const timer=setTimeout(()=>child.kill(),180000);
  const [exitCode]=await once(child,'exit');clearTimeout(timer);
  const match=output.match(/(?:ℹ\s*)?tests\s+(\d+)[\s\S]*?(?:ℹ\s*)?pass\s+(\d+)[\s\S]*?(?:ℹ\s*)?fail\s+(\d+)/);
  const counts=match?{tests:Number(match[1]),passed:Number(match[2]),failed:Number(match[3])}:{};
  record('UNIT_SUITE',exitCode===0?'PASS':'FAIL','Existing Scrappers tests'+(counts.tests===undefined?'':': '+counts.passed+'/'+counts.tests+' passed'),{...counts,exitCode,diagnostic:exitCode===0?null:output.slice(-1800)});
  result.measurements.testSuite=counts;
}
async function offline(){
  await runTests();
  const dir=await mkdtemp(join(tmpdir(),'insidejob-direct-qa-'));
  const taxfile=join(dir,'qa-taxonomy.json');
  await writeFile(taxfile,JSON.stringify([{code:'qa_industrial',label:'Industrial',
    children:[{code:'qa_equipment',label:'Equipment',children:[{code:'qa_machines',label:'Machines',
      children:[{code:'qa_pumps',label:'Pumps'}]}]}]}]));
  let child,stdout='';
  try{
    const port=await freePort();
    const base='http://127.0.0.1:'+port;
    child=spawn(process.execPath,[resolve('tools/research-lab.mjs')],{cwd:resolve('.'),
      env:{...process.env,RESEARCH_LAB_PORT:String(port),RESEARCH_LAB_TAXONOMY_FILE:taxfile,RESEARCH_LAB_STAGE2_DIR:join(dir,'stage2'),RESEARCH_LAB_AI_URL:'',RESEARCH_LAB_AI_TOKEN:''},
      stdio:['ignore','pipe','pipe']});
    child.stdout.on('data',x=>stdout=(stdout+x.toString()).slice(-7000));
    child.stderr.on('data',x=>stdout=(stdout+x.toString()).slice(-7000));
    let health;
    for(let i=0;i<70;i++){
      if(child.exitCode!==null)break;
      try{const r=await boundedResponse(base+'/health',{},15000,2000);if(r.ok){health=JSON.parse(r.text);break;}}catch{}
      await sleep(120);
    }
    if(!health){record('LOCAL_START','FAIL','Lab not reachable. '+stdout.slice(-300));return;}
    record('LOCAL_START','PASS','Lab started on isolated loopback port '+port);
    record('TAXONOMY_FIXTURE',health.taxonomyLoaded===4?'PASS':'FAIL',
      'Expected a 4-node disposable taxonomy, observed '+health.taxonomyLoaded);
    record('AI_OFFLINE',health.stage2AiConfigured===false?'PASS':'FAIL','Offline mode does not activate Cloudflare AI');
    const parents=await boundedResponse(base+'/api/stage2/parents');
    const parsed=JSON.parse(parents.text);
    record('TAXONOMY_PARENTS',parents.ok&&parsed.parents?.length===3?'PASS':'FAIL','Parent lookup from fixture');
    const proposals=await boundedResponse(base+'/api/stage2/proposals');
    const queue=JSON.parse(proposals.text);
    record('REVIEW_QUEUE',proposals.ok&&Array.isArray(queue.proposals)?'PASS':'FAIL',
      'Local review queue endpoint responds (may contain independent existing local proposals)');
    const denied=await boundedResponse(base+'/api/stage2/publish',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
    record('REVIEW_AUTH',denied.status===403?'PASS':'FAIL','Unauthenticated taxonomy publication denied (HTTP '+denied.status+')');
  }finally{
    if(child&&child.exitCode===null){const exit=once(child,'exit');child.kill();await Promise.race([exit,sleep(2000)]);}
    await rm(dir,{recursive:true,force:true});
  }
}
async function local(){
  const base='http://127.0.0.1:'+options.port;
  let health;
  try{const response=await boundedResponse(base+'/health',{},16000);
    if(!response.ok)throw Error('HTTP '+response.status);health=JSON.parse(response.text);
    record('LOCAL_RUNNING','PASS','Connected to '+base);
    result.measurements.health={taxonomyLoaded:health.taxonomyLoaded,stage2AiConfigured:health.stage2AiConfigured,localEditionVersion:health.localEditionVersion};
    record('TAXONOMY_INSTALLED',health.taxonomyLoaded>1000?'PASS':health.taxonomyLoaded>0?'PARTIAL':'NOT_CONFIGURED',
      'Installed taxonomy nodes: '+health.taxonomyLoaded+' (benchmark reference expects 1213)');
    record('CLOUDFLARE_AI',health.stage2AiConfigured?'CONFIGURED_NOT_VALIDATED':'NOT_CONFIGURED',
      health.stage2AiConfigured?'PC has an AI endpoint configured; actual model execution requires a research run':'Cloudflare AI is not enabled on this PC');
  }catch(e){record('LOCAL_RUNNING','FAIL','Start npm run lab before local QA: '+String(e.message||e));return;}
  if(!options.site){record('WEBSITE_RUN','NOT_REQUESTED','Specify --site URL for a single permitted live run');return;}
  // This is a deliberately explicit operation; never crawl a default list from CI.
  const homepage=await boundedResponse(base+'/',{},100000);
  const token=homepage.text.match(/<meta name="lab-token" content="([a-f0-9]{64})"/)?.[1];
  if(homepage.status!==200||!token){record('LOCAL_AUTH','FAIL','Could not find local session token');return;}
  const body={url:options.site,maxPages:4,strategy:'auto',browser:'headless'};
  let response;
  try{
    response=await boundedResponse(base+'/api/run',{
      method:'POST',headers:{'x-lab-token':token,'Origin':base,'Content-Type':'application/json'},body:JSON.stringify(body)
    },1200000,120000);
  }catch(e){record('WEBSITE_RUN','FAIL','Local run request failed: '+String(e.message||e));return;}
  let parsed;try{parsed=JSON.parse(response.text);}catch{record('WEBSITE_RUN','FAIL','Invalid JSON response');return;}
  if(!response.ok){record('WEBSITE_RUN','BLOCKED_OR_FAILED','Research refused HTTP '+response.status+'; '+String(parsed.error||'').slice(0,150));return;}
  const report=parsed.report;
  if(!report||!Array.isArray(report.pages)){record('WEBSITE_RUN','FAIL','Expected a research report');return;}
  const coverage=report.coverage||{},stage2=report.stage2||{};
  const pages=report.pages.map(p=>({url:p.url,status:p.status,strategy:p.strategy,textChars:p.textChars}));
  result.measurements.live={requestedUrl:report.requestedUrl,status:report.status,
    pagesVisited:coverage.visitedPages,products:coverage.productLeads??coverage.structuredProducts,
    candidateFamilies:coverage.productFamilies||0,
    unmappedProductRecords:coverage.unmappedProductRecords||0,
    companyRole:report.companyRole||{status:'unknown',primaryRole:'unknown',evidence:[]},
    familyNames:(report.families||[]).slice(0,30).map(f=>({name:f.name,leadCount:f.memberCount,taxonomyStatus:f.taxonomy?.status,
      sourceUrls:f.sourceUrls?.slice(0,4)||[]})),
    taxonomyAssessed:coverage.taxonomyAssessed??false,
    taxonomyCandidates:coverage.taxonomyCandidates,taxonomyGaps:coverage.taxonomyGaps,
    aiStatus:stage2.aiStatus||'not_available',proposalStatus:stage2.taxonomyProposalStatus||'not_available',
    proposalCount:stage2.proposals?.length||0,pages,
    warnings:(report.warnings||[]).slice(0,20)};
  record('WEBSITE_RUN',pages.some(p=>p.status==='completed')?'PARTIAL':'BLOCKED_OR_FAILED',
    pages.length+' page(s) processed; bounded extraction is not catalog verification');
  record('PRODUCT_LEADS',coverage.productLeads>0?'PARTIAL':'NOT_ASSESSED',
    String(coverage.productLeads??0)+' candidate leads; no independent precision label');
  const familyCount=report.families?.length||0;
  record('FAMILY_GROUPING',familyCount>0&&familyCount<=report.products?.length?'PARTIAL':'NOT_ASSESSED',
    familyCount+' provisional families from '+String(report.products?.length||0)+' candidate product records; not human validated');
  record('COMPANY_ROLE',report.companyRole?.status==='candidate_requires_review'?'PARTIAL':'NOT_ASSESSED',
    'Role: '+String(report.companyRole?.primaryRole||'unknown')+'; evidence quotes: '+String(report.companyRole?.evidence?.length||0));
  record('TAXONOMY_MAPPING',coverage.taxonomyAssessed?'PARTIAL':'NOT_ASSESSED',
    'Mapping and gap counts must not be interpreted as validated categories');
  if(health.stage2AiConfigured)record('CLOUDFLARE_EXECUTION',stage2.aiStatus==='proposed'?'PARTIAL':'NOT_VERIFIED',
    'Observed AI research status: '+String(stage2.aiStatus||'missing'));
}
function htmlEscape(v){return String(v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function reportHtml(x){
  return '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>InsideJob Direct QA</title>'+
  '<style>body{font:15px/1.55 system-ui,sans-serif;max-width:1050px;margin:35px auto;padding:0 24px;color:#27384b}h1{font-size:26px}table{width:100%;border-collapse:collapse}th,td{padding:12px;border-bottom:1px solid #d7e2ed;text-align:left;vertical-align:top}th{background:#f3f6fa}small{color:#5d7184}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f4f6fa;padding:18px;border-radius:8px}</style>'+
  '<h1>InsideJob · Direct QA</h1><p><strong>'+htmlEscape(x.overall)+'</strong> · '+htmlEscape(x.generatedAt)+' · Mode '+htmlEscape(x.mode)+'</p><table><thead><tr><th>Test</th><th>Outcome</th><th>Evidence / Limit</th></tr></thead><tbody>'+
  x.outcomes.map(y=>'<tr><td>'+htmlEscape(y.id)+'</td><td>'+htmlEscape(y.status)+'</td><td>'+htmlEscape(y.detail)+'</td></tr>').join('')+
  '</tbody></table><h2>Measurements</h2><pre>'+htmlEscape(JSON.stringify(x.measurements,null,2))+'</pre><h2>Interpretation</h2><p>'+
  x.caveats.map(htmlEscape).join(' ')+'</p></html>';
}
try{if(options.mode==='offline')await offline();else await local();}
catch(e){record('HARNESS','FAIL',String(e?.stack||e).slice(0,800));}
result.overall=result.outcomes.some(x=>x.status==='FAIL')?'FAIL':
  result.outcomes.some(x=>['PARTIAL','BLOCKED_OR_FAILED','NOT_ASSESSED','NOT_CONFIGURED','NOT_VERIFIED'].includes(x.status))?'PARTIAL':'PASS';
const out=resolve(options.output);await mkdir(out,{recursive:true});
await Promise.all([writeFile(join(out,'summary.json'),JSON.stringify(result,null,2)),writeFile(join(out,'index.html'),reportHtml(result))]);
process.stdout.write('QA report: '+join(out,'index.html')+'\nJSON: '+join(out,'summary.json')+'\n');
if(result.overall==='FAIL')process.exitCode=1;
