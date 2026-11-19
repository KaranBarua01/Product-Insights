import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {parseTaxonomy} from '../tools/research-planner.mjs';
import {stage2Config,callStage2,offlineProductLeads,stage2ParentChoices,validateAiProducts,
  combineProductLeads,mapStage2Products,stage2Analyze} from '../tools/research-stage2.mjs';
import {enqueueTaxonomyProposals,reviewTaxonomyProposal,publishApprovedTaxonomy,loadWorkingTaxonomy,
  listTaxonomyProposals} from '../tools/research-stage2-store.mjs';
import {makeManifest} from '../tools/research-taxonomy-store.mjs';

const nodes=parseTaxonomy(JSON.stringify([
  {code:'mobility',label:'Mobility',children:[{code:'bicycles',label:'Bicycles',children:[
    {code:'vehicle_accessories',label:'Vehicle Accessories',children:[{code:'bike_mount',label:'Bicycle Hitch Mounts'}]}]}]},
  {code:'home',label:'Home Appliances',children:[{code:'dishwashers',label:'Dishwashers',children:[
    {code:'dishwasher_parts',label:'Dishwasher Parts',children:[{code:'dish_racks',label:'Dishwasher Racks'}]}]}]}
]));
const base={nodes,manifest:makeManifest(nodes,{sourceName:'Test explorer',installedAt:'2026-11-18T00:00:00Z'})};
const page={url:'https://1up-usa.com/product-category/racks/hitch-bike-racks/quik-rack/',status:'completed',
  title:'Quik Rack | 1UP USA',headings:['Quik Rack Bike Rack'],aiText:'Our Quik Rack Bike Rack carries your bicycle securely. Available in several configurations.',
  snippet:'Our Quik Rack Bike Rack carries your bicycle securely.'};
const report={requestedUrl:'https://1up-usa.com/',pages:[page],products:[],coverage:{visitedPages:1,structuredProducts:0,discoveredLeads:5},
  warnings:[],limitations:[],status:'sampled'};

test('offline heading discovery finds product families but never invents Abbott services as products',()=>{
  const leads=offlineProductLeads([page,{url:'https://abbotttool.com/services/',status:'completed',title:'Machining services',
    headings:['CNC Machining'],aiText:'CNC machining and welding services are available'}]);
  assert.equal(leads.length,1);assert.equal(leads[0].kind,'product_family');
  assert.match(leads[0].quote,/Quik Rack Bike Rack/);
});
test('AI products must have a quote on their specific source page',()=>{
  const good={name:'Quik Rack Bike Rack',kind:'product_model',sourceUrl:page.url,
    quote:'Our Quik Rack Bike Rack carries your bicycle securely.'};
  const candidates=validateAiProducts([good,{...good,name:'Invented rocket',quote:'A completely fabricated claim from the webpage.'},
    {...good,sourceUrl:'https://unrelated.example/other'}],[page]);
  assert.equal(candidates.length,1);
  assert.equal(candidates[0].reviewStatus,'requires_human_verification');
});
test('approved alias yields an unverified candidate, not a verified classification',()=>{
  const product={name:'Quik Rack Bike Rack',sourceUrl:page.url};
  assert.equal(mapStage2Products([product],nodes)[0].taxonomy.status,'gap_or_insufficient_evidence');
  const p=mapStage2Products([{...product,name:'Hitch Rack'}],nodes,[{alias:'Hitch Rack',existingCode:'bike_mount'}])[0];
  assert.equal(p.taxonomy.suggestions[0].code,'bike_mount');
  assert.equal(p.taxonomy.status,'candidate_requires_review');
});
test('AI parent choices contain real taxonomy IDs only',()=>{
  const parents=stage2ParentChoices(nodes,[{name:'Quik Rack Bike Rack'}]);
  assert.ok(parents.length>0&&parents.length<=78);
  assert.ok(parents.some(p=>p.code==='mobility'));
  assert.ok(parents.every(p=>nodes.some(n=>n.code===p.code)));
});
test('unconfigured Stage 2 never calls the network',async()=>{
  assert.equal(stage2Config({}).configured,false);
  const out=await callStage2('analyze',{}, {config:stage2Config({}),fetcher:()=>{throw Error('network used');}});
  assert.equal(out.status,'not_configured');
});
test('offline Stage 2 clearly marks unanalysed JS1-JS10 and a pending taxonomy gap',async()=>{
  const enriched=await stage2Analyze(report,{nodes,client:async()=>({status:'not_configured'})});
  assert.equal(enriched.coverage.productLeads,1);
  assert.equal(enriched.coverage.taxonomyGaps,1);
  assert.equal(enriched.stage2.aiStatus,'not_configured');
  assert.equal(enriched.stage2.companyProfile,null);
});
test('review queue deduplicates AI suggestions and publishes approved nodes ONLY to working edition',async()=>{
  const folder=await mkdtemp(join(tmpdir(),'insidejob-stage2-'));
  try{
    const queuePath=join(folder,'proposals.json'),workingPath=join(folder,'working.json'),versionsDir=join(folder,'versions');
    const item={kind:'new_node',label:'Bicycle Hitch Racks',parentCode:'vehicle_accessories',existingCode:null,
      reason:'Site names a finished bicycle-transport accessory that has no appropriate class',
      quote:'Our Quik Rack Bike Rack carries your bicycle securely.',sourceUrl:page.url,productName:'Quik Rack Bike Rack'};
    const one=await enqueueTaxonomyProposals([item,item],{path:queuePath,baseNodeHash:base.manifest.nodeHash});
    assert.equal(one.added,1);
    assert.equal((await listTaxonomyProposals({path:queuePath})).proposals.length,1);
    const id=(await listTaxonomyProposals({path:queuePath})).proposals[0].id;
    await reviewTaxonomyProposal({id,decision:'approved',path:queuePath});
    const published=await publishApprovedTaxonomy(base,{queuePath,workingPath,versionsDir});
    assert.equal(published.version,1);assert.equal(published.addedNodes,1);
    const active=await loadWorkingTaxonomy(base,{path:workingPath});
    assert.equal(active.nodes.length,nodes.length+1);
    assert.equal(nodes.length,base.nodes.length);
    assert.ok(active.nodes.some(n=>n.label==='Bicycle Hitch Racks'&&n.level===3));
    assert.equal(active.edition.status,'locally_published_not_canonical');
    assert.equal((await readFile(join(versionsDir,'edition-0001.json'),'utf8')).includes('Bicycle Hitch Racks'),true);
    await assert.rejects(()=>publishApprovedTaxonomy(base,{queuePath,workingPath,versionsDir}),/No approved/);
    await assert.rejects(()=>loadWorkingTaxonomy({...base,manifest:{...base.manifest,nodeHash:'other'}},{path:workingPath}),/different installed master/);
  }finally{await rm(folder,{recursive:true,force:true});}
});
test('rejected proposal cannot publish, and a node cannot target a nonexistent parent',async()=>{
  const folder=await mkdtemp(join(tmpdir(),'insidejob-stage2-'));
  try{
    const queuePath=join(folder,'queue.json'),workingPath=join(folder,'working.json'),versionsDir=join(folder,'versions');
    const item={kind:'new_node',label:'Concrete Garden Pavers',parentCode:'not_a_real_code',existingCode:null,
      reason:'Clearly evidenced finished landscape product in this hypothetical fixture',
      quote:'Concrete Garden Pavers are manufactured for sidewalks.',sourceUrl:'https://example.com/products/pavers',
      productName:'Concrete Garden Pavers'};
    await enqueueTaxonomyProposals([item],{path:queuePath,baseNodeHash:base.manifest.nodeHash});
    const id=(await listTaxonomyProposals({path:queuePath})).proposals[0].id;
    await reviewTaxonomyProposal({id,decision:'approved',path:queuePath});
    await assert.rejects(()=>publishApprovedTaxonomy(base,{queuePath,workingPath,versionsDir}),/not a valid L0-L2/);
    assert.equal((await loadWorkingTaxonomy(base,{path:workingPath})).edition,null);
  }finally{await rm(folder,{recursive:true,force:true});}
});
