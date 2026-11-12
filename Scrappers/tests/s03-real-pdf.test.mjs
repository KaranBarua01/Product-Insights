import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {extract} from '../dist/engine.js';

const pdf=readFileSync(new URL('./fixtures/pump-text.pdf',import.meta.url));
const policy={allowedHosts:['test-machinery.com']};
test('real PDF text extracted through S03 even without a .pdf filename',async()=>{
  const fetcher=async(url)=>{
    const path=new URL(String(url)).pathname;
    if(path==='/robots.txt')return new Response('',{status:404});
    if(path==='/technical-data')return new Response(pdf,{headers:{'content-type':'application/pdf'}});
    return new Response('Not Found',{status:404,headers:{'content-type':'text/html'}});
  };
  const result=await extract({url:'https://test-machinery.com/technical-data',mode:'auto'}, {fetcher},policy);
  assert.equal(result.status,'completed',result.reason+' '+JSON.stringify(result.warnings));
  assert.equal(result.strategy,'S03');
  assert.deepEqual(result.attempts.map(x=>x.strategy),['S01','S03']);
  assert.match(result.content.text,/Industrial Pump Technical Data Sheet/);
  assert.ok(result.evidence.some(x=>x.locator==='PDF page 1'));
});
test('browser route is tested independently of HTTP route',async()=>{
  const analysis={assessments:[{patternId:'R04',status:'lead'},{patternId:'R07',status:'lead'}]};
  const fetcher=async(url)=>new URL(String(url)).pathname==='/robots.txt'
    ?new Response('User-agent: *\nAllow: /',{headers:{'content-type':'text/plain'}})
    :new Response('<html><body><div id="root"></div></body></html>',{headers:{'content-type':'text/html'}});
  const browser=async(url)=>({url,html:'<html><body><main><h1>Industrial Product Catalog</h1><p>Real rendered supplier product data after JavaScript execution.</p></main></body></html>'});
  const result=await extract({url:'https://test-machinery.com/',patternAnalysis:analysis},{fetcher,browser},policy,'supplied');
  assert.equal(result.status,'completed');assert.equal(result.strategy,'S02');
  assert.equal(result.routing.strategy,'S02');assert.equal(result.attempts.length,1);
  assert.match(result.content.text,/Real rendered supplier product data/);
});

test('S03 returns bounded partial evidence for long PDFs instead of rejecting the whole document',async()=>{
 const fetcher=async(url)=>{
   if(new URL(String(url)).pathname==='/robots.txt')return new Response('',{status:404});
   return new Response(pdf,{headers:{'content-type':'application/pdf'}});
 };
 const pdfParser=async(_bytes,limit)=>({pageCount:limit,totalPages:54,truncated:true,pages:[{page:1,text:'Pump engineering specifications for industrial manufacturing.'}]});
 const result=await extract({url:'https://test-machinery.com/brochure',mode:'S03',maxPdfPages:8},{fetcher,pdfParser},policy);
 assert.equal(result.status,'partial');
 assert.match(result.reason,/first 8 of 54/);
 assert.ok(result.evidence.some(x=>x.locator==='PDF page 1'));
 assert.ok(result.warnings.some(w=>/remaining pages not inspected/.test(w)));
});
