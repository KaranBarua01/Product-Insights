import test from 'node:test';
import assert from 'node:assert/strict';
import {buildLaptopWorkingGraph} from '../src/local-working-graph.js';

const src='https://1up-usa.com/product/heavy-duty';
const reference={status:'installed',totalNodes:2,nodeHash:'b'.repeat(64),nodes:[
  {code:'OEM-A',label:'Bicycle Racks',path:'Transportation > Bicycle Racks',level:2},
  {code:'OEM-B',label:'Automotive',path:'Transportation > Automotive',level:2}
]};
const facts={technical:{localOllama:{model:'qwen3:4b-instruct'}},productIntelligence:{products:[{
  name:'Heavy Duty',sourceUrl:src,
  components:[{value:'hitch bar lock',evidence:{sourceUrl:src,quote:'included Hitch Bar Lock'}},
    {value:'hitch bar lock',evidence:{sourceUrl:src,quote:'included Hitch Bar Lock'}}],
  materials:[{value:'aluminum',evidence:{sourceUrl:src,quote:'made entirely from aluminum'}}],
  taxonomy:{suggestions:[{code:'OEM-A',method:'ollama_selected_from_existing_candidates_unverified'},
    {code:'FAKE-CODE',method:'invented'}]}
}]}};
test('source candidates form a graph using only known original taxonomy target codes',()=>{
  const source=structuredClone(facts),original=structuredClone(reference);
  const graph=buildLaptopWorkingGraph(source,original);
  assert.equal(graph.counts.products,1);
  assert.equal(graph.counts.parts,1,'repeated component references deduplicated');
  assert.equal(graph.counts.materials,1);
  assert.equal(graph.counts.mappings,1);
  assert.equal(graph.mappings[0].targetCode,'OEM-A');
  assert.equal(graph.links.find(x=>x.to==='original:OEM-A')?.relation,'proposed_taxonomy_mapping');
  assert.equal(graph.links.some(x=>x.to==='original:FAKE-CODE'),false);
  assert.equal(graph.counts.processCandidates,0);
  assert.equal(graph.originalMasterModified,false);
  assert.equal(graph.osWritePerformed,false);
  assert.deepEqual(facts,source);
  assert.deepEqual(reference,original);
});
test('no original installed still produces the source-grounded product/part/material hierarchy',()=>{
 const graph=buildLaptopWorkingGraph(facts,{status:'not_loaded',nodes:[],totalNodes:0});
 assert.equal(graph.originalReference.status,'not_loaded');
 assert.equal(graph.counts.products,1);assert.equal(graph.counts.parts,1);
 assert.equal(graph.counts.mappings,0);assert.equal(graph.unmappedProducts,1);
});
test('model or missing evidence cannot create fabricated parts or process relationships',()=>{
 const data={productIntelligence:{products:[{name:'Heavy Duty',sourceUrl:src,
   components:[{value:'imagined titanium frame',evidence:{quote:''}}],
   materials:[{value:'titanium',evidence:null}],
   taxonomy:{suggestions:[]}}]}};
 const graph=buildLaptopWorkingGraph(data,reference);
 assert.equal(graph.counts.products,1);assert.equal(graph.counts.parts,0);
 assert.equal(graph.counts.materials,0);assert.equal(graph.counts.processCandidates,0);
});
