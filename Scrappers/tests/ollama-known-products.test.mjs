import test from 'node:test';
import assert from 'node:assert/strict';
import {enrichKnownProductsWithOllama,mergeKnownProductEnrichment,
  validatedClaims,sampledEvidence} from '../tools/ollama-known-products.mjs';

const site='https://1up-usa.com/';
const p1={id:'real-1',name:'Heavy Duty',sourceUrl:'https://1up-usa.com/product/heavy-duty',
  extractionMethod:'product_page_heading',materials:[],components:[],categoryIds:[],evidence:[{quote:'Heavy Duty'}]};
const p2={id:'real-2',name:'Super Duty',sourceUrl:'https://1up-usa.com/product/super-duty',
  extractionMethod:'product_page_heading',materials:[],components:[],categoryIds:[],evidence:[{quote:'Super Duty'}]};
const pages=[
  {url:p1.sourceUrl,sourceUrl:p1.sourceUrl,status:'completed',content:{title:'Heavy Duty Bike Rack',
    headings:['Heavy Duty','Heavy Duty Bike Rack'],
    text:'The Heavy Duty Bike Rack is made entirely from aluminum. It includes security bolts and a hitch mount.'}},
  {url:p2.sourceUrl,sourceUrl:p2.sourceUrl,status:'completed',content:{title:'Super Duty Bike Rack',
    headings:['Super Duty','Super Duty Bike Rack'],
    text:'The Super Duty rack is made from aluminum and comes with mounting brackets.'}}
];
function fake(responses){
  const seen=[];
  const fetcher=async(address,opts={})=>{
    assert.ok(address.startsWith('http://127.0.0.1:11434/'),'Must use Ollama loopback only');
    seen.push({address,opts});
    const body=address.endsWith('/api/tags')
      ? {models:[{name:'qwen3:4b-instruct',size:2500000000}]}
      : {message:{content:JSON.stringify(responses.shift()||{})}};
    return {ok:true,text:async()=>JSON.stringify(body)};
  };
  return {fetcher,seen};
}
const claim=(name,quote)=>({name,quote});
test('source quote filter rejects invented claims and negated/optional components',()=>{
  const evidence='Heavy Duty includes mounting brackets. Optional titanium wheels are sold separately.';
  const c=validatedClaims([
    claim('mounting brackets','includes mounting brackets'),
    claim('steel','made of steel'),
    claim('titanium wheels','Optional titanium wheels are sold separately.')
  ],evidence,p1.sourceUrl,'component');
  assert.equal(c.accepted.length,1);
  assert.equal(c.accepted[0].component,'mounting brackets');
  assert.equal(c.rejected,2);
});
test('known product enrichment accepts evidence but never creates a new product identity',async()=>{
  const {fetcher,seen}=fake([
    {components:[claim('security bolts','includes security bolts')],
      materials:[claim('aluminum','made entirely from aluminum')]},
    {components:[],materials:[]}
  ]);
  const out=await enrichKnownProductsWithOllama({rootUrl:site,rawPages:pages,
    knownProducts:[p1,p2],fetcher});
  assert.equal(out.status,'completed');
  assert.equal(out.productsReviewed,2);
  assert.equal(out.pagesAnalyzed,2);
  assert.equal(out.acceptedClaims,2);
  assert.equal(out.enrichments[0].components[0].component,'security bolts');
  assert.equal(out.enrichments[0].materials[0].material,'aluminum');
  assert.equal(out.enrichments[1].components.length,0);
  const before={schemaVersion:'pi-product-intelligence/v1',
    company:{name:'1UP USA'},coverage:{products:2,materials:0,components:0},
    products:[p1,p2]};
  const merged=mergeKnownProductEnrichment(before,out);
  assert.equal(merged.products.length,2);
  assert.equal(merged.products[0].name,p1.name);
  assert.equal(merged.products[0].id,p1.id);
  assert.equal(merged.coverage.components,1);
  assert.equal(merged.coverage.materials,1);
  assert.equal(before.products[0].components.length,0);
  assert.equal(merged.products[0].components[0].relationship,'ai_source_mention_unverified');
  const requests=seen.filter(x=>x.address.endsWith('/api/chat'));
  assert.equal(requests.length,2);
  for(const x of requests){
    const body=JSON.parse(x.opts.body);
    assert.equal(body.stream,false);
    assert.equal(body.options.temperature,0);
    assert.ok(body.options.num_predict<=190);
    const input=JSON.parse(body.messages[1].content);
    assert.ok(input.pageText.length<=2050);
    assert.ok(!('productUrl' in input));
  }
});
test('known product enrichment does not copy evidence across distinct product pages',async()=>{
  const {fetcher}=fake([{materials:[claim('aluminum','made entirely from aluminum')],components:[]}]);
  const result=await enrichKnownProductsWithOllama({rootUrl:site,rawPages:[pages[1]],
    knownProducts:[p1,p2],fetcher});
  assert.equal(result.enrichments[0].materials.length,0);
  assert.equal(result.attempts[0].status,'no_source_page');
  assert.equal(result.enrichments[1].materials.length,0);
});
test('taxonomy codes selected by AI must be a retrieved read-only candidate',async()=>{
  const nodes=[{code:'BIKE_RACK',label:'Heavy Duty Bike Rack',path:'Transport > Heavy Duty Bike Rack',level:3}];
  const response={components:[],materials:[]};
  const {fetcher,seen}=fake([response,{matches:[{index:0,code:'FABRICATED'}]}]);
  const out=await enrichKnownProductsWithOllama({rootUrl:site,rawPages:[pages[0]],
    knownProducts:[p1],taxonomyNodes:nodes,fetcher});
  assert.ok(out.taxonomy.candidateCount>0);
  assert.equal(out.taxonomy.selectedCount,0);
  assert.equal(out.enrichments[0].taxonomy.suggestions[0].code,'BIKE_RACK');
  assert.equal(out.enrichments[0].taxonomy.suggestions[0].method,'deterministic_candidate_unverified');
  assert.equal(out.taxonomy.masterModified,false);
  assert.equal(nodes[0].code,'BIKE_RACK');
  assert.equal(seen.filter(x=>x.address.endsWith('/api/chat')).length,2);
});
test('Ollama can select only an existing taxonomy node without publication',async()=>{
  const nodes=[{code:'BIKE_RACK',label:'Heavy Duty Bike Rack',path:'Transport > Heavy Duty Bike Rack',level:3}];
  const {fetcher}=fake([{components:[],materials:[]},{matches:[{index:0,code:'BIKE_RACK'}]}]);
  const r=await enrichKnownProductsWithOllama({rootUrl:site,rawPages:[pages[0]],
    knownProducts:[p1],taxonomyNodes:nodes,fetcher});
  assert.equal(r.taxonomy.selectedCount,1);
  assert.equal(r.enrichments[0].taxonomy.status,'candidate_requires_review');
  assert.equal(r.enrichments[0].taxonomy.suggestions[0].code,'BIKE_RACK');
  assert.equal(nodes.length,1);
});
test('model unavailable preserves all deterministic products and reports missing model',async()=>{
  const r=await enrichKnownProductsWithOllama({rootUrl:site,rawPages:pages,
    knownProducts:[p1],fetcher:async()=>{throw Error('ECONNREFUSED')}});
  assert.equal(r.status,'unavailable');
  const merged=mergeKnownProductEnrichment({products:[p1],coverage:{products:1}},r);
  assert.equal(merged.products.length,1);
  assert.deepEqual(merged.products[0].components,[]);
});
test('long uninterrupted page text keeps technical evidence within CPU budget',()=>{
  const long='Navigation '.repeat(130)+'Made entirely from corrosion-resistant aluminum. Includes security bolts and mounting brackets.';
  const sample=sampledEvidence({content:{title:'Heavy Duty Rack',text:long}},'Heavy Duty');
  assert.ok(sample.sourceText.length<=2050);
  assert.ok(sample.sourceText.includes('aluminum'));
});
