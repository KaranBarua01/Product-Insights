import test from 'node:test';
import assert from 'node:assert/strict';
import {analyzeHtml} from '../dist/parse.js';
import {classify,LIBRARY,frequency,exportMatrixCsv,detectorCoverage} from '../dist/patterns.js';
import {validatePublicUrl,robotsAllowed,inspectWebsite} from '../dist/inspect.js';
import worker from '../dist/index.js';
const html=`<!doctype html><html><head><title>Acme Products</title><script type="application/ld+json">{"@type":"Product","name":"Valve"}</script></head><body><nav><a href="/about-us">About us</a><a href="/products/valves">Valve products</a><a href="/catalog/specs.pdf">Datasheet</a></nav><h1>Valve systems</h1><p>${'Precision industrial valve products with reliable flow control. '.repeat(6)}</p><form action="/search"><input type="search" name="q"></form><a href="/products/valves?page=2">2</a><button>Load more</button><details><summary>Capabilities</summary><p>Precision machining with quality and dimensional checks used on every production line.</p></details></body></html>`;
const base='https://acme-machinery.com/';const at='2026-11-10T00:00:00Z';
test('research-derived library includes 34 patterns, 6 signals and 10 methods',()=>{
 const c=detectorCoverage();assert.equal(LIBRARY.length,50);assert.equal(c.sitePatterns,34);assert.equal(c.technologySignals,6);assert.equal(c.methods,10);
});
test('parser identifies catalog, JSON-LD, docs, pagination, search and details',()=>{
 const p=analyzeHtml(html,base);for(const type of ['product_link','jsonld','document_link','pagination','search_form','load_more','accordion'])assert.ok(p.signals.some(s=>s.type===type),type);
});
test('classifier distinguishes observations, leads and review-only patterns',()=>{
 const p=analyzeHtml(html,base);const result=classify([p],at);const map=Object.fromEntries(result.assessments.map(x=>[x.patternId,x]));
 assert.equal(map.I02.status,'observed');assert.equal(map.R02.status,'observed');assert.equal(map.N11.status,'lead');assert.equal(map.N09.status,'not_observed');assert.equal(map.N12.status,'observed');
 assert.equal(map.I02.evidence[0].sourceUrl,base);assert.equal(map.M01,undefined);
});
test('invalid, private, credentialed and nonstandard ports rejected',()=>{
 for(const url of ['http://127.0.0.1/','http://localhost/','http://169.254.169.254/','http://service.internal/','http://site.test/','file:///etc/passwd','https://person:password@example.com/','https://example.com:8080/'])assert.throws(()=>validatePublicUrl(url));
 assert.equal(validatePublicUrl('https://acme-machinery.com/products?id=42').search,'?id=42');
});
test('robots respects specificity and allow override',()=>{
 const rules='User-agent: *\nDisallow: /private\nAllow: /private/public\n\nUser-agent: InsideJobPatternResearch\nDisallow: /secret\n';
 assert.equal(robotsAllowed(rules,'/secret/file'),false);
 assert.equal(robotsAllowed(rules,'/private/stuff'),true);
 assert.equal(robotsAllowed('User-agent: *\nDisallow: /private\nAllow: /private/public\n','/private/something'),false);
 assert.equal(robotsAllowed('User-agent: *\nDisallow: /private\nAllow: /private/public\n','/private/public/file'),true);
});
test('frequency deduplicates latest site and excludes leads and unassessed',()=>{
 const make=(host,status,time)=>({host,createdAt:time,assessments:[{patternId:'N11',status,evidence:[],note:''}],pages:[],status:'completed'});
 const rows=frequency([make('acme.com','observed','2026-01-01'),make('acme.com','lead','2026-03-01'),make('other.com','not_observed','2026-01-01')]);
 const r=rows.find(x=>x.id==='N11');assert.equal(r.observed,0);assert.equal(r.notObserved,1);assert.equal(r.leads,1);assert.equal(r.assessed,1);assert.equal(r.prevalence,0);
});
test('bounded website inspection with mock HTTP and evidence',async()=>{
 const fetcher=async input=>{const u=String(input);if(u.endsWith('robots.txt'))return new Response('',{status:404});if(u.endsWith('/products/valves'))return new Response('<html><body><h1>Valve series</h1><table><tr><td>Technical specifications</td><td>10 MPa</td></tr></table></body></html>',{headers:{'content-type':'text/html'}});return new Response(html,{headers:{'content-type':'text/html'}});};
 const r=await inspectWebsite(base,{fetcher,maxPages:2,now:at});assert.equal(r.pages.length,2);assert.equal(r.status,'completed');assert.ok(r.assessments.find(x=>x.patternId==='I02').evidence.length);
 assert.ok(exportMatrixCsv([r]).includes('acme-machinery.com'));
});
test('blocked robots halts retrieval',async()=>{
 let requests=0;const fetcher=async()=>{requests++;return new Response('User-agent: *\nDisallow: /',{status:200,headers:{'content-type':'text/plain'}});};
 const r=await inspectWebsite(base,{fetcher});assert.equal(r.pages.length,0);assert.equal(r.status,'failed');assert.equal(requests,1);
});
test('worker reports health, patterns and protects analysis endpoint',async()=>{
 const health=await worker.fetch(new Request('https://patterns.workers.dev/health'),{});assert.equal(health.status,200);
 const library=await (await worker.fetch(new Request('https://patterns.workers.dev/api/patterns'),{})).json();assert.equal(library.patterns.length,50);
 const denied=await worker.fetch(new Request('https://patterns.workers.dev/api/analyze',{method:'POST'}),{});assert.equal(denied.status,503);
 const unauthorized=await worker.fetch(new Request('https://patterns.workers.dev/api/analyze',{method:'POST'}),{PATTERN_SYSTEM_API_TOKEN:'token'});assert.equal(unauthorized.status,401);
});
test('does not misclassify ordinary social links as catalog subdomains',()=>{
 const p=analyzeHtml('<html><body><a href="https://linkedin.com/company/acme">Our LinkedIn</a><a href="/product/catalog.pdf">Catalog PDF</a></body></html>',base);
 const a=Object.fromEntries(classify([p],at).assessments.map(x=>[x.patternId,x]));
 assert.equal(a.N05.status,'not_observed');assert.equal(a.I06.status,'observed');
});
test('detects pagination as untested lead, not confirmed iteration',()=>{
 const p=analyzeHtml('<html><body><a href="/products?page=3">3</a></body></html>',base);
 const a=Object.fromEntries(classify([p],at).assessments.map(x=>[x.patternId,x]));
 assert.equal(a.N08.status,'lead');
});
test('review candidates are not silently added to canonical patterns',()=>{
 const p=analyzeHtml('<html><body><iframe src="https://vendor.com/catalog" title="Product configurator"></iframe></body></html>',base);
 const result=classify([p],at);assert.equal(result.candidates[0]?.status,'review_required');assert.equal(LIBRARY.length,50);
});

test('N09 requires repeated routes in separate navigation menus',()=>{
 const menu='<a href="/products">Products</a><a href="/catalog">Catalog</a><a href="/about">About</a>';
 const duplicateMenus=analyzeHtml('<html><nav>'+menu+'</nav><nav class="mobile">'+menu+'</nav></html>',base);
 const oneMenu=analyzeHtml('<html><nav>'+menu+menu+'</nav></html>',base);
 const status=(page)=>classify([page],at).assessments.find(x=>x.patternId==='N09')?.status;
 assert.equal(status(duplicateMenus),'observed');
 assert.equal(status(oneMenu),'not_observed');
});
test('R08 cannot be observed merely because a PDF link exists',()=>{
 const page=analyzeHtml('<html><a href="/datasheet.pdf">Datasheet</a></html>',base);
 assert.notEqual(classify([page],at).assessments.find(x=>x.patternId==='R08').status,'observed');
});
