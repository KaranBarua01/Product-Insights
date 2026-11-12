import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {inspectWebsite} from '../dist/inspect.js';
import {hasExtractablePdfText} from '../dist/pdf-text.js';

const pdf=readFileSync(new URL('./fixtures/pump-text.pdf',import.meta.url));
test('real PDF parser confirms text layer from PDF bytes',async()=>{
  assert.equal(await hasExtractablePdfText(pdf),true);
});
test('real linked PDF text becomes observed R08, with page-scope evidence',async()=>{
  let pdfCalls=0;
  const fetcher=async(u)=>{
    const path=new URL(String(u)).pathname;
    if(path==='/robots.txt')return new Response('',{status:404});
    if(path==='/technical-data'){pdfCalls++;return new Response(pdf,{headers:{'content-type':'application/pdf'}});}
    return new Response('<html><body><a href="/technical-data">Pump datasheet</a></body></html>',{headers:{'content-type':'text/html'}});
  };
  const result=await inspectWebsite('https://test-machinery.com/',{fetcher,maxPages:1});
  assert.equal(pdfCalls,1);
  assert.equal(result.limits.documentPagesInspected,1);
  const r08=result.assessments.find(x=>x.patternId==='R08');
  assert.equal(r08.status,'observed');
  assert.equal(r08.evidence[0].sourceUrl,'https://test-machinery.com/technical-data');
});
