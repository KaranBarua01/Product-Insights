import test from 'node:test';
import assert from 'node:assert/strict';
import {handleStage2Request} from '../dist/stage2-routes.js';

const root='https://1up-usa.com/';
const evidence='Our Quik Rack Bike Rack carries your bicycle securely.';
const pages=[{url:root,title:'1UP USA',text:'1UP USA offers bicycle racks. '+evidence+' See our full line of bike racks.'}];
const headers={authorization:'Bearer local-test-token','content-type':'application/json'};
function request(action,payload,h=headers){
  return new Request('https://sample-worker.example/api/stage2/'+action,{method:'POST',headers:h,body:JSON.stringify(payload)});
}
function stubAi(produce){
  return {run:async(_model,params)=>{
    const schema=params.response_format?.json_schema?.properties;
    return {response:produce(schema,params)};
  }};
}
test('Stage 2 endpoint requires the existing protected Worker token',async()=>{
  const env={SCRAPPERS_API_TOKEN:'local-test-token'};
  const res=await handleStage2Request(request('analyze',{rootUrl:root,pages},{}),env);
  assert.equal(res.status,401);
  assert.equal(await handleStage2Request(new Request('https://sample-worker.example/api/other'),env),null);
});
test('Stage 2 profile reuses canonical JS profile and has clear offline status',async()=>{
  const res=await handleStage2Request(request('analyze',{rootUrl:root,pages}),{SCRAPPERS_API_TOKEN:'local-test-token'});
  assert.equal(res.status,200);
  const body=await res.json();
  assert.equal(body.status,'not_configured');
  assert.equal(body.jsProfile.sections.length,10);
  assert.equal(body.jsProfile.status,'not_configured');
});
test('Stage 2 accepts only exact quotes from the correct source',async()=>{
  const env={SCRAPPERS_API_TOKEN:'local-test-token',AI:stubAi(schema=>
    schema.facts?{facts:[]}:{products:[
      {name:'Quik Rack Bike Rack',kind:'product_model',quote:evidence,sourceId:1},
      {name:'Invented Company Machine',kind:'product_model',quote:'No such machine exists in the source text',sourceId:1},
      {name:'Wrong source',kind:'product_model',quote:evidence,sourceId:2}
    ]})};
  const res=await handleStage2Request(request('analyze',{rootUrl:root,pages}),env);
  assert.equal(res.status,200);
  const body=await res.json();
  assert.equal(body.aiProducts.length,1);
  assert.equal(body.aiProducts[0].name,'Quik Rack Bike Rack');
  assert.equal(body.aiProducts[0].reviewStatus,'requires_human_verification');
  assert.equal(body.diagnostics.rejectedProductSuggestions,2);
});
test('Stage 2 planner cannot add links that were not supplied or leave the researched hostname',async()=>{
  const env={SCRAPPERS_API_TOKEN:'local-test-token',AI:stubAi(()=>({ids:[1,2,200]}))};
  const body={rootUrl:root,links:[
    {url:'https://1up-usa.com/product-category/racks/',label:'Racks'},
    {url:'https://unrelated.example/products/',label:'Other company'}]};
  const res=await handleStage2Request(request('plan',body),env);
  const out=await res.json();
  assert.deepEqual(out.prioritizedIds,[1]);
});
test('Stage 2 taxonomy agent proposes but never publishes a node',async()=>{
  const env={SCRAPPERS_API_TOKEN:'local-test-token',AI:stubAi(()=>({proposals:[
    {gapIndex:0,action:'new_node',label:'Bicycle Hitch Racks',parentCode:'mobility',existingCode:'',
      reason:'Site advertises bicycle transport hardware not represented as an existing classification'},
    {gapIndex:1,action:'new_node',label:'Fake',parentCode:'not_real',existingCode:'',
      reason:'Inventing a parent is forbidden by the supplied taxonomy'}
  ]}))};
  const res=await handleStage2Request(request('propose',{rootUrl:root,
    gaps:[{name:'Quik Rack Bike Rack',quote:evidence,sourceUrl:root}],
    parents:[{code:'mobility',path:'Mobility > Vehicles',level:1}] }),env);
  assert.equal(res.status,200);
  const out=await res.json();
  assert.equal(out.proposals.length,1);
  assert.equal(out.proposals[0].parentCode,'mobility');
  assert.equal(out.proposals[0].reviewStatus,'requires_human_approval');
});
