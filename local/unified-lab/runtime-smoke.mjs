// No live requests: exercise the real downloaded engine + real pattern modules
// through the full-lab adapter. Run on first setup before setting ready marker.
import assert from 'node:assert/strict';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {acquireWithRuntime} from './app/acquisition.mjs';
if(!process.argv[2])throw Error('Pinned source root required');
const base=resolve(process.argv[2]),scr=join(base,'Scrappers'),pat=join(base,'engine','pattern-systems','dist');
const imp=p=>import(pathToFileURL(p).href);
const [{extract},{validatePublicUrl},{runResearchV3},{analyzeHtml,analyzePdf},{classify},{createLocalPdfOcr}]=await Promise.all([imp(join(scr,'dist','engine.js')),imp(join(scr,'dist','safety.js')),imp(join(scr,'tools','research-v3.mjs')),imp(join(pat,'parse.js')),imp(join(pat,'patterns.js')),imp(join(scr,'tools','local-pdf-ocr.mjs'))]);
const root='https://maker.example.com/',model=root+'products/pump-100';
const company='<html><head><title>Example Pump Company</title></head><body><main><h1>Example Pump Company</h1><p>We manufacture industrial pumps and supply water treatment equipment.</p><a href="/products/pump-100">Pump 100</a></main></body></html>';
const product='<html><head><title>Pump 100</title></head><body><main><h1>Pump 100</h1><p>Pump 100 includes a stainless steel impeller. Pressure rating 25 bar. Designed for industrial water systems.</p><table><tr><th>Component</th><th>Material</th></tr><tr><td>Impeller</td><td>Stainless steel</td></tr></table></main></body></html>';
const visited=[];let requests=0;
const transportFactory=(_host,{onResponse})=>({fetcher:async(input)=>{
 const u=new URL(input);assert.equal(u.hostname,'maker.example.com');requests++;
 if(u.pathname==='/robots.txt')return new Response('User-agent: *\nAllow: /',{headers:{'content-type':'text/plain'}});
 assert.ok([root,model].includes(u.href),'Unexpected fixture URL');visited.push(u.href);
 const html=u.href===root?company:product;onResponse({url:u.href,status:200,type:'text/html'})?.(Buffer.from(html));
 return new Response(html,{headers:{'content-type':'text/html'}});
},stats:()=>({requests,bytes:0,halt:''}),canContinue:()=>true,stopReason:()=>''});
const r=await acquireWithRuntime({extract,validatePublicUrl,runResearchV3,analyzeHtml,analyzePdf,classify,createLocalPdfOcr},{url:root,maxPages:2,browser:'none'},{transportFactory,env:{}});
assert.deepEqual(visited,[root,model]);assert.equal(r.coverage.visitedPages,2);assert.equal(r.evidenceQuality.counts.accepted,2);assert.ok(r.products.some(p=>p.name==='Pump 100'));assert.equal(r.benchmarkAcquisition.patternStatus,'sampled_from_acquisition');assert.ok(r.pattern_assessments.length>0);assert.equal(r.extracted_pages[1].tables[0].rows[1][1],'Stainless steel');assert.ok(r.pages[1].technicalReview.tableCount>0);
console.log('Real Phase 4 runtime and Pattern Systems integration smoke passed (fixture network only).');
