#!/usr/bin/env node
/**
 * Read-only Crawlee A/B acquisition experiment.
 * Shared downstream PI extractor+verifier, identical public exact-host targets,
 * identical 15 page caps, no Cloudflare/D1/OS writes, no bypasses/proxies.
 */
import {mkdir,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {performance} from 'node:perf_hooks';
import {CheerioCrawler,Configuration} from 'crawlee';
import {extract} from '../dist/engine.js';
import {parseHtml} from '../dist/html.js';
import {validatePublicUrl} from '../dist/safety.js';
import {assertPublicDns} from './research-lab-security.mjs';
import {runResearch} from './research-planner.mjs';
import {extractProductIntelligence} from './product-intelligence.mjs';
import {buildPartEvidenceReport} from './part-evidence-verifier.mjs';
import {rankPageLinks,pageSignals,normalizeCandidateUrl} from './adaptive-research-v2.mjs';

const COMPANIES={
  bike:{url:'https://1up-usa.com/',name:'1UP USA'},
  polymer:{url:'https://www.igus.com/',name:'igus'},
  reseller:{url:'https://www.1evac.com/',name:'1EVAC'}
};
const siteKey=process.env.PI_CRAWLEE_SITE||'bike';
if(!Object.hasOwn(COMPANIES,siteKey))throw Error('Unknown benchmark site');
const target=COMPANIES[siteKey];
const root=validatePublicUrl(target.url);
const host=root.hostname;
const LIMIT=15;
const output=resolve('crawlee-pilot-results');
const crop=(x,n=200)=>String(x??'').replace(/\s+/g,' ').trim().slice(0,n);
const started=new Date().toISOString();
const report={schemaVersion:'pi-crawlee-ab-pilot/v1',company:target,siteKey,
  started,runner:'github_actions_runner_not_windows_laptop',limit:LIMIT,
  note:'This is acquisition A/B. Same PI extractor and verifier. Accuracy needs independent product/part labels.',
  library:'crawlee@3.18.2',approaches:{},limitations:[
    'Test compares bounded public website acquisition; site availability can vary by run.',
    'No bypass of access restrictions, no proxies, no real D1 records loaded.',
    'Candidates and source mentions are not validated true positives.',
    'The hypothesis that Crawlee improves precision requires human review.'
  ]};
async function persist(){
 await mkdir(output,{recursive:true});
 await writeFile(join(output,'crawlee-ab-'+siteKey+'.json'),JSON.stringify(report,null,2));
}
function summarize(name,pages,meta,elapsedMs){
 const products=extractProductIntelligence({companyName:target.name,rootUrl:target.url,pages});
 const facts=buildPartEvidenceReport({companyName:target.name,companyUrl:target.url,
   products:products.products,pages});
 return {name,pagesVisited:pages.length,usablePages:pages.filter(p=>['completed','partial'].includes(p.status)).length,
   productCandidates:products.products.length,skuCandidates:products.coverage.skuNamedProductCandidates,
   categories:products.categories.length,productLeads:products.productLeads.length,
   componentMentions:products.coverage.components,materialMentions:products.coverage.materials,
   sourcedParts:facts.counts.partEvidenceCandidates,
   partMaterials:facts.counts.partMaterialCandidates,
   partProcesses:facts.counts.partProcessCandidates,
   unverifiableParts:facts.counts.uncorroboratedScraperPartMentions,
   elapsedMs:Math.round(elapsedMs),meta,
   sampleProducts:products.products.slice(0,35).map(p=>({name:crop(p.name,115),sourceUrl:p.sourceUrl,
     sku:p.sku,parts:p.components?.slice(0,5).map(c=>c.component)||[],
     materials:p.materials?.slice(0,5).map(m=>m.material)||[]})),
   sampleSourceParts:facts.products.slice(0,30).flatMap(p=>p.parts.slice(0,8).map(part=>({
     product:p.name,part:part.name,quote:crop(part.observations?.[0]?.quote,220),
     materials:part.materialClaims.map(m=>m.name),processes:part.processClaims.map(m=>m.name),
     sourceUrl:p.sourceUrl}))).slice(0,35),
   pages:pages.map(p=>({url:p.url,status:p.status,chars:p.content?.text?.length||0,
     title:crop(p.content?.title,150),reason:crop(p.reason,150)}))};
}
async function existingPi(){
 const pages=[]; const t=performance.now();
 const fetcher=async(input,init)=>{
   const u=validatePublicUrl(typeof input==='string'?input:input.url||String(input));
   if(u.hostname!==host)throw Error('Cross-host blocked');
   await assertPublicDns(u.hostname);
   return fetch(input,init);
 };
 const result=await runResearch({url:root.href,maxPages:LIMIT,delayMs:450,
   extractPage:async url=>{
     await assertPublicDns(host);
     const p=await extract({url,mode:'S01',maxPdfPages:0},{fetcher},
       {allowedHosts:[host],timeoutMs:12000,maxHtmlPages:1,maxBytesHtml:1200000},'none');
     pages.push({...p,url:p.sourceUrl||url});
     return p;
   }});
 return summarize('PI S01 existing crawler',pages,{stopReason:result.coverage.stopReason,
   discoveredLeads:result.coverage.discoveredLeads,
   usefulPages:result.coverage.usefulPages},performance.now()-t);
}
async function crawleeAcquisition(){
 const pages=[],failures=[],queued=new Set([root.href]);const t=performance.now();
 Configuration.getGlobalConfig().set('persistStorage',false);
 let crawler;
 crawler=new CheerioCrawler({
   maxRequestsPerCrawl:LIMIT,maxConcurrency:1,minConcurrency:1,
   maxRequestsPerMinute:30,sameDomainDelaySecs:1,
   maxRequestRetries:0,retryOnBlocked:false,useSessionPool:false,
   respectRobotsTxtFile:true,requestHandlerTimeoutSecs:35,navigationTimeoutSecs:22,
   preNavigationHooks:[async({request})=>{
     const u=validatePublicUrl(request.url);
     if(u.hostname!==host)throw Error('Cross-host queued URL blocked');
     await assertPublicDns(u.hostname);
   }],
   async requestHandler({request,$,response}){
     const url=request.loadedUrl||request.url;
     const u=validatePublicUrl(url);
     if(u.hostname!==host)throw Error('Cross-host redirect blocked');
     const status=response?.statusCode||0;
     if(status>=400)throw Error('HTTP '+status);
     const rendered=parseHtml($.html(),url,'S01');
     const content=rendered.content;
     const challenge=/\b(?:verify you are human|just a moment|checking your browser|attention required|captcha challenge)\b/i.test(
       String(content.title||'')+' '+String(content.text||'').slice(0,500));
     if(challenge){
       pages.push({url,status:'blocked',content:{title:content.title,text:''},reason:'Site access challenge'});
       return;
     }
     pages.push({url,status:'completed',strategy:'S01',content,
       warnings:rendered.warnings,evidence:rendered.evidence});
     const parentRole=pageSignals({url,content}).role;
     const links=rankPageLinks(content.links||[],host,{parentRole,limit:22});
     const candidates=links.filter(l=>normalizeCandidateUrl(l.url,host))
       .filter(l=>!queued.has(l.url)).slice(0,12);
     candidates.forEach(l=>queued.add(l.url));
     if(candidates.length)await crawler.addRequests(candidates.map(l=>({url:l.url})));
   },
   failedRequestHandler:async({request},error)=>{
     failures.push({url:request.url,error:crop(error?.message||request.errorMessages?.join(' '),160)});
     pages.push({url:request.url,status:'failed',reason:crop(error?.message||'request failed',160),
       content:{text:'',title:''}});
   }
 });
 await crawler.run([root.href]);
 return summarize('Crawlee CheerioCrawler',pages,{failures,queuedCandidates:queued.size},
   performance.now()-t);
}
await assertPublicDns(host);
try{
 report.approaches.pi=await existingPi();
 console.log('PI_BASELINE '+JSON.stringify({site:siteKey,pages:report.approaches.pi.pagesVisited,
   products:report.approaches.pi.productCandidates,parts:report.approaches.pi.sourcedParts}));
}catch(e){report.approaches.pi={status:'failed',reason:crop(e?.stack||e,900)};}
await persist();
try{
 report.approaches.crawlee=await crawleeAcquisition();
 console.log('CRAWLEE '+JSON.stringify({site:siteKey,pages:report.approaches.crawlee.pagesVisited,
   products:report.approaches.crawlee.productCandidates,parts:report.approaches.crawlee.sourcedParts}));
}catch(e){report.approaches.crawlee={status:'failed',reason:crop(e?.stack||e,900)};}
report.finished=new Date().toISOString();
await persist();
console.log('COMPARE '+JSON.stringify({company:target.name,pi:report.approaches.pi?.productCandidates??null,
  crawlee:report.approaches.crawlee?.productCandidates??null,
  piParts:report.approaches.pi?.sourcedParts??null,
  crawleeParts:report.approaches.crawlee?.sourcedParts??null}));
