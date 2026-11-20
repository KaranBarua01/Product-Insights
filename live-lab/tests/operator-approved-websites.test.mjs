import test from 'node:test';
import assert from 'node:assert/strict';
import {validatePublicCompanyUrl,normalizeApprovedCompanyHosts} from '../src/protocol.js';
import worker,{LabSession} from '../src/worker.js';

const viewer='operator-test-viewer-xxxxx-123456789',agent='operator-test-agent-xxxx-123456789';
const origin='https://product-insights-demo.workers.dev';
function makeStorage(){
 const map=new Map();
 return {get:async key=>map.get(key),put:async(k,v)=>map.set(k,v),
   transaction:async fn=>fn({get:async k=>map.get(k),put:async(k,v)=>map.set(k,v)})};
}
function setup(){
 const session=new LabSession({storage:makeStorage()},{ALLOWED_TEST_HOSTS:'1up-usa.com'});
 const env={LAB_VIEW_KEY:viewer,LAB_AGENT_KEY:agent,ALLOWED_TEST_HOSTS:'1up-usa.com',
   LAB_STATE:{idFromName:()=> 'team-lab',get:()=>({fetch:req=>session.fetch(req)})}};
 const call=(path,token,method='GET',body)=>worker.fetch(new Request(origin+path,{
   method,headers:{authorization:'Bearer '+token,...(body?{'content-type':'application/json'}:{})},
   body:body?JSON.stringify(body):undefined}),env);
 return {call,session};
}
test('operator-approved website parser supports arbitrary real public host syntax with strict bounds',()=>{
 assert.equal(validatePublicCompanyUrl('https://www.hammfg.com/').host,'hammfg.com');
 assert.equal(validatePublicCompanyUrl('https://www.igus.com/').host,'igus.com');
 assert.equal(validatePublicCompanyUrl('https://www.festo.com/in/en').host,'festo.com');
 assert.deepEqual(normalizeApprovedCompanyHosts(['www.igus.com','FESTO.COM','igus.com']),
   ['festo.com','igus.com']);
 for(const bad of [
   'http://www.igus.com/','https://127.0.0.1/','https://169.254.169.254/',
   'https://[::1]/','https://metadata.google.internal/','https://localhost/',
   'https://my-site.local/','https://demo.test/',
   'https://mycompany.onion/','https://user:password@example.org/',
   'https://test.com:8790/','https://foo.example.net/#fragment',
   'https://bad_name.com/']){
   assert.throws(()=>validatePublicCompanyUrl(bad),Error,bad);
 }
 assert.throws(()=>normalizeApprovedCompanyHosts(['*.company.com']),/exact public DNS/);
 assert.throws(()=>normalizeApprovedCompanyHosts(Array.from({length:46},(_,i)=>'domain'+i+'.com')),
   /Too many/);
});
test('only laptop agent can publish additional domains; viewer can only queue approved sites',async()=>{
 const {call}=setup();
 const before=await call('/api/runs',viewer,'POST',{url:'https://www.hammfg.com/',maxPages:3});
 assert.equal(before.status,400);
 assert.match((await before.json()).error,/not yet approved/);
 assert.equal((await call('/api/agent/approved-hosts',viewer,'POST',{hosts:['hammfg.com']})).status,401);
 assert.equal((await call('/api/agent/approved-hosts',agent,'POST',{hosts:['127.0.0.1']})).status,400);
 assert.equal((await call('/api/agent/heartbeat',agent,'POST',{})).status,200);
 const approved=await call('/api/agent/approved-hosts',agent,'POST',{hosts:['www.hammfg.com','www.igus.com']});
 assert.equal(approved.status,200);
 assert.equal((await approved.json()).addedHosts,2);
 const listing=await (await call('/api/approved-hosts',viewer)).json();
 assert.ok(listing.allowedHosts.includes('hammfg.com'));
 assert.ok(listing.allowedHosts.includes('igus.com'));
 assert.ok(listing.allowedHosts.includes('1up-usa.com'));
 assert.equal(listing.approvalMode,'only_the_laptop_operator_can_approve');
 const created=await call('/api/runs',viewer,'POST',{url:'https://www.hammfg.com/',maxPages:3});
 assert.equal(created.status,200);
 const job=(await created.json()).run;
 assert.equal(job.url,'https://www.hammfg.com/');
 const revoke=await call('/api/agent/approved-hosts',agent,'POST',{hosts:[]});
 assert.equal(revoke.status,200);
 const after=await call('/api/runs',viewer,'POST',{url:'https://www.igus.com/',maxPages:3});
 assert.equal(after.status,400);
 assert.match((await after.json()).error,/not yet approved/);
 assert.equal((await call('/api/approved-hosts',agent)).status,401);
});
test('deny arbitrary IP/domain even if maliciously injected into current state',async()=>{
 const {call,session}=setup();
 // Internal session route also guards against invalid user-injected approvals.
 assert.equal((await session.fetch(new Request(origin+'/approved-hosts',{
   method:'POST',body:JSON.stringify({hosts:['10.0.0.1']}),
   headers:{'content-type':'application/json'}}))).status,400);
 assert.equal((await call('/api/runs',viewer,'POST',{url:'https://10.0.0.1/',maxPages:3})).status,400);
});
