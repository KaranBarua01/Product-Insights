import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validatePublicUrl,normalizeAllowedHosts,assertAllowed,robotsAllowed,fetchBounded} from '../dist/safety.js';
import {parseHtml} from '../dist/html.js';
import {chooseStrategy} from '../dist/router.js';
import {extract} from '../dist/engine.js';
import worker from '../dist/worker.js';
const URL='https://manufacturer.com/products';
const html=`<!doctype html><html><head><title>Industrial Pumps | Example</title><meta name="description" content="Pump housings and machinery"><script type="application/ld+json">{"@type":"Product","name":"Pump A"}</script><script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{"sku":"ABC-10"}}}</script></head><body><main><h1>Industrial Pump Housings</h1><p>Custom cast iron pump housings for industrial applications.</p><a href="/products/pump-a">View Pump A</a><a href="/catalog.pdf">Technical PDF</a></main></body></html>`;
const r=(body,status=200,type='text/html')=>new Response(body,{status,headers:{'content-type':type}});
const pageFetcher=async url=>String(url).endsWith('/robots.txt')?r('User-agent: *\nAllow: /\n',200,'text/plain'):r(html);
const policy={allowedHosts:['manufacturer.com']};
function assessments(items){return {assessments:items.map(([patternId,status])=>({patternId,status}))};}

test('host policy blocks private/credential/IP/unapproved inputs',()=>{
  for(const candidate of ['http://127.0.0.1/','http://user:pass@manufacturer.com/','file:///etc/passwd','http://localhost/','https://foo.internal/','https://example.com:8080/']) assert.throws(()=>validatePublicUrl(candidate));
  assert.deepEqual(normalizeAllowedHosts('manufacturer.com,sub.manufacturer.com,manufacturer.com'),['manufacturer.com','sub.manufacturer.com']);
  assert.throws(()=>assertAllowed(URL,[]));
  assert.throws(()=>assertAllowed('https://other-company.com/',policy.allowedHosts));
  assert.equal(assertAllowed(URL,policy.allowedHosts).hostname,'manufacturer.com');
});
test('robots honors longest rule and user agent scope',()=>{
  const rules='User-agent: *\nDisallow: /private\nAllow: /private/open\nUser-agent: OtherBot\nDisallow: /';
  assert.equal(robotsAllowed(rules,'/private/data'),false);
  assert.equal(robotsAllowed(rules,'/private/open'),true);
  assert.equal(robotsAllowed(rules,'/products'),true);
});
test('HTTP limits reject external redirects and oversized body',async()=>{
  await assert.rejects(()=>fetchBounded(URL,policy.allowedHosts,async()=>r('redirect',302,'text/plain') /* no location */,{timeoutMs:1000,maxBytes:1000}),/Redirect without Location/);
  await assert.rejects(()=>fetchBounded(URL,policy.allowedHosts,async()=>new Response('',{status:302,headers:{Location:'https://evil.com/'}}),{timeoutMs:1000,maxBytes:1000}),/Host not on ALLOWED_HOSTS|Cross-host redirect/);
  await assert.rejects(()=>fetchBounded(URL,policy.allowedHosts,async()=>r('X'.repeat(2000)),{timeoutMs:1000,maxBytes:100}),/byte limit/);
});
test('S01 HTML parser extracts title, linked PDFs, JSON-LD, and embedded Next state',()=>{
  const p=parseHtml(html,URL);assert.match(p.content.title,/Industrial Pumps/);
  assert.match(p.content.text,/Custom cast iron pump housings/);
  assert.equal(p.content.jsonLd[0].name,'Pump A');
  assert.equal(p.content.appState[0].props.pageProps.sku,'ABC-10');
  assert.equal(p.content.documents[0],'https://manufacturer.com/catalog.pdf');
  assert.ok(p.evidence.some(e=>e.locator.includes('ld+json')));
});
test('router uses pattern signals and does not misread hydration alone',()=>{
  assert.equal(chooseStrategy({url:URL,patternAnalysis:assessments([['R04','lead'],['R07','lead']])}).strategy,'S02');
  assert.equal(chooseStrategy({url:URL,patternAnalysis:assessments([['R03','observed'],['R07','lead']])}).strategy,'S01');
  assert.equal(chooseStrategy({url:'https://manufacturer.com/catalog.pdf'}).strategy,'S03');
  assert.equal(chooseStrategy({url:URL,mode:'S03'}).strategy,'S03');
});
test('S01 end-to-end runs after robots check with provenance',async()=>{
  const v=await extract({url:URL},{fetcher:pageFetcher},policy);
  assert.equal(v.status,'completed');assert.equal(v.strategy,'S01');
  assert.equal(v.content.jsonLd[0].name,'Pump A');assert.equal(v.attempts.length,1);
  assert.equal(v.evidence[0].method,'S01');
});
test('robots disallow stops extraction before data fetch',async()=>{
  let calls=0;const fetcher=async url=>{calls++;return r('User-agent: *\nDisallow: /products',200,'text/plain')};
  const v=await extract({url:URL},{fetcher},policy);
  assert.equal(v.status,'blocked');assert.equal(v.attempts.length,0);assert.equal(calls,1);
});
test('S02 handles browser rendering when adapter is injected',async()=>{
  const content='<html><title>Dynamic Catalog</title><main><h1>Industrial CNC catalog</h1><p>Dynamic products loaded by JavaScript in a browser.</p></main></html>';
  const v=await extract({url:URL,patternAnalysis:assessments([['R04','lead'],['N11','lead']])},{fetcher:pageFetcher,browser:async()=>({url:URL,html:content})},policy,'supplied');
  assert.equal(v.status,'completed');assert.equal(v.strategy,'S02');assert.match(v.content.text,/Dynamic products/);
  assert.equal(v.routing.provenance,'supplied');
});
test('auto mode falls back from unavailable browser to S01',async()=>{
  const v=await extract({url:URL,patternAnalysis:assessments([['R04','lead'],['R07','lead']])},{fetcher:pageFetcher},policy,'supplied');
  assert.equal(v.strategy,'S01');assert.equal(v.attempts.length,2);assert.equal(v.attempts[0].status,'unsupported');
});
test('thin HTML can upgrade to S02 only if browser yields more text',async()=>{
  const thin=async url=>String(url).endsWith('/robots.txt')?r('User-agent: *\nAllow: /',200,'text/plain'):r('<html><body><div id="root"></div></body></html>');
  const v=await extract({url:URL},{fetcher:thin,browser:async()=>({url:URL,html:'<html><main><h1>Product database</h1><p>Detailed pump model data available after browser rendering.</p></main></html>'})},policy);
  assert.equal(v.strategy,'S02');assert.equal(v.attempts.length,2);
});
test('S03 extracts page-level text through bounded parser and records evidence',async()=>{
  const bytes=new TextEncoder().encode('%PDF-1.4\nmock data');
  const fetcher=async url=>String(url).endsWith('robots.txt')?r('',404,'text/plain'):r(bytes,200,'application/pdf');
  const v=await extract({url:'https://manufacturer.com/catalog.pdf'}, {fetcher,pdfParser:async()=>({pageCount:1,pages:[{page:1,text:'Pump housing dimensions and ductile iron materials are listed.'}]})},policy);
  assert.equal(v.status,'completed');assert.equal(v.strategy,'S03');assert.match(v.content.text,/ductile iron/);assert.equal(v.evidence[0].locator,'PDF page 1');
});
test('S03 flags scanned PDF as needing OCR, never fabricates text',async()=>{
  const bytes=new TextEncoder().encode('%PDF-1.4\nmock');
  const fetcher=async url=>String(url).endsWith('robots.txt')?r('',404,'text/plain'):r(bytes,200,'application/pdf');
  const v=await extract({url:'https://manufacturer.com/catalog.pdf'}, {fetcher,pdfParser:async()=>({pageCount:1,pages:[{page:1,text:''}]})},policy);
  assert.equal(v.status,'needs_ocr');assert.ok(v.warnings.some(w=>w.includes('OCR not configured')));
});
test('S01 delegates actual PDF response to S03 in auto mode',async()=>{
  const bytes=new TextEncoder().encode('%PDF-1.4\nmock');
  const fetcher=async url=>String(url).endsWith('robots.txt')?r('',404,'text/plain'):r(bytes,200,'application/pdf');
  const v=await extract({url:URL},{fetcher,pdfParser:async()=>({pageCount:1,pages:[{page:1,text:'Machining catalog. Metal turning, milling, cutting.'}]})},policy);
  assert.equal(v.status,'completed');assert.equal(v.strategy,'S03');assert.equal(v.attempts.length,2);
});
test('Worker requires token, allowlist, and supports strategy metadata',async()=>{
  const env={SCRAPPERS_API_TOKEN:'secret',ALLOWED_HOSTS:'manufacturer.com'};
  const make=(token)=>new Request('https://worker.com/api/extract',{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify({url:URL})});
  assert.equal((await worker.fetch(make(),env)).status,401);
  assert.equal((await worker.fetch(make('secret'),{SCRAPPERS_API_TOKEN:'secret'})).status,400);
  const metadata=await worker.fetch(new Request('https://worker.com/api/strategies'),env);assert.equal(metadata.status,200);
  assert.ok((await metadata.json()).strategies.S03.includes('PDF'));
});
