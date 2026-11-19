import test from 'node:test';
import assert from 'node:assert/strict';
import {validateTarget,validateStart,allowedHosts,sanitizeEvents,sanitizeCompleted,LIVE_SCHEMA}
  from '../src/protocol.js';
import worker,{LabSession} from '../src/worker.js';

const allow='1up-usa.com,hoshizakiamerica.com,labconco.com,cmcsupply.com,phillipsmedisize.com,dronenerds.com';
const website='https://1up-usa.com/';
const json=async r=>({status:r.status,body:await r.json()});
test('only frozen approved public HTTPS websites can be requested remotely',()=>{
  const ok=validateStart({url:website,maxPages:7},allow);
  assert.equal(ok.host,'1up-usa.com');assert.equal(ok.browser,'headless');
  assert.throws(()=>validateStart({url:'http://1up-usa.com/',maxPages:7},allow),/HTTPS/);
  assert.throws(()=>validateStart({url:'https://evil.com/',maxPages:7},allow),/not approved/);
  assert.throws(()=>validateStart({url:'https://1up-usa.com.evil.net/',maxPages:7},allow),/not approved/);
  assert.throws(()=>validateStart({url:'https://user:password@1up-usa.com/',maxPages:7},allow),/credentials/);
  assert.throws(()=>validateStart({url:'https://1up-usa.com:8000/',maxPages:7},allow),/port/);
  assert.throws(()=>validateStart({url:'https://127.0.0.1/',maxPages:7},allow),/public DNS|not approved/);
  assert.throws(()=>validateStart({url:website,maxPages:500},allow),/budget/);
  assert.equal(allowedHosts(allow).size,6);
});
function research(){
 const source='https://1up-usa.com/product/heavy-duty';
 const evidence=quote=>({sourceUrl:source,quote});
 return{
  report:{
   requestedUrl:website,status:'sampled',lab:{strategy:'auto',browser:'headless',patternStatus:'not_requested'},
   coverage:{visitedPages:3},
   pages:[{url:website,status:'completed',strategy:'S01',textChars:600,title:'Home'},
      {url:source,status:'completed',strategy:'S02',title:'Heavy Duty',textChars:2700},
      {url:'https://evil.net/secret',status:'completed',strategy:'S01',title:'off host',textChars:1000}],
   productIntelligence:{
    company:{name:'1UP USA',roleCandidate:{primaryRole:'manufacturer'}},
    coverage:{products:3,categories:1,specifications:1,components:1,materials:1},
    categories:[{id:'racks',name:'Bicycle Racks',sourceUrl:'https://1up-usa.com/product-category/racks'},
      {id:'evil',name:'External',sourceUrl:'https://evil.net/products'}],
    products:[
      {name:'Heavy Duty',sku:'HD-01',sourceUrl:source,categoryIds:['racks'],
       specifications:[{attribute:'load_limit',value:'65 lbs',evidence:evidence('Up to 65 lbs')}],
       components:[{component:'tray',evidence:evidence('Tray included')}],
       materials:[{material:'aluminum',evidence:evidence('Aluminum structure')}]},
      {name:'Evil Item',sourceUrl:'https://evil.net/product/x',specifications:[],components:[],materials:[]}
    ]
   },stage2:{aiStatus:'not_configured',errors:[]}},
  business:{company:{name:'1UP USA',website,roleCandidate:'manufacturer'},
   processEvidence:{claims:[{section:'JS5',claim:'Process described by company',
      evidence:{sourceUrl:source,quote:'Source says machining'}},
      {section:'JS6',claim:'Off-host claim',
        evidence:{sourceUrl:'https://evil.net/',quote:'Unsafe external'}}]}}
 };
}
test('real local report is projected with exact source host, no BOM or processes invented',()=>{
 const r=sanitizeCompleted(research(),'1up-usa.com');
 assert.equal(r.schemaVersion,LIVE_SCHEMA);
 assert.equal(r.acquisition.pages.length,2);
 assert.equal(r.productIntelligence.products.length,1);
 assert.equal(r.productIntelligence.categories.length,1);
 const p=r.productIntelligence.products[0];
 assert.equal(p.name,'Heavy Duty');
 assert.equal(p.specs[0].value,'65 lbs');
 assert.equal(p.components[0].value,'tray');
 assert.equal(p.materials[0].value,'aluminum');
 assert.equal(p.specs[0].evidence.quote,'Up to 65 lbs');
 assert.deepEqual(p.parts,[]);assert.deepEqual(p.manufacturingProcesses,[]);
 assert.equal(r.manufacturing.claims.length,1);
 assert.equal(r.manufacturing.claims[0].section,'JS5');
 assert.equal(r.manufacturing.productManufacturingProcessStatus,'not_established');
 assert.equal(r.os.status,'not_connected');
 assert.ok(!JSON.stringify(r).includes('evil.net'));
 assert.throws(()=>sanitizeCompleted(research(),'labconco.com'),/does not match/);
});
test('progress events preserve real source statuses but drop off-host URLs',()=>{
 const e=sanitizeEvents([{status:'blocked',url:'https://1up-usa.com/private',reason:'HTTP 403'},
   {status:'source',url:'https://other.org/',reason:'off-site'}],'1up-usa.com');
 assert.equal(e[0].status,'blocked');assert.equal(e[0].url,'https://1up-usa.com/private');
 assert.equal(e[1].url,null);
});
function fakeStorage(){
 const store=new Map();
 return{get:async k=>store.get(k),transaction:async cb=>cb({
   get:async k=>store.get(k),put:async(k,value)=>store.set(k,value)})};
}
function request(path,body=null){
 return new Request('https://internal.lab'+path,{method:body?'POST':'GET',
   headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});
}
test('cloud session accepts one job, forwards to laptop, observes failures and rejects concurrency',async()=>{
 const session=new LabSession({storage:fakeStorage()},{ALLOWED_TEST_HOSTS:allow});
 const before=await json(await session.fetch(request('/create',{url:website,maxPages:3})));
 assert.equal(before.status,503,'No job without a real laptop heartbeat');
 assert.equal((await json(await session.fetch(request('/heartbeat',{})))).status,200);
 const created=await json(await session.fetch(request('/create',{url:website,maxPages:3})));
 assert.equal(created.status,200);
 const id=created.body.run.id;
 assert.equal(created.body.run.status,'queued');
 assert.equal((await json(await session.fetch(request('/create',{url:website,maxPages:3})))).status,409);
 const next=await json(await session.fetch(request('/next',{})));
 assert.equal(next.body.job.id,id);
 assert.equal(next.body.job.browser,'headless');
 assert.equal((await json(await session.fetch(request('/next',{})))).body.job,null);
 const progress=await json(await session.fetch(request('/progress',{id,events:[{
   status:'completed',url:'https://1up-usa.com/product/heavy-duty',strategy:'S02'}]})));
 assert.equal(progress.body.cancelRequested,false);
 assert.equal((await json(await session.fetch(request('/cancel',{})))).body.ok,true);
 assert.equal((await json(await session.fetch(request('/progress',{id,events:[]}))).body.cancelRequested,true);
 const failed=await json(await session.fetch(request('/finish',{id,status:'failed',error:'Access blocked'})));
 assert.equal(failed.status,200);
 const run=await json(await session.fetch(request('/run/'+id)));
 assert.equal(run.body.status,'failed');assert.equal(run.body.error,'Access blocked');
 assert.equal(run.body.events[0].strategy,'S02');
 assert.equal((await json(await session.fetch(request('/finish',{id,status:'failed'})))).status,409);
});
test('cloud session requires schema and exact host before accepting local result',async()=>{
 const session=new LabSession({storage:fakeStorage()},{ALLOWED_TEST_HOSTS:allow});
 await session.fetch(request('/heartbeat',{}));
 const created=await (await session.fetch(request('/create',{url:website,maxPages:7}))).json();
 await session.fetch(request('/next',{}));
 const id=created.run.id;
 const bad=await json(await session.fetch(request('/finish',{
   id,status:'completed',result:{schemaVersion:LIVE_SCHEMA,company:{url:'https://other.org/'}}})));
 assert.equal(bad.status,400);
 const r=sanitizeCompleted(research(),'1up-usa.com');
 const done=await json(await session.fetch(request('/finish',{id,status:'completed',result:r})));
 assert.equal(done.status,200);
 assert.equal(done.body.status,'completed');
 const actual=await (await session.fetch(request('/run/'+id))).json();
 assert.equal(actual.result.productIntelligence.products[0].name,'Heavy Duty');
});
test('Worker denies data access when a correct team or agent key is absent',async()=>{
 const env={LAB_VIEW_KEY:'viewer_key_0123456789_superlong_secret',LAB_AGENT_KEY:'agent_key_0123456789_superlong_secret',LAB_STATE:{}};
 const bad=await json(await worker.fetch(new Request('https://live.example.workers.dev/api/state'),env));
 assert.equal(bad.status,401);
 const staticPage=await worker.fetch(new Request('https://live.example.workers.dev/'),env);
 assert.equal(staticPage.status,200);
 const html=await staticPage.text();
 assert.match(html,/Product Insights/);
 assert.match(html,/Technical View/);
 assert.match(html,/Team access key/);
 const assets=await worker.fetch(new Request('https://live.example.workers.dev/assets/app.js'),env);
 assert.equal(assets.status,200);
 assert.match(await assets.text(),/laptop/);
});
