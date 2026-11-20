import test from 'node:test';
import assert from 'node:assert/strict';
import {sanitizeOriginalTaxonomy,ORIGINAL_TAXONOMY_SCHEMA} from '../src/protocol.js';
import worker,{LabSession} from '../src/worker.js';
import {uiHtml,uiJs} from '../src/ui.js';

const hash='a'.repeat(64);
const fixture={status:'installed',nodeHash:hash,sourceName:'Original OEM taxonomy.json',
  totalNodes:4,nodes:[
    {code:'O0',label:'Manufacturing',path:'Manufacturing',level:0},
    {code:'O1',label:'Transportation',path:'Manufacturing > Transportation',level:1},
    {code:'O2',label:'Bicycle Racks',path:'Manufacturing > Transportation > Bicycle Racks',level:2},
    {code:'O3',label:'Hitch Components',path:'Manufacturing > Transportation > Bicycle Racks > Hitch Components',level:3}
  ]};
const parse=r=>r.json();
function storage(){
 const db=new Map();return{get:async k=>db.get(k),transaction:async fn=>fn({
   get:async k=>db.get(k),put:async(k,v)=>db.set(k,v)})};
}
function request(path,body){
 return new Request('https://internal.lab'+path,{method:body?'POST':'GET',
   headers:body?{'content-type':'application/json'}:{},
   body:body?JSON.stringify(body):undefined});
}
test('complete source nodes remain read-only, ordered, unchanged and source identified',()=>{
 const source=structuredClone(fixture);
 const result=sanitizeOriginalTaxonomy(source);
 assert.equal(result.schemaVersion,ORIGINAL_TAXONOMY_SCHEMA);
 assert.equal(result.status,'installed');assert.equal(result.totalNodes,4);
 assert.equal(result.nodeHash,hash);assert.equal(result.masterModified,false);
 assert.deepEqual(result.nodes,fixture.nodes);
 result.nodes[0].label='Changed in transfer';
 assert.equal(source.nodes[0].label,'Manufacturing');
});
test('missing original is truthfully not loaded, not fabricated',()=>{
 const empty=sanitizeOriginalTaxonomy({status:'not_loaded'});
 assert.equal(empty.status,'not_loaded');assert.equal(empty.nodes.length,0);
 assert.equal(empty.totalNodes,0);assert.equal(empty.nodeHash,null);
});
test('invalid original data cannot enter protected cloud taxonomy storage',()=>{
 assert.throws(()=>sanitizeOriginalTaxonomy({...fixture,totalNodes:123}),/Invalid complete/);
 assert.throws(()=>sanitizeOriginalTaxonomy({...fixture,nodeHash:'not-a-hash'}),/Invalid complete/);
 assert.throws(()=>sanitizeOriginalTaxonomy({...fixture,nodes:[fixture.nodes[0],fixture.nodes[0],fixture.nodes[2],fixture.nodes[3]]}),/duplicate/);
 assert.throws(()=>sanitizeOriginalTaxonomy({...fixture,nodes:[...fixture.nodes.slice(0,3),{...fixture.nodes[3],level:12}]}),/Invalid/);
 assert.throws(()=>sanitizeOriginalTaxonomy({...fixture,nodes:[...fixture.nodes.slice(0,3),{...fixture.nodes[3],path:''}]}),/Invalid/);
});
test('Durable Object stores exact original reference and does not mix with AI working edition',async()=>{
 const session=new LabSession({storage:storage()},{});
 const before=await parse(await session.fetch(request('/original-taxonomy')));
 assert.equal(before.status,'not_loaded');
 const result=await session.fetch(request('/original-taxonomy',{snapshot:fixture}));
 assert.equal(result.status,200);
 const store=await parse(await session.fetch(request('/original-taxonomy')));
 assert.equal(store.totalNodes,4);assert.equal(store.nodes[3].code,'O3');
 assert.equal(store.masterModified,false);assert.ok(store.syncedAt);
 const wrong=await session.fetch(request('/original-taxonomy',{snapshot:{...fixture,nodeHash:'bad'}}));
 assert.equal(wrong.status,400);
 const still=await parse(await session.fetch(request('/original-taxonomy')));
 assert.equal(still.nodeHash,hash);
 assert.equal(still.nodes.length,4);
 const cleared=await session.fetch(request('/original-taxonomy',{snapshot:{status:'not_loaded'}}));
 assert.equal(cleared.status,200);
 assert.equal((await parse(await session.fetch(request('/original-taxonomy')))).status,'not_loaded');
});
test('Worker requires distinct agent permission for taxonomy sync and viewer permission to inspect it',async()=>{
 const viewKey='original-taxonomy-viewer-secret-1234567890';
 const agentKey='original-taxonomy-agent-secret-1234567890';
 const session=new LabSession({storage:storage()},{});
 const env={LAB_VIEW_KEY:viewKey,LAB_AGENT_KEY:agentKey,LAB_STATE:{
   idFromName:()=> 'team-lab',get:()=>({fetch:req=>session.fetch(req)})}};
 const origin='https://product-insights-live-lab.example.workers.dev';
 const upload=async token=>worker.fetch(new Request(origin+'/api/agent/original-taxonomy',{
   method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},
   body:JSON.stringify({snapshot:fixture})}),env);
 assert.equal((await upload(viewKey)).status,401,'View token cannot modify protected snapshot');
 assert.equal((await upload(agentKey)).status,200);
 const get=token=>worker.fetch(new Request(origin+'/api/original-taxonomy',{
   headers:{authorization:'Bearer '+token}}),env);
 assert.equal((await get('wrong')).status,401);
 assert.equal((await get(agentKey)).status,401,'Agent token cannot read the team viewer endpoint');
 const ready=await get(viewKey);
 assert.equal(ready.status,200);
 assert.equal((await parse(ready)).nodes.length,4);
});
test('sidebar actually contains Original taxonomy viewer and AI working mapping split',()=>{
 assert.match(uiHtml,/id="nav-original"/);
 assert.match(uiHtml,/id="original-taxonomy-panel"/);
 assert.match(uiHtml,/id="original-search"/);
 assert.match(uiHtml,/id="original-mappings"/);
 assert.match(uiHtml,/id="original-working"/);
 assert.match(uiJs,/\/api\/original-taxonomy/);
 assert.match(uiJs,/drawOriginalTaxonomy/);
 assert.doesNotMatch(uiJs,/fetch\(["']http:\/\/127\.0\.0\.1:8790/);
});
