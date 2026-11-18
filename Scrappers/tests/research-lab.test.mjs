import test from 'node:test';
import assert from 'node:assert/strict';
import {safeCandidate,rankResearchLink,extractStructuredProducts,parseTaxonomy,mapProductCandidates,runResearch} from '../tools/research-planner.mjs';
import {publicIp,assertPublicDns} from '../tools/research-lab-security.mjs';

test('public URL candidate discovery stays exact-host and drops unsafe paths',()=>{
  assert.equal(safeCandidate('https://example.org/products/pump?utm_source=x','example.org'),'https://example.org/products/pump');
  assert.equal(safeCandidate('https://other.example.org/products/pump','example.org'),null);
  assert.equal(safeCandidate('file:///etc/passwd','example.org'),null);
  assert.equal(safeCandidate('https://example.org/checkout','example.org'),null);
  assert.equal(rankResearchLink({url:'https://example.org/products/pump',label:'Pumps'},'example.org').reason,'Product or catalog lead');
  assert.equal(rankResearchLink({url:'https://example.org/privacy',label:'Privacy'},'example.org'),null);
});
test('extracts only explicit product records from bounded JSON-LD',()=>{
  const result=extractStructuredProducts([{'@graph':[{'@type':'Organization',name:'OEM'},{'@type':['Product','Thing'],name:'High Pressure Pump',sku:'HP-20',material:'Stainless steel'},{'@type':'Product',name:'High Pressure Pump',sku:'HP-20'}]}],'https://example.org/pump');
  assert.equal(result.length,1);assert.equal(result[0].sku,'HP-20');
  assert.equal(result[0].evidenceType,'published_json_ld_unverified');
});
test('loads exact codes from uploaded taxonomy HTML without evaluating scripts',()=>{
  const html='<!doctype html><script>const DATA=[{"code":"l0_test","label":"Industrial","children":[{"code":"l1_test","label":"Equipment","children":[{"code":"l2_test","label":"Fluid Pumps","children":[{"code":"l3_impellers","label":"Impellers"}]}]}]}]; alert(1)</script>';
  const nodes=parseTaxonomy(html);assert.equal(nodes.length,4);assert.equal(nodes[3].code,'l3_impellers');
  const match=mapProductCandidates([{name:'Impellers',sku:null}],nodes);
  assert.equal(match[0].taxonomy.status,'candidate_requires_review');assert.equal(match[0].taxonomy.suggestions[0].code,'l3_impellers');
  const miss=mapProductCandidates([{name:'Chocolate Cookies',sku:null}],nodes);
  assert.equal(miss[0].taxonomy.status,'gap_or_insufficient_evidence');
});
test('rejects private, loopback, documentation and mapped addresses in DNS preflight',async()=>{
  for(const address of ['127.0.0.1','10.1.1.1','192.168.1.1','172.16.2.2','169.254.0.9','100.64.0.1','203.0.113.8','::1','fc00::1','::ffff:127.0.0.1'])assert.equal(publicIp(address),false,address);
  assert.equal(publicIp('8.8.8.8'),true);assert.equal(publicIp('2606:4700:4700::1111'),true);
  await assert.rejects(()=>assertPublicDns('example.org',async()=>[{address:'8.8.8.8'},{address:'127.0.0.1'}]),/private/);
});
test('research visits ranked public-site links, records provenance and stops within budget',async()=>{
  const visited=[];const website='https://example.org/';
  const fake=async url=>{
    visited.push(url);
    if(url===website)return {sourceUrl:url,status:'completed',strategy:'S01',reason:'OK',content:{title:'Company',text:'Product ranges',links:[{url:'https://evil.org/products',label:'Product'},{url:'https://example.org/contact',label:'Contact'},{url:'https://example.org/products/pump',label:'Pump product page'},{url:'https://example.org/about',label:'About'}]},evidence:[],warnings:[]};
    if(url.endsWith('/products/pump'))return {sourceUrl:url,status:'completed',strategy:'S02',reason:'Browser',content:{title:'Pump',text:'Product pump',jsonLd:[{'@type':'Product',name:'Industrial Pump',sku:'IP-1'}],links:[]},evidence:[{sourceUrl:url,locator:'title',excerpt:'Pump',method:'S02'}],warnings:[]};
    return {sourceUrl:url,status:'blocked',strategy:'S01',reason:'Robots stopped',content:{},evidence:[],warnings:[]};
  };
  const report=await runResearch({url:website,maxPages:2,extractPage:fake});
  assert.deepEqual(visited,[website,'https://example.org/products/pump']);
  assert.equal(report.pages[1].strategy,'S02');assert.equal(report.products.length,1);
  assert.equal(report.products[0].sourceUrl,'https://example.org/products/pump');
  assert.equal(report.coverage.visitedPages,2);assert.equal(report.status,'sampled');
  assert.equal(report.products[0].taxonomy.status,'not_loaded');
});
test('does not fabricate products or continue when no links exist',async()=>{
  const report=await runResearch({url:'https://example.org/',maxPages:10,extractPage:async()=>({status:'blocked',strategy:'S01',reason:'HTTP 429',content:{},warnings:[],evidence:[]})});
  assert.equal(report.pages.length,1);assert.equal(report.products.length,0);assert.equal(report.status,'no_successful_pages');
});