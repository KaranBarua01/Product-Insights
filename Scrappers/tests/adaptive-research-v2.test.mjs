import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getResearchBudget,rankPageLinks,catalogCardLeads,pageSignals,
  normalizeCandidateUrl,classifyLeadUrl
} from '../tools/adaptive-research-v2.mjs';
import {runResearch} from '../tools/research-planner.mjs';
import {classifyIntelligencePage,extractProductIntelligence} from '../tools/product-intelligence.mjs';
import {selectProductEvidence} from '../tools/product-evidence-v2.mjs';
const base='https://example.com/';

test('profiles select exactly 5/15/30 pages and retain bounded legacy budgets',()=>{
 assert.deepEqual(getResearchBudget({profile:'quick'}),{profile:'quick',maxPages:5});
 assert.deepEqual(getResearchBudget({profile:'standard'}),{profile:'standard',maxPages:15});
 assert.deepEqual(getResearchBudget({profile:'deep'}),{profile:'deep',maxPages:30});
 assert.equal(getResearchBudget({maxPages:3}).maxPages,3);
 assert.equal(getResearchBudget({maxPages:12}).maxPages,12);
 assert.throws(()=>getResearchBudget({maxPages:31}),/1-30/);
 assert.throws(()=>getResearchBudget({profile:'unbounded'}),/Research profile/);
});
test('catalog and product-detail links outrank demos/news; no off-host, private or unsafe redirects',()=>{
 const links=[
   {url:base+'book-demo',label:'Book your product demo'},
   {url:base+'products/pump-model-240',label:'Industrial Pump PM-240'},
   {url:base+'collections/all-pumps',label:'Industrial pumps'},
   {url:base+'news',label:'Latest industry news'},
   {url:'http://127.0.0.1/admin',label:'Internal pumps'},
   {url:'https://evil.org/products/fake',label:'Fake pump'},
   {url:base+'products/pump-model-240',label:'Duplicate'}];
 const r=rankPageLinks(links,'example.com',{parentRole:'catalog'});
 assert.equal(r[0].kind,'product');
 assert.ok(r.some(x=>x.kind==='catalog'));
 assert.ok(r.every(x=>!x.url.includes('127.0.0.1')&&!x.url.includes('evil.org')));
 assert.equal(r.some(x=>x.url.includes('book-demo')),false);
 assert.equal(new Set(r.map(x=>x.url)).size,r.length);
 assert.equal(normalizeCandidateUrl('file:///etc/passwd','example.com'),null);
 assert.equal(classifyLeadUrl('https://example.com/products/pump-244'),'product');
});
test('catalog card leads are review-only, never fabricated visited product records',()=>{
 const source=base+'collections/industrial-pumps';
 const content={title:'Industrial Pumps | Example',headings:['Industrial Pump Products'],
   text:'Browse industrial pump models for your application',
   links:[{url:base+'products/pump-x-240',label:'High Capacity Pump X-240'},
     {url:base+'products/pump-y-260',label:'High Capacity Pump Y-260'},
     {url:base+'contact',label:'Contact us'}],jsonLd:[]};
 const p={url:source,sourceUrl:source,status:'completed',strategy:'S01',content};
 assert.equal(pageSignals(p).role,'catalog');
 const candidates=catalogCardLeads(p,'example.com');
 assert.equal(candidates.length,2);
 const result=extractProductIntelligence({companyName:'Example Pumps',rootUrl:base,pages:[p]});
 assert.equal(result.products.length,0,'catalog cards must not become actual product records');
 assert.equal(result.productLeads.length,2);
 assert.equal(result.productLeads[0].reviewStatus,'link_candidate_requires_detail_evidence');
 assert.equal(result.productLeads[0].evidence.sourceUrl,source);
 assert.equal(result.coverage.catalogLinkCandidates,2);
});
test('visiting a catalog product detail converts lead into source-backed product identity',()=>{
 const source=base+'collections/industrial-pumps',detail=base+'products/pump-x-240';
 const catalog={url:source,status:'completed',strategy:'S01',content:{
  title:'Industrial pumps',headings:['Pump product catalog'],text:'Our pump models',
  links:[{url:detail,label:'High Capacity Pump X-240'}]}};
 const product={url:detail,status:'completed',strategy:'S01',content:{
  title:'High Capacity Pump X-240',headings:['High Capacity Pump X-240'],
  text:'High Capacity Pump X-240\nMaterial: stainless steel\nWeight: 20 kg',
  links:[],jsonLd:[]}};
 const result=extractProductIntelligence({companyName:'Example Pumps',rootUrl:base,
   pages:[catalog,product]});
 assert.equal(classifyIntelligencePage(detail),'product');
 assert.equal(result.products.length,1);
 assert.equal(result.productLeads.length,0);
 assert.ok(result.products[0].specifications.length>0);
 assert.ok(result.products[0].materials.length>0);
 assert.ok(result.products[0].evidence[0].sourceUrl===detail);
});
test('adaptive planner uses high-intent category/detail frontier before marketing pages',async()=>{
 const urls=[],catalog=base+'collections/industrial-pumps',detail=base+'products/pump-x-240';
 const result=await runResearch({url:base,profile:'standard',delayMs:0,
  extractPage:async url=>{
   urls.push(url);
   if(url===base)return {sourceUrl:url,status:'completed',strategy:'S01',
     content:{title:'Example Pumps',text:'Company pumps',headings:['Example Pumps'],
       links:[{url:base+'about',label:'About us'},{url:catalog,label:'Industrial Pump Products'}]}};
   if(url===catalog)return {sourceUrl:url,status:'completed',strategy:'S01',
     content:{title:'Industrial pumps',text:'Browse our pump range',
       headings:['Pump products'],links:[{url:detail,label:'High Capacity Pump X-240'}]}};
   if(url===detail)return {sourceUrl:url,status:'completed',strategy:'S01',
     content:{title:'Pump X-240',headings:['Pump X-240'],
       text:'Pump X-240\nMaterial: stainless steel\nCapacity: 20 kg',
       jsonLd:[{'@type':'Product',name:'Pump X-240',sku:'X240'}],links:[]}};
   return {status:'failed',content:{},reason:'not targeted'};
  }});
 assert.equal(urls[0],base);
 assert.equal(urls[1],catalog);
 assert.equal(urls[2],detail);
 assert.equal(result.requestedPages,15);
 assert.ok(result.coverage.productCardLeads>=1);
 assert.equal(result.coverage.structuredProducts,1);
 assert.ok(result.coverage.usefulPages>=2);
 assert.equal(result.status,'sampled');
});
test('verbatim evidence scanner retains late-page materials and components within small model budget',()=>{
 const long='Company introduction. '.repeat(3800);
 const late='Specifications: Material: aluminum frame. Includes mounting brackets. Voltage: 24 V.';
 const sample=selectProductEvidence({content:{title:'Industrial Pump Model 240',
   headings:['Industrial Pump Model 240'],text:long+'\n'+late}},
   'Industrial Pump Model 240',{maxChars:4900});
 assert.ok(sample.scannedChars>60_000);
 assert.ok(sample.sourceText.includes('aluminum frame'));
 assert.ok(sample.sourceText.includes('mounting brackets'));
 assert.ok(sample.sourceText.includes('24 V'));
 assert.ok(sample.sourceText.length<=4900);
 assert.ok(sample.selectedSections.some(x=>x.positionPct>=70));
 assert.equal(sample.selection,'ranked_verbatim_evidence_across_page');
});
test('adaptive mode stops when frontier is empty, never invents product data',async()=>{
 const result=await runResearch({url:base,profile:'deep',extractPage:async url=>({
   status:'completed',sourceUrl:url,strategy:'S01',
   content:{title:'Marketing Company',text:'Welcome',headings:['Our vision'],links:[]}
 })});
 assert.equal(result.coverage.visitedPages,1);
 assert.equal(result.coverage.stopReason,'frontier_exhausted');
 assert.equal(result.products.length,0);
 assert.equal(result.requestedPages,30);
});
