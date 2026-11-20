#!/usr/bin/env node
/**
 * LIVE website smoke test for the existing Scrappers engine on an isolated
 * GitHub-hosted runner. This is NOT the Windows laptop and does NOT run Qwen.
 * Fixed 4 new public companies, never an arbitrary network proxy or remote shell.
 */
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {extract} from '../dist/engine.js';
import {validatePublicUrl} from '../dist/safety.js';
import {assertPublicDns} from './research-lab-security.mjs';
import {runResearch} from './research-planner.mjs';
import {extractProductIntelligence} from './product-intelligence.mjs';
import {buildResearchGraph} from './research-relationship-graph.mjs';
import {createPlaywrightBrowserCapture} from './node-browser.mjs';
const TEST_MATRICES={
  industrial:[
    {industry:'Electrical enclosures',url:'https://www.hammfg.com/'},
    {industry:'Polymer motion systems',url:'https://www.igus.com/'},
    {industry:'Industrial weighing equipment',url:'https://www.ricelake.com/'},
    {industry:'Dispensing and coating equipment',url:'https://www.nordson.com/'}
  ],
  hardware:[
    {industry:'Embedded computing hardware',url:'https://www.raspberrypi.com/'},
    {industry:'Electronics development parts',url:'https://www.sparkfun.com/'},
    {industry:'3D printers and tooling',url:'https://www.prusa3d.com/'},
    {industry:'Industrial automation components',url:'https://www.boschrexroth.com/'}
  ]
};
const BATCH=process.env.PI_SITE_BATCH||'industrial';
if(!Object.hasOwn(TEST_MATRICES,BATCH))throw Error('Site batch must be industrial or hardware');
const TARGETS=TEST_MATRICES[BATCH];
const OUTPUT=resolve('live-site-smoke-results'), MAX_PAGES=3;
const clip=(s,n=200)=>String(s??'').replace(/\s+/g,' ').trim().slice(0,n);
const start=new Date().toISOString(),results=[];
const summary=()=>({schemaVersion:'pi-hosted-real-site-smoke/v1',startedAt:start,
  updatedAt:new Date().toISOString(),execution:'github_hosted_ubuntu_runner',siteBatch:BATCH,
  testClass:'real_websites_existing_extraction_engine',
  qwenTested:false,privateTaxonomyLoaded:false,
  limitations:['Not the user Windows Research Lab','No laptop Qwen3 inference',
    'No original private taxonomy, so no actual OEM-category matching',
    'Public websites may refuse GitHub-hosted IP addresses or enforce robots',
    'No evidence that observed products were manufactured in-house'],
  results});
async function persist(){
 await mkdir(OUTPUT,{recursive:true});
 const all=summary();
 await writeFile(join(OUTPUT,'live-site-evidence.json'),JSON.stringify(all,null,2));
 let md='# Live Scrappers Test — Four New Companies ('+BATCH+')\n\n';
 md+='Run: '+start+' | GitHub-hosted runner (not user laptop)\n\n';
 md+='| Company | Pages | Successful | Product candidates | Categories | Parts mentioned | Materials mentioned | Access status |\n|---|---:|---:|---:|---:|---:|---:|---|\n';
 for(const r of results)md+='| '+new URL(r.url).hostname+' | '+(r.pagesVisited??0)+
   ' | '+(r.successfulPages??0)+' | '+(r.productCandidates??0)+' | '+(r.categories??0)+
   ' | '+(r.componentMentions??0)+' | '+(r.materialMentions??0)+' | '+r.status+' |\n';
 md+='\n## Per-company diagnostics\n\n';
 for(const r of results){
   md+='### '+r.url+'\n\nIndustry: '+r.industry+'\n\n';
   md+='Research result: '+r.status+'. Reason: '+(r.reason||'not specified')+'\n\n';
   md+='Pages: '+(r.pages||[]).map(x=>'['+x.status+': '+x.strategy+'] '+x.url).join('; ')+'\n\n';
   md+='Products: '+(r.productNames||[]).join('; ')+'\n\n';
   md+='Warnings: '+(r.warnings||[]).join('; ')+'\n\n';
 }
 md+='\n**Interpretation:** Real source extraction only. This test does not prove laptop AI, taxonomy coverage or manufacturing capabilities.\n';
 await writeFile(join(OUTPUT,'live-site-summary.md'),md);
}
async function one(site){
 const u=validatePublicUrl(site.url),host=u.hostname;
 await assertPublicDns(host);
 const pages=[];
 const browser=createPlaywrightBrowserCapture({headless:true});
 const fetcher=async(input,init)=>{
   const target=validatePublicUrl(typeof input==='string'?input:input.url||String(input));
   if(target.hostname!==host)throw Error('Other-domain fetch blocked');
   await assertPublicDns(target.hostname);
   return fetch(input,init);
 };
 const report=await runResearch({url:u.href,maxPages:MAX_PAGES,delayMs:750,
   extractPage:async target=>{
     await assertPublicDns(host);
     const result=await extract({url:target,mode:'auto',maxPdfPages:4},
       {fetcher,browser},{allowedHosts:[host],timeoutMs:8000,
         maxHtmlPages:1,maxBytesHtml:1000000,maxBytesPdf:1500000},'none');
     pages.push({...result,url:result.sourceUrl||target});
     return result;
   }});
 const products=extractProductIntelligence({companyName:host,
   rootUrl:u.href,pages});
 const graph=buildResearchGraph({companyName:host,companyUrl:u.href,
   products:products.products,processReference:null,aiParts:[]});
 const productNames=products.products.slice(0,12).map(x=>clip(x.name,110));
 return {industry:site.industry,url:site.url,status:report.status,
   reason:report.status==='no_successful_pages'?'No successfully extracted pages':
     report.status==='sampled'?'Source pages sampled, product identity not guaranteed':report.status,
   pagesVisited:report.coverage?.visitedPages||0,
   successfulPages:report.pages.filter(x=>['completed','partial'].includes(x.status)).length,
   productCandidates:products.products.length,categories:products.categories.length,
   componentMentions:products.products.reduce((n,p)=>n+(p.components||[]).length,0),
   materialMentions:products.products.reduce((n,p)=>n+(p.materials||[]).length,0),
   graphNodeCount:graph.nodes.length,graphGapCount:graph.gaps.length,
   processReferenceStatus:graph.originalTaxonomy.status,
   laptopAiStatus:'not_tested_on_hosted_runner',
   productNames,
   pages:report.pages.slice(0,MAX_PAGES).map(x=>({url:x.url,status:x.status,
      strategy:x.strategy,title:clip(x.title,160),textChars:x.textChars,
      reason:clip(x.reason,200)})),
   discoveredLeads:report.coverage?.discoveredLeads||0,
   warnings:(report.warnings||[]).slice(0,8).map(x=>clip(x,150))};
}
for(let i=0;i<TARGETS.length;i++){
 const site=TARGETS[i];console.log('TEST '+(i+1)+'/'+TARGETS.length+' '+site.url);
 try{const result=await one(site);results.push(result);
   console.log('RESULT '+JSON.stringify({site:site.url,status:result.status,pages:result.pagesVisited,
     products:result.productCandidates,parts:result.componentMentions,
     materials:result.materialMentions,examples:result.productNames.slice(0,3)}));}
 catch(e){results.push({url:site.url,industry:site.industry,status:'failed',
   reason:clip(e?.message||e,250),pagesVisited:0,successfulPages:0,
   productCandidates:0,categories:0,componentMentions:0,materialMentions:0,
   productNames:[],pages:[],warnings:['Aborted safely due to preflight or engine failure']});
   console.log('SITE_FAILED '+site.url+' '+clip(e?.message||e,180));}
 await persist();
}
console.log('FINAL_SITE_MATRIX '+JSON.stringify(results.map(({url,status,pagesVisited,successfulPages,productCandidates})=>
 ({url,status,pagesVisited,successfulPages,productCandidates}))));
