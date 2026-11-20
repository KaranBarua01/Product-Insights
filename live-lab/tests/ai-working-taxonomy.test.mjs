import test from 'node:test';
import assert from 'node:assert/strict';
import {Script} from 'node:vm';
import {uiHtml,uiJs} from '../src/ui.js';
import {promptFor,normalizeProposals,resultFromModel,runEnrichment,workingTaxonomy,jsSections,SCHEMA}
  from '../src/ai-enrichment.js';
import {sanitizeCompleted} from '../src/protocol.js';
import {pageTitleCandidates} from '../src/page-title-recovery.js';
import {LabSession} from '../src/worker.js';

const website='https://1up-usa.com/';
const facts=()=>{
 const p='https://1up-usa.com/product/heavy-duty';
 return sanitizeCompleted({
  report:{requestedUrl:website,status:'sampled',coverage:{visitedPages:3},
   pages:[{url:website,status:'completed',strategy:'S01'},
          {url:p,status:'completed',strategy:'S02'}],
   productIntelligence:{
    company:{name:'1UP USA',roleCandidate:{primaryRole:'manufacturer'}},
    categories:[{id:'cat-rack',name:'Hitch Bike Racks',sourceUrl:p}],
    products:[{name:'Heavy Duty',sourceUrl:p,categoryIds:['cat-rack'],
      materials:[{material:'aluminum',evidence:{sourceUrl:p,quote:'Made from aluminum'}}],
      specifications:[{attribute:'load',value:'65 lbs',evidence:{sourceUrl:p,quote:'Capacity 65 lbs'}}],
      components:[]}]
   }},
  business:{company:{name:'1UP USA',roleCandidate:'manufacturer'},
   processEvidence:{claims:[]}},
  taxonomyReference:{status:'installed',totalNodes:1213,
   nodeHash:'a'.repeat(64),
   anchors:[{code:'OEM-123',label:'Hitch Bike Racks',path:'Transportation > Bicycle Accessories > Hitch Bike Racks',level:2}]}
 },'1up-usa.com');
};
const raw={
 hypotheticalProducts:[{name:'Mountain bike cargo rack',basedOnCategory:'Hitch Bike Racks',reason:'Possible catalog type'},
   {name:'Unrelated drugs',basedOnCategory:'Pharmacy',reason:'Invented category'}],
 items:[{
   productName:'Heavy Duty',
   parts:[{name:'Rack tray',reason:'Load-supporting component'},{name:'Support bracket',reason:'Possible connection'}],
   materials:[{name:'Aluminum',reason:'Common lightweight frame material'}],
   processes:[{name:'CNC machining',part:'Support bracket',reason:'Possible bracket fabrication'},
    {name:'Casting',part:'Nonexistent Impeller',reason:'This must not be retained'}]
  },{
   productName:'Mountain bike cargo rack',
   parts:[{name:'Rack rail',reason:'Potential part'}],
   materials:[],processes:[{name:'Extrusion',part:'Rack rail',reason:'Potential section manufacture'}]
  },{
   productName:'Fake company product',parts:[{name:'Unsupported product',reason:'not observed'}],
   materials:[],processes:[]
  }],
 marketHypotheses:['Bicycle transport'],supplierOpportunityHypotheses:['Potential anodizing services'],
 differentiatorHypotheses:['Possible lightweight modular design']
};
test('AI prompt uses real product/category names and bounded original taxonomy references',()=>{
 const p=promptFor(facts());
 assert.deepEqual(p.data.observedProductNames,['Heavy Duty']);
 assert.deepEqual(p.data.observedCategoryNames,['Hitch Bike Racks']);
 assert.equal(p.data.selectedOriginalTaxonomy[0].code,'OEM-123');
 assert.equal(p.data.fullOriginalNodeCount,1213);
 assert.match(p.system,/not verified|not established|not confirmed|not sourced|not actual|hypotheses/i);
});
test('AI cannot insert unsupported site products, categories or unlinked process parts',()=>{
 const p=normalizeProposals(raw,facts());
 assert.equal(p.hypotheticalProducts.length,1);
 assert.equal(p.items.length,2);
 assert.equal(p.items[0].productName,'Heavy Duty');
 assert.deepEqual(p.items[0].parts.map(x=>x.name),['Rack tray','Support bracket']);
 assert.equal(p.items[0].processes.length,1);
 assert.equal(p.items[0].processes[0].part,'Support bracket');
 assert.equal(p.items[1].productKind,'ai_hypothesis');
 assert.ok(!JSON.stringify(p).includes('Unrelated drugs'));
 assert.ok(!JSON.stringify(p).includes('Fake company product'));
 assert.ok(!JSON.stringify(p).includes('Nonexistent Impeller'));
});
test('run-specific working taxonomy retains exact original reference nodes and automatically adds hypotheses',()=>{
 const f=facts(),out=resultFromModel(f,{response:JSON.stringify(raw)}),t=out.workingTaxonomy;
 assert.equal(out.schemaVersion,SCHEMA);
 assert.equal(out.status,'completed');
 assert.equal(out.originalTaxonomyModified,false);
 assert.equal(out.osWritePerformed,false);
 assert.equal(t.reference.totalNodes,1213);
 assert.equal(t.reference.selectedOriginalAnchors,1);
 assert.equal(t.nodes[0].code,'OEM-123');
 assert.equal(t.nodes[0].addedByAi,false);
 assert.ok(t.newWorkingNodes>0);
 assert.ok(t.aiGeneratedNodes>=4);
 assert.ok(t.nodes.some(x=>x.kind==='part'&&x.label==='Rack tray'&&x.addedByAi));
 assert.ok(t.nodes.some(x=>x.kind==='process'&&x.label==='CNC machining'&&x.addedByAi));
 assert.ok(t.links.some(x=>x.relation==='potential_process_for'));
 assert.ok(!t.nodes.some(x=>x.code&&x.code.startsWith('ai_')));
 assert.equal(f.taxonomyReference.nodeHash,'a'.repeat(64));
});
test('JS5 potential processes never become JS6 in-house company capabilities',()=>{
 const result=resultFromModel(facts(),{response:JSON.stringify(raw)});
 assert.deepEqual(result.sections.map(x=>x.code),
  ['JS1','JS2','JS3','JS4','JS5','JS6','JS7','JS8','JS9','JS10']);
 assert.equal(result.sections[4].status,'ai_inferred');
 assert.equal(result.sections[5].status,'unknown');
 assert.equal(result.sections[6].status,'ai_inferred');
 assert.ok(result.sections.every(x=>x.verified===false));
});
test('Cloudflare Workers AI call returns normalized proposals and no approval clicks',async()=>{
 let input;
 const ai={run:async(model,parameters)=>{
  input={model,parameters};return {response:JSON.stringify(raw)};
 }};
 const result=await runEnrichment({AI:ai},facts());
 assert.equal(result.status,'completed');
 assert.ok(input.model.startsWith('@cf/meta/'));
 assert.equal(input.parameters.response_format.type,'json_schema');
 assert.ok(input.parameters.response_format.json_schema.properties.items);
 assert.ok(input.model.includes('llama-3.3-70b'));
 assert.equal(result.noHumanApprovalRequiredForWorkingOverlay,true);
 assert.equal(result.workingTaxonomy.originalTaxonomyModified,false);
});
test('When no source products/categories, do not call AI or fabricate a company catalog',async()=>{
 const f=facts();f.productIntelligence.products=[];f.productIntelligence.categories=[];
 let called=false;
 const result=await runEnrichment({AI:{run:async()=>{called=true;throw Error('Should not run')}}},f);
 assert.equal(result.status,'insufficient_source_evidence');
 assert.equal(called,false);
 assert.equal(result.workingTaxonomy.aiGeneratedNodes,0);
 assert.equal(result.sections[2].status,'unknown');
});
function storage(){
 const items=new Map();
 return{get:async k=>items.get(k),transaction:async fn=>fn({
  get:async k=>items.get(k),put:async(k,v)=>items.set(k,v)})};
}
function req(path,body){
 return new Request('https://internal.lab'+path,{method:body?'POST':'GET',
  headers:body?{'Content-Type':'application/json'}:{},
  body:body?JSON.stringify(body):undefined});
}
test('Cloudflare session transitions from completed research to real AI working taxonomy, rejecting bad updates',async()=>{
 const s=new LabSession({storage:storage()},{ALLOWED_TEST_HOSTS:'1up-usa.com'});
 await s.fetch(req('/heartbeat',{}));
 const created=await(await s.fetch(req('/create',{url:website,maxPages:3}))).json();
 const id=created.run.id;
 await s.fetch(req('/next',{}));
 const finished=await s.fetch(req('/finish',{id,status:'completed',result:facts()}));
 assert.equal(finished.status,200);
 const waiting=await(await s.fetch(req('/run/'+id))).json();
 assert.equal(waiting.aiStatus,'queued');
 assert.equal(waiting.result.taxonomyReference.totalNodes,1213);
 const bad=await s.fetch(req('/enrichment',{id:'wrong',enrichment:resultFromModel(facts(),{response:JSON.stringify(raw)})}));
 assert.equal(bad.status,409);
 const added=await s.fetch(req('/enrichment',{id,enrichment:resultFromModel(facts(),{response:JSON.stringify(raw)})}));
 assert.equal(added.status,200);
 const done=await(await s.fetch(req('/run/'+id))).json();
 assert.equal(done.aiStatus,'completed');
 assert.ok(done.taxonomyNodesAdded>0);
 assert.equal(done.enrichment.originalTaxonomyModified,false);
 assert.equal(done.enrichment.sections.length,10);
 const duplicate=await s.fetch(req('/enrichment',{id,enrichment:done.enrichment}));
 assert.equal(duplicate.status,409);
});

test('Live browser UI is valid JavaScript and exposes true original vs AI taxonomy and JS1-JS10 sections',()=>{
  assert.doesNotThrow(()=>new Script(uiJs,{filename:'hosted-live-lab-ui.js'}));
  assert.match(uiHtml,/id="taxonomy-panel"/);
  assert.match(uiHtml,/id="taxonomy-graph"/);
  assert.match(uiHtml,/id="js-sections"/);
  assert.match(uiJs,/Cloudflare Workers AI|Workers AI generating/);
  assert.match(uiJs,/original taxonomy|Original taxonomy/i);
  assert.match(uiJs,/status==='ai_inferred'/);
});

test('Manuel live testing UI exposes source/review/missing states without prerecorded results',()=>{
  assert.match(uiHtml,/id="coverage-summary"/);
  assert.match(uiHtml,/id="category-list"/);
  assert.match(uiHtml,/id="product-tree"/);
  assert.match(uiHtml,/id="taxonomy-panel"/);
  assert.match(uiHtml,/id="js-sections"/);
  assert.match(uiHtml,/id="source-list"/);
  assert.match(uiHtml,/id="technical"/);
  assert.match(uiHtml,/id="run-form"/);
  assert.match(uiHtml,/id="history"/);
  assert.match(uiHtml,/id="os-note-form"/);
  assert.match(uiHtml,/Green:.*extracted with source/);
  assert.match(uiHtml,/Amber:.*needs human review/);
  assert.match(uiHtml,/Red:.*couldn.t bring this out/);
  assert.match(uiJs,/function renderState\(\)/);
  assert.match(uiJs,/function drawBusiness\(run\)/);
  assert.match(uiJs,/function drawTechnical\(run\)/);
  assert.match(uiJs,/function sectionTone\(status\)/);
  assert.match(uiJs,/sectionTone\(s.status\)/);
  assert.match(uiJs,/function drawSources\(r\)/);
  assert.match(uiJs,/function drawCategories\(r\)/);
  assert.match(uiJs,/function drawProcesses\(r,run\)/);
  assert.match(uiJs,/function renderState\(\)[\s\S]*?history.replaceChildren\(\)/);
  assert.doesNotMatch(uiHtml,/Aircraft Spruce/);
  assert.doesNotThrow(()=>new Script(uiJs,{filename:'new-live-testing-ui.js'}));
});

function recoveryCase(){
 const f=facts();
 f.productIntelligence.products=[];f.productIntelligence.categories=[];
 f.acquisition.pages=[
  {url:'https://1up-usa.com/',status:'completed',title:'1UP USA | Premium Racks',textChars:2100},
  {url:'https://1up-usa.com/product/heavy-duty-hitch-bike-rack',status:'completed',
    title:'Heavy Duty Hitch Bike Rack | E-Bike & RV Rated | 1UP USA',textChars:3500},
  {url:'https://1up-usa.com/product/quik-rack',status:'completed',
    title:'Quik Rack Hitch Bike Rack | 1UP USA',textChars:2100},
  {url:'https://1up-usa.com/about',status:'completed',
    title:'About Our Company',textChars:1700},
  {url:'https://evil.net/product/fake',status:'completed',
    title:'Fake Industrial Pump | Unsafe',textChars:1700},
  {url:'https://1up-usa.com/product/blocked',status:'blocked',
    title:'Blocked Secret Item',textChars:0}
 ];
 return f;
}
test('Real visited product pages can seed Cloudflare AI even with zero extracted JS2/JS3 records',async()=>{
 const f=recoveryCase(),found=pageTitleCandidates(f);
 assert.equal(found.length,2);
 assert.equal(found[0].name,'Heavy Duty Hitch Bike Rack');
 assert.equal(found[1].name,'Quik Rack Hitch Bike Rack');
 assert.ok(found.every(x=>x.sourceUrl.startsWith('https://1up-usa.com/')));
 assert.ok(!JSON.stringify(found).includes('evil.net'));
 assert.ok(!JSON.stringify(found).includes('Secret Item'));
 const model={
  hypotheticalProducts:[],
  items:[{productName:'Heavy Duty Hitch Bike Rack',
    parts:[{name:'Wheel tray',reason:'Potential wheel support'}],
    materials:[{name:'Aluminum',reason:'Possible lightweight material'}],
    processes:[{name:'CNC machining',part:'Wheel tray',reason:'Possible precision manufacturing step'}]},
   {productName:'Invented Product Never Visited',
    parts:[{name:'Unverified',reason:'Not observed'}],materials:[],processes:[]}],
  marketHypotheses:['Bicycle transportation'],
  supplierOpportunityHypotheses:['Potential aluminum machining'],
  differentiatorHypotheses:[]
 };
 let callCount=0,input;
 const result=await runEnrichment({AI:{run:async(_model,params)=>{
  callCount++;input=params;return {response:JSON.stringify(model)};
 }}},f);
 assert.equal(callCount,1,'AI must genuinely be invoked');
 assert.equal(result.status,'completed');
 assert.equal(result.aiInvoked,true);
 assert.equal(result.proposals.titleProductCandidates.length,2);
 assert.equal(result.proposals.items[0].productKind,'page_title_candidate_needs_review');
 assert.deepEqual(result.proposals.items[0].parts.map(x=>x.name),['Wheel tray']);
 assert.equal(result.sections[2].status,'ai_inferred');
 assert.equal(result.sections[4].status,'ai_inferred');
 assert.equal(result.sections[5].status,'unknown','AI process does not establish in-house capability');
 assert.ok(result.workingTaxonomy.nodes.some(x=>x.kind==='product'&&x.label==='Heavy Duty Hitch Bike Rack'&&
   x.status==='title_derived_needs_review'&&x.addedByAi===false));
 assert.ok(result.workingTaxonomy.nodes.some(x=>x.kind==='process'&&x.label==='CNC machining'&&x.addedByAi));
 assert.equal(result.workingTaxonomy.originalTaxonomyModified,false);
 assert.equal(result.osWritePerformed,false);
 assert.ok(input.messages.some(x=>x.content.includes('unverifiedPageTitleCandidates')));
 assert.ok(!JSON.stringify(result).includes('Invented Product Never Visited'));
});
test('Cloudflare session permits bounded retry of AI from stored real test, no new website crawl',async()=>{
 const s=new LabSession({storage:storage()},{ALLOWED_TEST_HOSTS:'1up-usa.com'});
 await s.fetch(req('/heartbeat',{}));
 const started=await(await s.fetch(req('/create',{url:website,maxPages:7}))).json();
 const id=started.run.id;
 await s.fetch(req('/next',{}));
 assert.equal((await s.fetch(req('/finish',{id,status:'completed',result:recoveryCase()}))).status,200);
 assert.equal((await s.fetch(req('/enrichment',{id,enrichment:{
   schemaVersion:SCHEMA,status:'insufficient_source_evidence',reason:'Old gate skipped AI'}}))).status,200);
 const retry=await s.fetch(req('/reenrich',{id}));
 assert.equal(retry.status,200);
 const j=await retry.json();
 assert.equal(j.result.acquisition.pages[1].title,'Heavy Duty Hitch Bike Rack | E-Bike & RV Rated | 1UP USA');
 const during=await(await s.fetch(req('/run/'+id))).json();
 assert.equal(during.aiStatus,'queued');
 assert.equal(during.enrichmentAttempts,1);
 assert.equal((await s.fetch(req('/reenrich',{id}))).status,409,'Cannot duplicate a running AI request');
 assert.equal((await s.fetch(req('/enrichment',{id,generation:1,enrichment:{
  schemaVersion:SCHEMA,status:'failed',reason:'Model returned no data'}}))).status,200);
 assert.equal((await s.fetch(req('/reenrich',{id}))).status,200);
 assert.equal((await s.fetch(req('/reenrich',{id}))).status,409);
 assert.equal((await(await s.fetch(req('/run/'+id))).json()).enrichmentAttempts,2);
});
test('AI retry rejects failed or evidence-free investigations without inventing a catalog',async()=>{
 const s=new LabSession({storage:storage()},{ALLOWED_TEST_HOSTS:'1up-usa.com'});
 await s.fetch(req('/heartbeat',{}));
 const started=await(await s.fetch(req('/create',{url:website,maxPages:3}))).json();
 await s.fetch(req('/next',{}));
 await s.fetch(req('/finish',{id:started.run.id,status:'failed',error:'Site blocked'}));
 assert.equal((await s.fetch(req('/reenrich',{id:started.run.id}))).status,409);
});

test('Previously queued AI request may be retried after timeout without losing real source pages',async()=>{
 const backing=storage(),s=new LabSession({storage:backing},{ALLOWED_TEST_HOSTS:'1up-usa.com'});
 await s.fetch(req('/heartbeat',{}));
 const started=await(await s.fetch(req('/create',{url:website,maxPages:7}))).json();
 const id=started.run.id;await s.fetch(req('/next',{}));
 await s.fetch(req('/finish',{id,status:'completed',result:recoveryCase()}));
 await backing.transaction(async txn=>{
  const state=await txn.get('state');
  const run=state.runs.find(x=>x.id===id);
  run.enrichment.queuedAt=Date.now()-110000;
  await txn.put('state',state);
 });
 const timed=await(await s.fetch(req('/run/'+id))).json();
 assert.equal(timed.aiStatus,'failed');
 assert.match(timed.enrichment.reason,/exceeded/);
 const response=await s.fetch(req('/reenrich',{id}));
 assert.equal(response.status,200);
 const result=await response.json();
 assert.equal(result.generation,1);
 assert.equal(result.result.acquisition.pages.length,6);
 assert.equal((await s.fetch(req('/enrichment',{id,generation:0,enrichment:{
  schemaVersion:SCHEMA,status:'failed',reason:'Late old result'}}))).status,409);
 assert.equal((await s.fetch(req('/enrichment',{id,generation:1,enrichment:{
  schemaVersion:SCHEMA,status:'failed',reason:'Attempt 1 failed'}}))).status,200);
 assert.equal((await s.fetch(req('/reenrich',{id}))).status,200);
 assert.equal((await s.fetch(req('/enrichment',{id,generation:1,enrichment:{
  schemaVersion:SCHEMA,status:'completed'}}))).status,409);
 const final=await(await s.fetch(req('/run/'+id))).json();
 assert.equal(final.enrichmentAttempts,2);
 assert.equal(final.aiStatus,'queued');
 assert.equal(final.result.acquisition.pages[1].title,'Heavy Duty Hitch Bike Rack | E-Bike & RV Rated | 1UP USA');
});
test('Hosted UI guards missing optional AI buttons in mixed-version HTML and JS',()=>{
 assert.match(uiJs,/if\(recoverButton\)/);
 assert.match(uiJs,/\$\('recover-ai'\)\?\.addEventListener/);
 assert.match(uiHtml,/id="recover-ai"/);
 assert.match(uiHtml,/app.js\?release=/);
 assert.doesNotThrow(()=>new Script(uiJs,{filename:'null-safe-live.js'}));
});
