import test from 'node:test';
import assert from 'node:assert/strict';
import {runResearchV3,v3SafeUrl,v3PageKind,v3RankLink} from '../tools/research-v3.mjs';
import {extract} from '../dist/engine.js';

const root='https://industrial.example.com/',host='industrial.example.com';
const long='Published technical industrial product information with material specifications and component dimensions. '.repeat(6);
const link=(path,label)=>({url:new URL(path,root).href,label});
const page=(url,content={},status='completed')=>({sourceUrl:url,status,strategy:'S01',reason:'Fixture',warnings:[],evidence:[],
 content:{title:'Industrial company',text:long,links:[],...content}});
async function crawl(pages,opts={}){
 const seen=[],accepted=[];
 const report=await runResearchV3({url:root,maxPages:10,delayMs:0,
  extractPage:async u=>{seen.push(u);return pages[u]??page(u,{title:u,text:long+u})},
  onEvidence:(r,u)=>accepted.push({result:r,url:u}),...opts});
 return {report,seen,accepted};
}
test('catalog headings override shallow product-shaped URLs',()=>{
 const u=root+'products/hydraulics';
 assert.equal(v3PageKind(u,{headings:['Product families'],links:[link('products/hydraulics/a','Series A')]}),'catalog');
 assert.equal(v3PageKind(root+'opaque/index',{headings:['Produkte']}),'catalog');
 assert.equal(v3PageKind(root+'opaque/model',{headings:['HP-500'],text:'Model number HP-500; capacity 50 L; material steel.'}),'product');
});
test('ProductGroup with variants remains product detail rather than generic listing',()=>{
 const jsonLd=[{'@type':'ProductGroup',name:'Valve family',hasVariant:[{'@type':'Product',name:'Valve 1',sku:'V1'},{'@type':'Product',name:'Valve 2',sku:'V2'}]}];
 assert.equal(v3PageKind(root+'valve-family',{headings:['Valve family'],jsonLd}),'product');
});
test('catalog navigation discovers specific opaque product links without claiming a verified product',()=>{
 const result=v3RankLink(link('index/item-123','Hydraulic actuator XL'),host,{parentKind:'catalog',parentBranch:'products/pumps'});
 assert.ok(result);assert.equal(result.kind,'other');assert.match(result.reason,/not a verified product/);
 assert.equal(result.branch,'products/pumps');
 assert.equal(v3RankLink(link('index/misc','Read more'),host,{parentKind:'catalog'}),null);
});
test('forms, previews and unsafe action URLs are excluded; technical support documents remain',()=>{
 for(const path of ['request-a-quote','forms/contact','products/model?preview=true','products/model?action=submit','products/model?preview_id=23']){
   assert.equal(v3SafeUrl(root+path,host),null);
 }
 assert.equal(v3RankLink(link('opaque/contact','Request a quote'),host,{parentKind:'catalog'}),null);
 assert.ok(v3RankLink(link('support/manuals/pump.pdf','Pump manual'),host,{parentKind:'product'}));
});
test('meaningful query parameters distinguish variants and tracking keys do not',()=>{
 const a=v3SafeUrl(root+'products/model?ref=A&utm_campaign=x',host),b=v3SafeUrl(root+'products/model?ref=B&utm_campaign=x',host);
 assert.notEqual(a,b);assert.equal(a,v3SafeUrl(root+'products/model?ref=A&utm_campaign=y',host));
});
test('observed trailing-slash links are requested verbatim',async()=>{
 const u=root+'products/valves/';
 const {seen}=await crawl({[root]:page(root,{links:[link(u,'Valves')]})},{maxPages:2});
 assert.deepEqual(seen,[root,u]);
});
test('same destination redirect aliases never count as unique pages or duplicate downstream evidence',async()=>{
 const first=root+'products/first',second=root+'products/second',dest=root+'products/real';
 const {report,accepted}=await crawl({[root]:page(root,{links:[link(first,'First model'),link(second,'Second model')]}),
  [first]:page(dest,{title:'Actual model'}),[second]:page(dest,{title:'Actual model'})},{maxPages:3});
 assert.equal(report.coverage.visitedPages,3);assert.equal(report.coverage.duplicatePages,1);
 assert.equal(report.coverage.successfulPages,2);assert.equal(report.pages[2].duplicateOf,dest);
 assert.equal(report.pages[2].aiText,'');assert.equal(accepted.length,2);
});
test('exact complete non-product copies across URLs retain only one evidence page',async()=>{
 const a=root+'catalog/alpha',b=root+'catalog/beta';
 const {report,accepted}=await crawl({[root]:page(root,{links:[link(a,'Catalog alpha'),link(b,'Catalog beta')]}),
  [a]:page(a,{title:'Industrial catalog'}),[b]:page(b,{title:'Industrial catalog'})},{maxPages:3});
 assert.equal(report.coverage.duplicatePages,1);assert.equal(accepted.length,2);
});
test('distinct product routes and model query variants survive shared text templates',async()=>{
 const a=root+'products/valve?ref=A',b=root+'products/valve?ref=B';
 const {report,accepted}=await crawl({[root]:page(root,{links:[link(a,'Valve A'),link(b,'Valve B')]}),
  [a]:page(a,{title:'Valve'}),[b]:page(b,{title:'Valve'})},{maxPages:3});
 assert.equal(report.coverage.duplicatePages,0);assert.equal(accepted.length,3);
});
test('different links or partial extracts must not be collapsed as exact copies',async()=>{
 const a=root+'catalog/alpha',b=root+'catalog/beta',c=root+'catalog/gamma';
 const {report}=await crawl({[root]:page(root,{links:[link(a,'Catalog alpha'),link(b,'Catalog beta'),link(c,'Catalog gamma')]}),
  [a]:page(a,{title:'Catalog',links:[link('products/model-a','Model A')]}),
  [b]:page(b,{title:'Catalog',links:[link('products/model-b','Model B')]}),
  [c]:page(c,{title:'Catalog',links:[link('products/model-a','Model A')]},'partial')},{maxPages:8});
 assert.equal(report.coverage.duplicatePages,0);
});
test('product branches are diversified before repeatedly sampling one branch',async()=>{
 const a=root+'products/pumps',b=root+'products/valves';
 const {seen,report}=await crawl({[root]:page(root,{links:[link(a,'Pumps'),link(b,'Valves')]}),
  [a]:page(a,{title:'Pumps',headings:['Product families'],links:Array.from({length:12},(_,i)=>link('products/pumps/model-'+i,'Pump model '+i))}),
  [b]:page(b,{title:'Valves',headings:['Product families']})},{maxPages:4});
 assert.ok(seen.includes(a));assert.ok(seen.includes(b));
 assert.ok(report.coverage.branchCoverage.some(x=>x.key==='products/valves'&&x.uniquePages>=1));
 assert.equal(report.coverage.branchCoverageIsHeuristic,true);
});
test('locale alternatives are deferred but a unique regional product is still explored',async()=>{
 const en=root+'en-us/',a=root+'en-us/products/pump',de=root+'de-de/products/pump',unique=root+'de-de/products/valve';
 const {seen,report}=await crawl({[en]:page(en,{links:[link(de,'Pump'),link(a,'Pump'),link(unique,'Valve')]}),
  [a]:page(a,{title:'US pump',text:long+'US variant'}),[de]:page(de,{title:'German pump',text:long+'German variant'}),
  [unique]:page(unique,{title:'Valve',text:long+'regional valve'})},{url:en,maxPages:4});
 assert.equal(report.coverage.preferredLocale,'en-us');
 assert.ok(seen.indexOf(a)<seen.indexOf(de));assert.ok(seen.indexOf(unique)<seen.indexOf(de));
 assert.equal(report.coverage.duplicatePages,0);
});
test('frontier eviction keeps stronger product branches and reports dropped candidates',async()=>{
 const {report,seen}=await crawl({[root]:page(root,{links:[link('about','About us'),link('products/pump','Pump'),link('products/valve','Valve'),link('products/motor','Motor')]})},
  {maxPages:3,maxCandidates:2});
 assert.equal(report.coverage.visitedPages,3);assert.ok(report.coverage.frontierDropped>=1);assert.ok(seen.slice(1).every(u=>u.includes('/products/')));
});
test('standalone inquiry form does not become accepted engineering evidence',async()=>{
 const a=root+'products/inquiry-page';
 const {report,accepted}=await crawl({[root]:page(root,{links:[link(a,'Product inquiry')]}),[a]:page(a,{headings:['Request a quote'],text:long})},{maxPages:2});
 assert.equal(report.coverage.irrelevantPages,1);assert.equal(report.pages[1].status,'irrelevant');assert.equal(accepted.length,1);
});
test('https research never accepts downgrade or off-host redirected evidence',async()=>{
 const a=root+'products/model';
 const {report,accepted}=await crawl({[root]:page(root,{links:[link(a,'Model')]}),[a]:page('http://industrial.example.com/products/model')},{maxPages:2});
 assert.equal(report.pages[1].status,'blocked');assert.equal(accepted.length,1);
});

const html=(body,title='Catalog')=>'<html><title>'+title+'</title><main>'+body+'</main></html>';
const fetcherFor=body=>async url=>url.endsWith('/robots.txt')?new Response('User-agent: *\nAllow: /',{headers:{'content-type':'text/plain'}}):new Response(body,{headers:{'content-type':'text/html'}});
const policy={allowedHosts:[host],maxHtmlPages:1};
test('dynamic catalog shell can choose shorter rendered text with more meaningful catalog links',async()=>{
 const body=html('<h1>Catalog</h1><p>Loading products. '+long+'</p><script type="application/json">{"state":"loading"}</script>');
 const r=await extract({url:root},{fetcher:fetcherFor(body),browser:async()=>({url:root,html:html('<h1>Catalog</h1><a href="/products/model-a">Model A</a><a href="/products/model-b">Model B</a>')})},policy);
 assert.equal(r.strategy,'S02');assert.equal(r.content.links.length,2);
});
test('HTTP access denial does not activate browser fallback',async()=>{
 let browserCalls=0;
 const r=await extract({url:root},{fetcher:async url=>url.endsWith('/robots.txt')?new Response('',{status:404}):new Response('Access denied',{status:403}),
  browser:async()=>{browserCalls++;return {url:root,html:html('Rendered')}}},policy);
 assert.equal(r.status,'blocked');assert.equal(browserCalls,0);
});
test('browser denial and rate limit are not treated as richer evidence',async()=>{
 const body=html('<h1>Loading products</h1>');
 const r=await extract({url:root},{fetcher:fetcherFor(body),browser:async()=>({url:root,httpStatus:429,html:html('Request limit')})},policy);
 assert.equal(r.status,'blocked');assert.equal(r.strategy,'S02');assert.equal(r.content.text,undefined);
});
test('a standalone form does not cause browser escalation',async()=>{
 let calls=0;
 const r=await extract({url:root},{fetcher:fetcherFor(html('<h1>Request a quote</h1><form><input name="email"></form>','Request a quote')),
   browser:async()=>{calls++;return {url:root,html:html('Form')}}},policy);
 assert.equal(r.strategy,'S01');assert.equal(calls,0);
});
