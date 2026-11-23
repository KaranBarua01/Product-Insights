#!/usr/bin/env node
/** Frozen, fair, source-only V2 vs V3 comparison. No production or D1 writes. */
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {performance} from 'node:perf_hooks';
import {extract} from '../dist/engine.js';
import {validatePublicUrl} from '../dist/safety.js';
import {assertPublicDns} from './research-lab-security.mjs';
import {createPlaywrightBrowserCapture} from './node-browser.mjs';
import {runResearch} from './research-planner.mjs';
import {runResearchV3} from './research-v3.mjs';
import {extractProductIntelligence} from './product-intelligence.mjs';
import {extractProductIntelligenceV3,enrichPartEvidenceV3} from './evidence-bridge-v3.mjs';
import {buildPartEvidenceReport} from './part-evidence-verifier.mjs';
const companies={
  igus:{name:'igus',url:'https://www.igus.com/'},
  bike:{name:'1UP USA',url:'https://1up-usa.com/'},
  vacuum:{name:'1EVAC',url:'https://www.1evac.com/'}
};
const key=process.env.PI_V3_SITE||'igus';
if(!Object.hasOwn(companies,key))throw Error('Unknown test company');
const site=companies[key],u=validatePublicUrl(site.url);
const limit=Number(process.env.PI_V3_PAGE_LIMIT||15);
if(!Number.isInteger(limit)||limit<2||limit>30)throw Error('Fair V2/V3 comparison max pages must be 2-30');
const output=resolve('v3-live-benchmark-results');
const summary={schemaVersion:'pi-research-v3-live-ab/1',site,limit,
  runner:'github-hosted-ubuntu',startedAt:new Date().toISOString(),
  controlledVariables:'same company, 15/30 page ceiling, same PI source extraction with browser fallback',
  caveats:['Order effects and site volatility are not randomized.',
    'Candidate counts do not prove precision or true part recall.',
    'Blocked sites are access failures, not negative manufacturing evidence.',
    'No production D1 credentials or private taxonomy',
    'No automatic classification as in-house manufacturing'],approaches:{}};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const clip=(s,n=180)=>String(s??'').replace(/\s+/g,' ').trim().slice(0,n);
async function persist(){await mkdir(output,{recursive:true});
  await writeFile(join(output,'v3-ab-'+key+'.json'),JSON.stringify(summary,null,2));}
async function run(which){
  const t=performance.now(),pages=[];
  const browser=createPlaywrightBrowserCapture({headless:true});
  const fetcher=async(input,init)=>{
    const url=validatePublicUrl(typeof input==='string'?input:input.url||String(input));
    if(url.hostname!==u.hostname)throw Error('Blocked cross-host request');
    await assertPublicDns(url.hostname);
    return fetch(input,init);
  };
  const extractPage=async target=>{
    await assertPublicDns(u.hostname);
    const result=await extract({url:target,mode:'auto',maxPdfPages:8},
      {fetcher,browser},{allowedHosts:[u.hostname],timeoutMs:10000,maxHtmlPages:1,
        maxBytesHtml:1_250_000,maxBytesPdf:3_000_000},'none');
    pages.push({...result,url:result.sourceUrl||target});
    return result;
  };
  const research=which==='v3'?await runResearchV3({url:u.href,maxPages:limit,delayMs:350,
    extractPage}):await runResearch({url:u.href,maxPages:limit,delayMs:350,extractPage});
  const detected=which==='v3'?extractProductIntelligenceV3({companyName:site.name,rootUrl:u.href,pages}):
    extractProductIntelligence({companyName:site.name,rootUrl:u.href,pages});
  const partEvidence=which==='v3'?enrichPartEvidenceV3({companyName:site.name,companyUrl:u.href,
    products:detected.products,pages,documentLinks:research.documentLinks||[]}):
    buildPartEvidenceReport({companyName:site.name,companyUrl:u.href,products:detected.products,pages});
  return {executionStatus:'completed',elapsedMs:Math.round(performance.now()-t),
    pagesVisited:research.coverage?.visitedPages||0,
    pagesUsable:research.coverage?.successfulPages||pages.filter(p=>['completed','partial'].includes(p.status)).length,
    technicalPages:research.coverage?.technicalPages||0,
    productCandidates:detected.products.length,
    productFamilyLabels:detected.productFamilies?.length||0,
    productMaterialMentions:detected.coverage?.materials||0,
    productComponentMentions:detected.coverage?.components||0,
    sourceSupportedPartCandidates:partEvidence.counts.partEvidenceCandidates,
    sourceSupportedPartMaterialClaims:partEvidence.counts.partMaterialCandidates,
    sourceSupportedPartProcessClaims:partEvidence.counts.partProcessCandidates,
    linkedTechnicalDocumentsAccepted:partEvidence.v3?.linkedDocumentsAccepted||0,
    directProductDocumentLinks:research.documentLinks?.length||0,
    stopReason:research.coverage?.stopReason,
    products:detected.products.slice(0,60).map(x=>({name:clip(x.name,130),sku:x.sku,sourceUrl:x.sourceUrl})),
    partClaimSamples:partEvidence.products.flatMap(p=>p.parts.map(part=>({
      product:p.name,part:part.name,partSource:part.observations?.[0]?.sourceUrl,
      quote:clip(part.observations?.[0]?.quote,250),
      materialClaims:part.materialClaims.slice(0,6).map(m=>({name:m.name,
        quote:clip(m.evidence.quote,260),sourceUrl:m.evidence.sourceUrl})),
      processClaims:part.processClaims.slice(0,6).map(m=>({name:m.name,
        quote:clip(m.evidence.quote,260),sourceUrl:m.evidence.sourceUrl}))}))).slice(0,70),
    pageSample:pages.slice(0,30).map(p=>({url:p.url,status:p.status,
      title:clip(p.content?.title,130),textChars:p.content?.text?.length||0,
      tableCount:p.content?.tables?.length||0,
      pdfPages:p.content?.pdfPages?.length||0,reason:clip(p.reason,130)})),
    errors:research.warnings?.slice(0,12)};
}
await assertPublicDns(u.hostname);
for(const approach of ['v2','v3']){
  console.log('BEGIN '+site.name+' '+approach);
  try{summary.approaches[approach]=await run(approach)}
  catch(e){summary.approaches[approach]={executionStatus:'failed',reason:clip(e?.stack||e,650)};}
  console.log('RESULT '+JSON.stringify({approach,company:site.name,
    pages:summary.approaches[approach].pagesVisited,
    products:summary.approaches[approach].productCandidates,
    parts:summary.approaches[approach].sourceSupportedPartCandidates,
    materials:summary.approaches[approach].sourceSupportedPartMaterialClaims,
    process:summary.approaches[approach].sourceSupportedPartProcessClaims}));
  await persist();await sleep(600);
}
summary.finishedAt=new Date().toISOString();await persist();
console.log('DONE '+site.name+' '+JSON.stringify({v2:summary.approaches.v2?.sourceSupportedPartCandidates,
  v3:summary.approaches.v3?.sourceSupportedPartCandidates}));