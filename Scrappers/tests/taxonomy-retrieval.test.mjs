import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {rankEvidenceTaxonomy} from '../tools/taxonomy-retrieval.mjs';
import {mapStage2Products} from '../tools/research-stage2.mjs';
import {scoreTaxonomyCases} from '../tools/taxonomy-benchmark.mjs';

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
  assert.equal(d.positiveCases,14);
  assert.equal(d.top1Hits,14);
  assert.equal(d.negativeCases,3);
  assert.equal(d.negativeAbstentions,3);
  assert.equal(d.taxonomyLeavesSearched,9);
});

test('long quoted descriptions cannot turn transported bikes or rail luggage racks into the product class',()=>{
  const item=fixture.cases.find(x=>x.id==='later-bicycle-frames-and-rail-decoy');
  assert.deepEqual(rankEvidenceTaxonomy(item,fixture.nodes,{limit:10}).map(x=>x.code),['demo-cargo']);
});
