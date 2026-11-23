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
// Deliberately diverse generalization holdout: no V3 development targets.
const companies={
  hammond:{name:'Hammond Manufacturing',url:'https://www.hammfg.com/',sector:'Electrical enclosures'},
  boschrexroth:{name:'Bosch Rexroth',url:'https://www.boschrexroth.com/',sector:'Hydraulics and industrial automation'},
  sparkfun:{name:'SparkFun',url:'https://www.sparkfun.com/',sector:'Electronics components'},
  prusa:{name:'Prusa Research',url:'https://www.prusa3d.com/',sector:'3D printers'},
  smc:{name:'SMC USA',url:'https://www.smcusa.com/',sector:'Pneumatics and motion systems'},
  automationdirect:{name:'AutomationDirect',url:'https://www.automationdirect.com/',sector:'Industrial automation distributor'},
  adafruit:{name:'Adafruit',url:'https://www.adafruit.com/',sector:'Electronic modules and boards'},
  genomics:{name:'10x Genomics',url:'https://www.10xgenomics.com/',sector:'Scientific instruments'},
  flowserve:{name:'Flowserve',url:'https://www.flowserve.com/',sector:'Industrial pumps and seals'},
  ricelake:{name:'Rice Lake Weighing Systems',url:'https://www.ricelake.com/',sector:'Weighing and measurement'}
};
const key=process.env.PI_V3_SITE||'hammond';
if(!Object.hasOwn(companies,key))throw Error('Unknown test company');
const site=companies[key],u=validatePublicUrl(site.url);
const limit=Number(process.env.PI_V3_PAGE_LIMIT||15);
if(!Number.isInteger(limit)||limit<2||limit>50)throw Error('Page limit must be 2-50');
const fair=limit<=30;
const output=resolve('v3-generalization-holdout-results');
const summary={schemaVersion:'pi-research-v3-generalization-holdout/1',site,limit,
  runner:'github-hosted-ubuntu',startedAt:new Date().toISOString(),
  controlledVariables:fair?'same company, same 15-page ceiling, shared source extractor and identical browser fallback; V3 has evidence-first page selection':
    'V3-only 50-page exploratory run, NOT a fair V2/V3 comparison',
  caveats:['Order effects and site volatility are not randomized.',
    'Candidate counts do not prove precision or true part recall.',
    'Blocked sites are access failures, not negative manufacturing evidence.',
    'No production D1 credentials or private taxonomy',
    'No automatic classification as in-house manufacturing',
    'Some sites were in previous V2 benchmarks, but none are V3 tuning targets.',
    'No manually validated accuracy labels are included in raw counts.'],approaches:{}};
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
  const research=which==='v3'?await runResearchV3({url:u.href,maxPages:limit,delayMs:250,
    extractPage}):await runResearch({url:u.href,maxPages:limit,delayMs:250,extractPage});
  const detected=which==='v3'?extractProductIntelligenceV3({companyName:site.name,rootUrl:u.href,pages}):
    extractProductIntelligence({companyName:site.name,rootUrl:u.href,pages});
  const partEvidence=which==='v3'?enrichPartEvidenceV3({companyName:site.name,companyUrl:u.href,
    products:detected.products,pages,documentLinks:research.documentLinks||[]}):
    buildPartEvidenceReport({companyName:site.name,companyUrl:u.href,products:detected.products,pages});
  return {executionStatus:'completed',elapsedMs:Math.round(performance.now()-t),
    pagesVisited:research.coverage?.visitedPages||0,
    pagesUsable:research.coverage?.successfulPages||pages.filter(p=>['completed','partial'].includes(p.status)).length,
    pagesBlocked:pages.filter(p=>p.status==='blocked').length,
    pagesFailed:pages.filter(p=>p.status==='failed'||p.status==='unsupported').length,
    technicalPages:research.coverage?.technicalPages||0,
    productCandidates:detected.products.length,
    productFamilyLabels:detected.productFamilies?.length||0,
    productMaterialMentions:detected.coverage?.materials||0,
    productComponentMentions:detected.coverage?.components||0,
    sourceSupportedPartCandidates:partEvidence.counts.partEvidenceCandidates,
    distinctSourceParts:new Set(partEvidence.products.flatMap(p=>p.parts.map(part=>
      p.sourceUrl.toLowerCase()+'|'+part.name.toLowerCase()))).size,
    distinctFamilyParts:new Set(partEvidence.products.flatMap(p=>p.parts.map(part=>
      p.name.replace(/\s*\([^)]{4,}\)\s*$/,'').toLowerCase()+'|'+part.name.toLowerCase()))).size,
    sourceSupportedPartMaterialClaims:partEvidence.counts.partMaterialCandidates,
    sourceSupportedPartProcessClaims:partEvidence.counts.partProcessCandidates,
    linkedTechnicalDocumentsAccepted:partEvidence.v3?.linkedDocumentsAccepted||0,
    sourceClaimQuality:'unreviewed_candidate_counts_not_automatic_precision',
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
    pageSample:pages.slice(0,limit).map(p=>({url:p.url,status:p.status,
      title:clip(p.content?.title,130),textChars:p.content?.text?.length||0,
      tableCount:p.content?.tables?.length||0,
      pdfPages:p.content?.pdfPages?.length||0,reason:clip(p.reason,130)})),
    errors:research.warnings?.slice(0,12)};
}
await assertPublicDns(u.hostname);
for(const approach of fair?['v2','v3']:['v3']){
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