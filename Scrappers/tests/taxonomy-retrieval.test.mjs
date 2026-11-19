import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {rankEvidenceTaxonomy} from '../tools/taxonomy-retrieval.mjs';
import {mapStage2Products} from '../tools/research-stage2.mjs';
import {scoreTaxonomyCases,probeTaxonomyRows,parseLocalJson} from '../tools/taxonomy-benchmark.mjs';

const fixture=JSON.parse(await readFile(new URL('../benchmark/taxonomy-fixtures.synthetic.json',import.meta.url),'utf8'));

test('evidence retrieval ranks the intended leaf across six product sectors',()=>{
  const positives=fixture.cases.filter(x=>x.expectedCode);
  for(const item of positives){
    const candidates=rankEvidenceTaxonomy(item,fixture.nodes);
    assert.equal(candidates[0]?.code,item.expectedCode,item.id+': '+JSON.stringify(candidates));
    assert.ok(candidates.every(c=>c.method==='evidence_hierarchy_lexical'&&c.scoreMeaning.includes('not_probability')));
    assert.ok(candidates.every(c=>c.path&&c.level>=2));
  }
});
test('abstains on slogans, navigation sections and unrelated source quotations',()=>{
  for(const item of fixture.cases.filter(x=>!x.expectedCode))
    assert.deepEqual(rankEvidenceTaxonomy(item,fixture.nodes),[],item.id);
});
test('vehicle-mounted bicycle rack does not become bicycle frame, truck transmission, solar or server rack',()=>{
  const item=fixture.cases.find(x=>x.id==='bike-1');
  const results=rankEvidenceTaxonomy(item,fixture.nodes,{limit:10});
  assert.deepEqual(results.map(x=>x.code),['demo-cargo']);
});
test('quoted name is necessary; no category promoted from generic page copy',()=>{
  assert.deepEqual(rankEvidenceTaxonomy({name:'Super Duty',quote:'Our bicycle rack is hitch mounted on vehicles.'},fixture.nodes),[]);
  assert.deepEqual(rankEvidenceTaxonomy({name:'Super Duty',quote:'Super Duty'},fixture.nodes),[]);
});
test('does not suggest root categories and respects candidate limit',()=>{
  const item=fixture.cases.find(x=>x.id==='bike-1');
  assert.deepEqual(rankEvidenceTaxonomy(item,[{code:'root',level:1,label:'Bicycle racks',path:'Mobility > Bicycle racks'}]),[]);
  assert.ok(rankEvidenceTaxonomy(item,fixture.nodes,{limit:1}).length<=1);
});
test('Stage 2 uses evidence hierarchy candidates but never marks them verified',()=>{
  const item=fixture.cases.find(x=>x.id==='bike-1');
  const product={name:item.name,quote:item.quote,sourceUrl:'https://example.org/products/heavy-duty'};
  const mapped=mapStage2Products([product],fixture.nodes)[0];
  assert.equal(mapped.taxonomy.status,'candidate_requires_review');
  assert.equal(mapped.taxonomy.suggestions[0].code,'demo-cargo');
  assert.equal(mapped.taxonomy.suggestions[0].scoreMeaning,'relative_retrieval_score_not_probability');
});
test('local benchmark counts positives, abstentions and wrong-domain errors',()=>{
  const d=scoreTaxonomyCases(fixture.cases,fixture.nodes);
  assert.equal(d.positiveCases,17);
  assert.equal(d.top1Hits,17);
  assert.equal(d.negativeCases,7);
  assert.equal(d.negativeAbstentions,7);
  assert.equal(d.taxonomyLeavesSearched,14);
});

test('long quoted descriptions cannot turn transported bikes or rail luggage racks into the product class',()=>{
  const item=fixture.cases.find(x=>x.id==='later-bicycle-frames-and-rail-decoy');
  assert.deepEqual(rankEvidenceTaxonomy(item,fixture.nodes,{limit:10}).map(x=>x.code),['demo-cargo']);
});

test('originally failing steering/battery/instrument decoys cannot outrank bike carriers',()=>{
  const item=fixture.cases.find(x=>x.id==='cross-country-irrelevant-to-cross-car');
  assert.deepEqual(rankEvidenceTaxonomy(item,fixture.nodes,{limit:10}).map(x=>x.code),['demo-cargo']);
  const accessory=fixture.cases.find(x=>x.id==='addon-compatibility-not-base');
  assert.deepEqual(rankEvidenceTaxonomy(accessory,fixture.nodes),[]);
});
test('real steering, battery tray, and instrument panel products remain retrievable',()=>{
  for(const id of ['steering-not-bicycle','battery-not-bike-tray','vehicle-instrument']){
    const item=fixture.cases.find(x=>x.id===id);
    assert.equal(rankEvidenceTaxonomy(item,fixture.nodes)[0]?.code,item.expectedCode,id);
  }
});

test('unlabeled evidence probe reports candidate rankings without accuracy claims',()=>{
  const one=fixture.cases.find(x=>x.id==='bike-1');
  const report=probeTaxonomyRows([{family:one.name,evidence:one.quote,sourceUrl:'https://example.test/bike'},
    {family:'Heavy Duty Add-On',evidence:'Heavy Duty Add-On tray expands the carrying capacity of your Quik Rack and Super Duty racks for more bikes.'}],fixture.nodes);
  assert.equal(report.status,'unlabeled_retrieval_probe_not_accuracy');
  assert.equal(report.candidateProducts,1);
  assert.equal(report.abstentions,1);
  assert.equal(report.results[0].topCode,'demo-cargo');
  assert.equal(report.results[1].topCode,null);
});

test('aircraft sector evidence alone cannot classify a drone as wire harnesses or an airframe',()=>{
  const item=fixture.cases.find(x=>x.id==='alta-x-cannot-be-aircraft-wire-harness');
  const results=rankEvidenceTaxonomy(item,fixture.nodes,{limit:10});
  assert.deepEqual(results,[],'Unqualified aircraft context must not invent component type');
});
test('quoted electrical aircraft harness retains correct classification',()=>{
  const item=fixture.cases.find(x=>x.id==='real-aircraft-wire-harness-still-matches');
  assert.equal(rankEvidenceTaxonomy(item,fixture.nodes)[0]?.code,'demo-aircraft-harness');
});

test('Windows PowerShell UTF-8 BOM does not break local evidence JSON',()=>{
  assert.deepEqual(parseLocalJson('\uFEFF{"rows":[]}'),{rows:[]});
});
