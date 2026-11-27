import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {acquireWithRuntime,runtimeStatus,PIN,validateBudget} from '../app/acquisition.mjs';
import {makePacket,validate} from '../app/intelligence.mjs';
const root='https://maker.com/',model=root+'products/pump-100';
const text='Pump 100 includes a stainless steel impeller, rated at 25 bar.';
const identity={name:'Pump 100',sku:'P100',key:'pump 100|p100',locator:'primary HTML heading'};
function fixture({blocked=false}={}){
 let observer,extractions=[],patternCalls=0,requests=0,ocrCalls=0,ocrPages=[];
 const transportFactory=(_h,{onResponse})=>{observer=onResponse;return {fetcher:async()=>{throw Error('Unexpected real network call')},canContinue:()=>true,stats:()=>({requests,bytes:100,halt:''}),stopReason:()=>''};};
 const m={validatePublicUrl:x=>new URL(x),extract:async(request,deps,policy,provenance)=>{
   requests++;extractions.push({request,deps,policy,provenance});
   if(blocked)return {sourceUrl:request.url,status:'blocked',strategy:'S01',reason:'HTTP 429; no bypass attempted',content:{}};
   const data=observer({url:request.url,status:200,type:'text/html'});data?.(Buffer.from('<h1>Pump 100</h1><p>'+text+'</p>'));
   return {sourceUrl:request.url,status:'completed',strategy:'S01',reason:'Fixture',content:{text,tables:[{rows:[['Pressure','25 bar']]}]},evidence:[]};
 },runResearchV3:async({url,maxPages,extractPage,onEvidence,shouldContinue})=>{
   const pages=[];for(const target of [url,model].slice(0,maxPages)){if(!shouldContinue())break;const r=await extractPage(target);const good=r.status==='completed';if(good)onEvidence(r,target);pages.push({url:target,requestedUrl:target,status:r.status,strategy:r.strategy,reason:r.reason,aiText:good?text:'',quality:{accepted:good,productIdentities:good?[identity]:[]},technicalReview:{tableCount:1}});}
   return {requestedUrl:url,status:pages.some(p=>p.status==='completed')?'sampled':'no_successful_pages',pages,coverage:{visitedPages:pages.length,stopReason:'frontier_exhausted'},evidenceQuality:{stopReason:'frontier_exhausted'},warnings:[]};
 },analyzeHtml:(html,url)=>{assert.ok(html.includes(text));patternCalls++;return {url,signals:[]};},analyzePdf:()=>{throw Error('Unexpected PDF')},classify:(samples)=>({assessments:[{patternId:'I01',status:'observed'}],candidates:[],samples}),createLocalPdfOcr:()=>{ocrCalls++;return async(_bytes,pages)=>{ocrPages.push(pages);return [];}}};
 return {m,transportFactory,stats:()=>({extractions,patternCalls,ocrCalls,ocrPages,requests})};
}
test('new adapter connects the phase 4 planner, accepted raw evidence, passive patterns and product candidates',async()=>{
 const f=fixture();const r=await acquireWithRuntime(f.m,{url:root,maxPages:2},{transportFactory:f.transportFactory,env:{}});
 assert.equal(r.benchmarkAcquisition.source_revision,PIN);assert.equal(r.benchmarkAcquisition.patternStatus,'sampled_from_acquisition');assert.equal(r.pattern_assessments[0].patternId,'I01');assert.equal(r.extracted_pages[0].tables[0].rows[0][1],'25 bar');assert.equal(r.products.length,1);assert.equal(r.products[0].name,'Pump 100');assert.equal(f.stats().requests,2);assert.equal(f.stats().patternCalls,2);assert.equal(f.stats().extractions[0].request.maxPdfPages,15);assert.equal(f.stats().extractions[0].policy.maxHtmlPages,1);assert.equal(f.stats().extractions[0].policy.maxBytesPdf,3000000);assert.equal(f.stats().extractions[0].deps.browser,undefined);
});
test('access restriction terminates site and retains diagnostic without pattern or evidence intake',async()=>{
 const f=fixture({blocked:true});const r=await acquireWithRuntime(f.m,{url:root,maxPages:2},{transportFactory:f.transportFactory,env:{}});
 assert.equal(f.stats().requests,1);assert.equal(r.coverage.stopReason,'rate_limited');assert.equal(r.evidenceQuality.stopReason,'rate_limited');assert.equal(r.extracted_pages[0].extracted_text,'');assert.equal(r.products.length,0);assert.equal(f.stats().patternCalls,0);
});
test('local large PDF and OCR options are not granted to remote queue jobs',async()=>{
 const env={PI_LOCAL_LARGE_PDF:'1',PI_LOCAL_PDF_OCR:'1'},a=fixture(),b=fixture();
 await acquireWithRuntime(a.m,{url:root+'manual.pdf',maxPages:1},{transportFactory:a.transportFactory,env});
 assert.equal(a.stats().ocrCalls,1);assert.equal(a.stats().extractions[0].policy.maxBytesPdf,12000000);assert.equal(typeof a.stats().extractions[0].deps.pdfOcr,'function');
 await acquireWithRuntime(b.m,{url:root+'manual.pdf',maxPages:1,origin:'github_queue'},{transportFactory:b.transportFactory,env});
 assert.equal(b.stats().ocrCalls,0);assert.equal(b.stats().extractions[0].policy.maxBytesPdf,3000000);
});
test('invalid page ceiling, HTTP and browser options fail closed',async()=>{
 const f=fixture(),options={transportFactory:f.transportFactory,env:{}};
 assert.throws(()=>validateBudget(51));await assert.rejects(acquireWithRuntime(f.m,{url:'http://maker.com/'},options),/Unapproved/);await assert.rejects(acquireWithRuntime(f.m,{url:root,browser:'headless'},options),/browser rendering is disabled/);assert.equal(f.stats().requests,0);
});
test('runtime readiness requires the pinned release marker and phase 4 + pattern modules',()=>{
 const dir=mkdtempSync(join(tmpdir(),'pi-runtime-'));try{assert.equal(runtimeStatus(dir).ready,false);const base=join(dir,'runtime','Product-Insights-'+PIN);mkdirSync(base,{recursive:true});writeFileSync(join(base,'.pi-unified-ready.json'),JSON.stringify({revision:'wrong'}));assert.equal(runtimeStatus(dir).ready,false);for(const p of ['Scrappers/dist/engine.js','Scrappers/tools/research-v3.mjs','Scrappers/tools/evidence-quality.mjs','engine/pattern-systems/dist/parse.js','engine/pattern-systems/dist/patterns.js']){const f=join(base,p);mkdirSync(join(f,'..'),{recursive:true});writeFileSync(f,'fixture');}writeFileSync(join(base,'.pi-unified-ready.json'),JSON.stringify({revision:PIN}));assert.equal(runtimeStatus(dir).ready,true);}finally{rmSync(dir,{recursive:true,force:true});}
});
test('quote validation does not permit omitted source text marker bridging; database and packet remain compatible',()=>{
 const db=new DatabaseSync(fileURLToPath(new URL('../data/knowledge.sqlite',import.meta.url)),{readOnly:true});try{const excerpt='Pump 100 includes a steel shaft.\n[... omitted source text ...]\nRated pressure is 25 bar.';const p=makePacket({requestedUrl:root,pages:[{url:root,status:'completed',aiText:excerpt,headings:[],structuredProducts:[]}]},db,1);const input=p.batches[0].input;const result={company:{name:null,role:'unknown'},products:[],claims:[{js:'JS4',claim:'Steel shaft',source_id:1,quote:'includes a steel shaft'},{js:'JS9',claim:'Invalid bridged quote',source_id:1,quote:'steel shaft. [... omitted source text ...] Rated pressure'}],gaps:[],coverage:{limitations:[]}};const v=validate(input,result);assert.equal(v.quotes_valid,1);assert.equal(v.accepted.claims.length,1);}finally{db.close();}
});
