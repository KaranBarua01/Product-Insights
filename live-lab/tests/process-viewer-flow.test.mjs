import test from 'node:test';
import assert from 'node:assert/strict';
import worker,{LabSession} from '../src/worker.js';
import {sanitizeProcessReference,sanitizeResearchGraph,sanitizeCompleted} from '../src/protocol.js';

const processHash='23e6b05bedf44a02206903ddd6126128abe1c31a131e6bc812b60c3084d89aa8';
const host='example.com',origin='https://product-insights-viewer.example.workers.dev';
const agent='process-agent-test-secret-1234567890',viewer='process-viewer-test-secret-1234567890';
const companyURL='https://example.com/',sourceURL='https://example.com/products/fixture';
function fakeMaster(){
 const nodes=[];let leaf=0;
 for(let i=0;i<8;i++)nodes.push({code:'sector_'+i,label:'Sector '+i,path:'Sector '+i,level:0});
 for(let i=0;i<30;i++)nodes.push({code:'industry_'+i,label:'Industry '+i,path:'Sector 0 > Industry '+i,level:1});
 for(let i=0;i<171;i++)nodes.push({code:'system_'+i,label:'System '+i,path:'Sector 0 > Industry 0 > System '+i,level:2});
 for(let i=0;i<1004;i++)nodes.push({code:'parts_'+i,label:'Fixture '+i,path:'Sector 0 > Industry 0 > System 0 > Fixture '+i,level:3});
 return {status:'installed',totalNodes:nodes.length,nodeHash:'e'.repeat(64),sourceName:'local-code-oem.json',nodes};
}
function fakeProcesses(){
 const processNames=Array.from({length:220},(_,i)=>'Process '+i);
 return {schemaVersion:'pi-oem-process-snapshot/v1',status:'loaded',
   sourceHash:processHash,counts:{nodes:1213,leaves:1004,processes:220,links:10388},
   processNames,roles:['primary shaping','secondary','joining','finishing','assembly'],
   prevalences:['dominant','common','occasional'],
   edgeRows:Array.from({length:1004},(_,i)=>[
    'parts_'+i,Array.from({length:i<348?11:10},(_,j)=>[j%220,j%5,j%3,null])])};
}
function storage(){
 const db=new Map();return {
   get:async key=>db.get(key),put:async(key,value)=>db.set(key,value),
   transaction:async fn=>fn({get:async key=>db.get(key),
     put:async(key,value)=>db.set(key,value)})};
}
function setup(){
 const s=new LabSession({storage:storage()},{ALLOWED_TEST_HOSTS:host});
 const env={LAB_VIEW_KEY:viewer,LAB_AGENT_KEY:agent,ALLOWED_TEST_HOSTS:host,
   LAB_STATE:{idFromName:()=> 'lab',get:()=>({fetch:req=>s.fetch(req)})}};
 const request=(path,key,method='GET',body)=>worker.fetch(new Request(origin+path,{
   method,headers:{authorization:'Bearer '+key,...(body?{'Content-Type':'application/json'}:{})},
   body:body?JSON.stringify(body):undefined}),env,{waitUntil:()=>{}});
 return {request,s};
}
function smallGraph(){
 const ids=['company:'+'a'.repeat(18),'product:'+'b'.repeat(18),
   'part:'+'c'.repeat(18),'process:'+'d'.repeat(18)];
 return {schemaVersion:'pi-research-relationship-graph/v1',
   company:{host,url:companyURL,name:'Example Fixtures'},
   originalMasterModified:false,osWritePerformed:false,
   nodes:[{id:ids[0],kind:'company',label:'Example Fixtures'},
     {id:ids[1],kind:'product',label:'Fixture 1',sourceUrl:sourceURL,
       status:'observed_website_product_candidate'},
     {id:ids[2],kind:'part',label:'Fixture Mounting Bracket',
       sourceUrl:sourceURL,evidenceQuote:'Includes a mounting bracket',
       status:'source_mentioned_component_or_accessory'},
     {id:ids[3],kind:'process',label:'Laser Cutting',status:'unreviewed_process_type'}],
   links:[{from:ids[0],to:ids[1],relation:'company_website_lists_product',status:'observed_candidate'},
     {from:ids[1],to:ids[2],relation:'possible_part_or_accessory',
       status:'unverified',sourceQuote:'Includes a mounting bracket'},
     {from:ids[2],to:ids[3],relation:'possible_manufacturing_process',
       status:'hypothesis_not_company_capability',
       basis:'illustrative_part_shape_rule',referenceCode:null},
     {from:ids[1],to:'original:parts_0',relation:'proposed_existing_taxonomy_mapping',
       status:'needs_review'}],
   mappings:[{product:'Fixture 1',item:'Fixture 1',kind:'product',sourceUrl:sourceURL,
     targetCode:'parts_0',targetLabel:'Fixture 0',method:'read_only_original'}],
   gaps:[],counts:{products:1,observedParts:1,materials:0,processHypotheses:1}};
}
test('complete read-only process snapshot sanitizer enforces 1,213 + 220 + 10,388 and rejects tampering',()=>{
 const good=fakeProcesses(),sanitized=sanitizeProcessReference(good);
 assert.equal(sanitized.counts.processes,220);
 assert.equal(sanitized.counts.links,10388);
 assert.equal(sanitized.edgeRows.length,1004);
 assert.throws(()=>sanitizeProcessReference({...good,sourceHash:'f'.repeat(64)}),/pinned uploaded/);
 assert.throws(()=>sanitizeProcessReference({...good,edgeRows:good.edgeRows.slice(1)}),/pinned uploaded/);
 const corrupt=fakeProcesses();corrupt.edgeRows[0][1][0][0]=9999;
 assert.throws(()=>sanitizeProcessReference(corrupt),/Invalid coded process edge/);
});
test('browser can select original L3 node and see process priors; no public unauthenticated taxonomy',async()=>{
 const {request}=setup();
 const process=fakeProcesses(),master=fakeMaster();
 assert.equal((await request('/api/original-processes?code=parts_0',viewer)).status,404);
 assert.equal((await request('/api/agent/original-processes',agent,'POST',{snapshot:process})).status,409);
 assert.equal((await request('/api/agent/original-taxonomy',agent,'POST',{snapshot:master})).status,200);
 assert.equal((await request('/api/agent/original-processes',viewer,'POST',{snapshot:process})).status,401);
 const installed=await request('/api/agent/original-processes',agent,'POST',{snapshot:process});
 assert.equal(installed.status,200);
 assert.equal((await installed.json()).links,10388);
 const data=await (await request('/api/original-processes?code=parts_0',viewer)).json();
 assert.equal(data.code,'parts_0');
 assert.equal(data.processCount,11);
 assert.equal(data.processes[0].status,'unreviewed_taxonomy_process_hypothesis');
 assert.equal((await request('/api/original-processes?code=parts_0',agent)).status,401);
 assert.equal((await request('/api/original-processes?code=parts_0','not-a-key')).status,401);
 assert.equal((await request('/api/original-processes?code=%2e%2e%2fetc',viewer)).status,400);
});
test('research graph and cumulative working edition remain visible after actual Worker session flow',async()=>{
 const {request}=setup();
 const graph=smallGraph();
 const data={report:{
   requestedUrl:companyURL,status:'completed',
   pages:[{url:sourceURL,status:'completed',title:'Fixture',strategy:'S01'}],
   coverage:{visitedPages:1},productIntelligence:{products:[
     {name:'Fixture 1',sourceUrl:sourceURL,
       components:[{value:'Fixture Mounting Bracket',
         evidence:{sourceUrl:sourceURL,quote:'Includes a mounting bracket'}}]}]},
   researchGraph:graph,
   editionSummary:{schemaVersion:'pi-ai-working-edition-json/v1',version:3,
     totals:{companies:2,products:4,parts:5,materials:2,
       processHypotheses:6,taxonomyMappings:3,gaps:2}},
   relationshipAi:{status:'hypotheses_proposed',attemptedProducts:1,hypotheses:1},
   lab:{ollama:{status:'ready',model:'qwen3:4b-instruct'}}},
   business:{company:{name:'Example Fixtures',website:companyURL}}};
 const sanitized=sanitizeCompleted(data,host);
 assert.equal(sanitized.researchGraph.counts.processCandidates,1);
 assert.equal(sanitized.localEdition.totals.companies,2);
 assert.equal(sanitized.researchGraph.originalMasterModified,false);
 assert.equal((await request('/api/agent/heartbeat',agent,'POST',{})).status,200);
 const created=await request('/api/runs',viewer,'POST',{url:companyURL,maxPages:3});
 assert.equal(created.status,200);
 const createdData=await created.json();
 const next=await (await request('/api/agent/next',agent,'POST',{})).json();
 assert.equal(next.job.id,createdData.run.id);
 const completed=await request('/api/agent/finish',agent,'POST',{
   id:next.job.id,status:'completed',result:sanitized});
 assert.equal(completed.status,200);
 const view=await (await request('/api/runs/'+next.job.id,viewer)).json();
 assert.equal(view.localWorking.counts.processCandidates,1);
 assert.equal(view.localWorking.counts.parts,1);
 assert.equal(view.localEdition.totals.companies,2);
 assert.ok(view.localWorking.links.some(x=>x.relation==='possible_manufacturing_process'));
 assert.equal(view.localWorking.originalMasterModified,false);
});
