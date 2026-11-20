import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createOemProcessReference,loadOemProcessReference} from '../tools/oem-process-reference.mjs';
import {buildResearchGraph} from '../tools/research-relationship-graph.mjs';
import {proposePartHypotheses} from '../tools/ollama-relationships.mjs';
import {appendResearchEdition,readResearchEdition,publicEditionSummary} from '../tools/research-edition-store.mjs';

const PROCESS=['Laser Cutting','Press Brake Bending','Metal Stamping','Turning',
 'Tube & Pipe Bending','Tube Laser Cutting','Tube & Pipe Fabrication'];
const referenceData={schemaVersion:'pi-oem-industry-taxonomy/code-v0.5',processRoles:[
 'primary shaping','secondary','joining','finishing','assembly'],
 processPrevalence:['dominant','common','occasional'],sourceSha256:'a'.repeat(64),
 DATA:[{code:'l0_test',label:'Fixtures',children:[{code:'fixture_test',label:'Fixtures & Accessories',
   children:[{code:'mounting_parts',label:'Mounting Parts',children:[
     {code:'mounting_parts__mounting_brackets',label:'Mounting Brackets'},
     {code:'mounting_parts__steel_tubes',label:'Steel Tubes'}]}]}]}],
 EDGES:{p:PROCESS,e:{
   mounting_parts__mounting_brackets:[[0,0,0],[1,1,1],[2,1,2]],
   mounting_parts__steel_tubes:[[4,0,0],[5,1,1],[6,1,1]]}}};
const ref=createOemProcessReference(referenceData);
const input={companyName:'Fixture Products Inc',companyUrl:'https://example.com',
 products:[{name:'Fixture Rack 200',sourceUrl:'https://example.com/fixture',
   taxonomy:{suggestions:[{code:'mounting_parts__mounting_brackets',method:'review'}]},
   components:[{value:'Mounting Brackets',evidence:{quote:'Includes two Mounting Brackets for installation.',sourceUrl:'https://example.com/fixture'}},
     {value:'aluminum tubing',evidence:{quote:'Includes aluminum tubing.',sourceUrl:'https://example.com/fixture'}}],
   materials:[{value:'aluminum',evidence:{quote:'Aluminum construction.',sourceUrl:'https://example.com/fixture'}}]}],
 processReference:ref};

test('code-only reference rejects invalid process indices and maps exact leaf codes',()=>{
 assert.equal(ref.counts.nodes,5);assert.equal(ref.counts.processes,7);
 assert.equal(ref.decode('mounting_parts__mounting_brackets',{max:9}).length,3);
 assert.equal(ref.decode('does_not_exist').length,0);
 assert.equal(ref.candidates('Mounting Brackets')[0].code,'mounting_parts__mounting_brackets');
 assert.ok(ref.advisoryRules('aluminum tubing').some(x=>x.name==='Tube & Pipe Bending'));
 assert.throws(()=>createOemProcessReference({...referenceData,EDGES:{...referenceData.EDGES,
  e:{...referenceData.EDGES.e,mounting_parts__steel_tubes:[[999,1,2]]}}}),/Invalid process edge/);
});
test('company/product/part/material/process graph contains only original code candidates and review labels',()=>{
 const original=structuredClone(referenceData);
 const graph=buildResearchGraph(input);
 assert.equal(graph.counts.companies,1);
 assert.equal(graph.counts.products,1);
 assert.equal(graph.counts.observedParts,2);
 assert.equal(graph.counts.materials,1);
 assert.ok(graph.counts.processHypotheses>=3);
 assert.ok(graph.links.some(x=>x.relation==='company_website_lists_product'&&x.status==='observed_candidate'));
 assert.ok(graph.links.some(x=>x.relation==='possible_manufacturing_process'&&
   x.status==='hypothesis_not_company_capability'));
 assert.ok(graph.links.some(x=>x.to==='original:mounting_parts__mounting_brackets'));
 assert.ok(graph.nodes.some(x=>x.kind==='part'&&x.evidenceQuote.includes('Mounting Brackets')));
 assert.equal(graph.originalMasterModified,false);assert.equal(graph.osWritePerformed,false);
 assert.deepEqual(referenceData,original);
});
test('unmapped products and parts remain explicit; no invented OEM classification code',()=>{
 const graph=buildResearchGraph({companyName:'Other',companyUrl:'https://example.org',
   products:[{name:'Invented Outlandish Thing',sourceUrl:'https://example.org/p',
      components:[{value:'titanium special body',evidence:{
       quote:'made with titanium special body',sourceUrl:'https://example.org/p'}}],
      taxonomy:{suggestions:[{code:'FAKE',method:'invented'}]}}],
   processReference:ref});
 assert.equal(graph.counts.unmappedProducts,1);
 assert.equal(graph.counts.unmappedParts,1);
 assert.equal(graph.mappings.length,0);
 assert.equal(graph.links.some(x=>x.to==='original:FAKE'),false);
});
test('optional local Ollama hypothesis validator accepts only existing product name and allowlisted process',async()=>{
 const model=async(url,options)=>({ok:true,text:async()=>JSON.stringify({message:{content:JSON.stringify({
   items:[{product:'Fixture Rack 200',parts:[{name:'Milled support bracket',
     processes:['Laser Cutting','Made-up 3D Teleporter']}]}]})}})});
 const p=await proposePartHypotheses({products:input.products,enabled:true,fetcher:model,
   processNames:PROCESS});
 assert.equal(p.status,'hypotheses_proposed');
 assert.equal(p.proposals[0].productName,'Fixture Rack 200');
 assert.deepEqual(p.proposals[0].parts[0].processes,['Laser Cutting']);
 assert.equal(p.proposals[0].parts[0].status,'ai_hypothetical_part_not_a_verified_bom');
 const none=await proposePartHypotheses({products:input.products,enabled:false,fetcher:()=>{throw Error('Must not call');}});
 assert.equal(none.status,'disabled');
});
test('append-only JSON editions accumulate companies without modifying original taxonomy',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'pi-working-'));
 const first=buildResearchGraph(input);
 const add=await appendResearchEdition(first,{directory:dir});
 assert.equal(add.added,true);assert.equal(add.version,1);
 const dup=await appendResearchEdition(first,{directory:dir});
 assert.equal(dup.added,false);assert.equal(dup.version,1);
 const second=buildResearchGraph({...input,companyName:'Company Two',companyUrl:'https://second.example',
   products:[{name:'Mounting Brackets',sourceUrl:'https://second.example/p',
     taxonomy:{suggestions:[{code:'mounting_parts__mounting_brackets'}]}}]});
 await appendResearchEdition(second,{directory:dir});
 const current=await readResearchEdition({directory:dir});
 assert.equal(current.version,2);assert.equal(current.runs.length,2);
 assert.equal(current.totals.companies,2);
 assert.ok(current.totals.candidateNodes>=2);
 assert.ok(current.totals.candidateRelations>=1);
 assert.ok(current.workingNodes.some(x=>x.kind==='part'&&x.occurrences>=1));
 assert.ok(current.workingRelations.some(x=>x.relation==='possible_manufacturing_process'));
 assert.equal(publicEditionSummary(current).candidateNodes,current.workingNodes.length);
 assert.equal(current.status,'proposals_unreviewed_no_original_mutations');
 assert.equal(publicEditionSummary(current).totals.companies,2);
 assert.equal((await readdir(join(dir,'versions'))).length,2);
 const file=await readFile(join(dir,'edition-manifest.json'),'utf8');
 assert.equal(JSON.parse(file).originalMasterModified,false);
});
test('local reference loader refuses tampered bytes in strict pinned mode',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'pi-oem-'));
 const file=join(dir,'test.json');
 const {writeFile}=await import('node:fs/promises');
 await writeFile(file,JSON.stringify(referenceData));
 await assert.rejects(()=>loadOemProcessReference({filePath:file,strict:true}),/integrity mismatch/);
 const reloaded=await loadOemProcessReference({filePath:file,strict:false});
 assert.equal(reloaded.counts.nodes,5);
});
