#!/usr/bin/env node
/**
 * Universal Holdout U30: first-pass, cross-industry frozen V1 evaluation.
 * One of five fixed six-site batches per local invocation; no custom domains.
 * All real outcomes are diagnostic until independent human labels exist.
 */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname,relative,isAbsolute,sep,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {extract} from '../dist/engine.js';
import {createPlaywrightBrowserCapture} from './node-browser.mjs';
import {runResearch} from './research-planner.mjs';
import {extractProductIntelligence} from './product-intelligence.mjs';
import {validateLockedCohort,traceabilityChecks,productDuplicateSignals,
  createHumanReviewTemplate,createIndependentRoleTemplate,UNIVERSAL_SCHEMA} from './universal-validation.mjs';

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const DATA='local-data/pi-local-agent/outputs';
const MAX_PAGES=12,PER_SITE_MS=65_000,DELAY_MS=350;
const BATCHES=new Set(['A','B','C','D','E']);
const SOURCES=[
  'benchmark/universal-v1/cohort.csv','benchmark/universal-v1/hosts.txt',
  'benchmark/universal-v1/cohort-lock.json',
  'tools/product-intelligence.mjs','tools/research-planner.mjs',
  'benchmark/insidejob-os-ten-sites.csv','benchmark/sites.example.csv'
];
async function getCohort(){
  const [cohortCsv,hostsText,lockJson,extractorSource,plannerSource,regressionCsv,priorScrapperCsv]=
    await Promise.all(SOURCES.map(path=>readFile(join(ROOT,path),'utf8')));
  const lock=JSON.parse(lockJson);
  return validateLockedCohort({cohortCsv,hostsText,lock,extractorSource,
    plannerSource,priorCsvs:[regressionCsv,priorScrapperCsv]});
}
function targetPath(v,batch){
  const p=String(v||'').replace(/\\/g,'/');
  const expect=new RegExp('^local-data/pi-local-agent/outputs/[A-Za-z0-9_-]{8,64}-u30'+batch+'$');
  if(!expect.test(p))throw Error('Output path is not an approved private U30 batch directory');
  const full=resolve(ROOT,p),rel=relative(ROOT,full);
  if(rel.startsWith('..'+sep)||rel==='..'||isAbsolute(rel))throw Error('Output escapes Scrappers workspace');
  return full;
}
function parseArgs(argv){
  if(argv.length===1&&argv[0]==='--dry-run')return {dryRun:true};
  if(argv.length===4&&argv[0]==='--batch'&&BATCHES.has(argv[1])&&argv[2]==='--out')
    return {batch:argv[1],out:targetPath(argv[3],argv[1])};
  throw Error('Use --dry-run or --batch [A-E] --out local-data/pi-local-agent/outputs/<job>-u30[BATCH]');
}
function prioritize({links}){
  // Identical policy to the previous seven-company Product Intelligence pilot:
  // the holdout must not receive tailored navigation or extraction rules.
  const priority=links.filter(x=>/\/(?:product|products|productcategory|product-category|categories|collections|catalog)\//i.test(x.url)).slice(0,7);
  const document=links.find(x=>/\.pdf(?:$|\?)/i.test(x.url)&&
    /(?:spec|manual|datasheet|technical|catalog)/i.test(x.url+' '+x.label));
  return [...new Set([...priority.map(x=>x.url),document?.url].filter(Boolean))].slice(0,8);
}
const SCORE_FIELDS=['pagesSubmitted','pagesUnique','pagesUsable','productPages',
  'categoryPages','products','categories','productsWithSpecifications','productsWithComponents',
  'productsWithMaterials','specifications','components','materials','unlinkedProducts'];
function summaryCounts(rows,key){
  return Object.fromEntries(SCORE_FIELDS.map(k=>[k,
    rows.reduce((n,r)=>n+Number(r[key]?.coverage?.[k]||0),0)]));
}
export function summarizeHoldout(rows,batch,cohort){
  if(!BATCHES.has(batch)||rows.length!==6)throw Error('Incorrect fixed U30 batch results');
  const initial=summaryCounts(rows,'baseline3'),expanded=summaryCounts(rows,'depth12');
  const t={claims:0,matched:0,unmatched:0,offHost:0,samePageNormalizedNameGroups:0};
  for(const r of rows){
    t.claims+=r.traceability.claimCount;t.matched+=r.traceability.matched;
    t.unmatched+=r.traceability.unmatched;t.offHost+=r.traceability.offHost;
    t.samePageNormalizedNameGroups+=r.duplicateSignals.samePageNormalizedNameGroups;
  }
  return {
    schemaVersion:UNIVERSAL_SCHEMA,batch,siteCount:rows.length,
    finishedAt:new Date().toISOString(),frozenLockPins:cohort.lockPins,
    baseline3:initial,depth12:expanded,sourceSignals:{
      ...t,claimTraceabilityPct:t.claims?Number((100*t.matched/t.claims).toFixed(1)):null
    },
    byCompany:rows.map(r=>({siteId:r.siteId,company:r.company,industry:r.industry,
      roleStratum:r.roleStratum,runStatus:r.runStatus,pagesAttempted:r.pagesAttempted,
      products:r.depth12.coverage.products,categories:r.depth12.coverage.categories,
      attributes:r.depth12.coverage.specifications+r.depth12.coverage.components+
        r.depth12.coverage.materials,traceMatched:r.traceability.matched,
      traceUnmatched:r.traceability.unmatched})),
    qualityStatus:'unreviewed_no_product_accuracy',
    limitations:[
      'No product, OEM role, manufacturing-process or category accuracy is measured without independent human review.',
      'Service and contract manufacturers may correctly have no published own-brand product SKUs.',
      'Page/record counts and traceability checks are retrieval diagnostics only.',
      'Blocked or access-denied domains are recorded, never bypassed.',
      'This first U30 cohort is geographically and linguistically limited and cannot establish universal generalization.'
    ]};
}
export async function main(argv=process.argv.slice(2)){
  const options=parseArgs(argv),cohort=await getCohort();
  if(options.dryRun){
    console.log(JSON.stringify({status:'FROZEN_U30_DRY_RUN_NO_NETWORK',sites:cohort.siteCount,
      sectors:cohort.sectorCount,batches:cohort.batches,lockPins:cohort.lockPins,
      targets:cohort.sites.map(s=>({id:s.siteId,batch:s.batch,industry:s.industry,roleStratum:s.roleStratum,host:s.host}))},null,2));
    return;
  }
  const sites=cohort.sites.filter(x=>x.batch===options.batch);
  if(sites.length!==6)throw Error('Not a six-site frozen cohort batch');
  let browser=null,browserState='not_installed';
  try{await import('playwright');browser=createPlaywrightBrowserCapture();browserState='playwright_installed';}
  catch{}
  await mkdir(options.out,{recursive:true});
  const rows=[];
  for(const site of sites){
    const start=Date.now(),rawPages=[],host=new URL(site.url).hostname;
    let research=null,error=null;
    try{
      research=await runResearch({
        url:site.url,maxPages:MAX_PAGES,delayMs:DELAY_MS,
        shouldContinue:()=>Date.now()-start<PER_SITE_MS,
        prioritizeLinks:prioritize,
        extractPage:async target=>{
          let result;
          try{
            result=await extract({url:target,mode:'auto',maxPdfPages:8},
              {fetcher:fetch,...(browser?{browser}:{})},
              {allowedHosts:[host],timeoutMs:9000,maxHtmlPages:1,maxBytesPdf:3_000_000});
          }catch(e){
            result={sourceUrl:target,status:'failed',strategy:'none',reason:String(e?.message||e).slice(0,220),
              content:{},evidence:[],warnings:[],attempts:[]};
          }
          rawPages.push({...result,url:result.sourceUrl||target});
          return result;
        }});
    }catch(e){error=String(e?.message||e).slice(0,240);}
    const base=extractProductIntelligence({companyName:site.companyName,rootUrl:site.url,pages:rawPages.slice(0,3)});
    const full=extractProductIntelligence({companyName:site.companyName,rootUrl:site.url,pages:rawPages.slice(0,12)});
    const traceability=traceabilityChecks(full,rawPages);
    const duplicateSignals=productDuplicateSignals(full);
    const elapsed=Date.now()-start;
    rows.push({
      siteId:site.siteId,company:site.companyName,industry:site.industry,
      roleStratum:site.roleStratum,roleStratumIsTruth:false,rootUrl:site.url,
      runStatus:error?'run_error':full.coverage.pagesUsable?'sampled':'no_usable_pages',
      pagesAttempted:rawPages.length,elapsedMs:elapsed,
      stoppingReason:elapsed>=PER_SITE_MS?'site_deadline':
        rawPages.length>=MAX_PAGES?'page_budget':'frontier_exhausted',
      remainingLeads:research?.coverage?.remainingLeads??null,
      browserAvailability:browserState,
      baseline3:base,depth12:full,
      traceability,duplicateSignals,
      pageStatuses:rawPages.map(p=>({url:p.url,status:p.status,strategy:p.strategy,
        reason:String(p.reason||'').slice(0,170)})),
      errors:error?[error]:[]
    });
    console.log(JSON.stringify({site:site.siteId,industry:site.industry,
      status:rows.at(-1).runStatus,pages:rawPages.length,
      products:full.coverage.products,categories:full.coverage.categories,
      claims:traceability.claimCount,quoteMatched:traceability.matched,elapsedMs:elapsed}));
    await new Promise(r=>setTimeout(r,1100));
  }
  const summary=summarizeHoldout(rows,options.batch,cohort);
  const review=createHumanReviewTemplate(rows,{maxProductsPerSite:5,maxAttributesPerProduct:3});
  const roleReview=createIndependentRoleTemplate(rows);
  summary.reviewTemplateRows=review.rows;
  summary.roleReviewTemplateRows=roleReview.siteCount;
  await Promise.all([
    writeFile(join(options.out,'summary.json'),JSON.stringify(summary,null,2)+'\n'),
    writeFile(join(options.out,'results.json'),JSON.stringify({schemaVersion:UNIVERSAL_SCHEMA,
      batch:options.batch,rows},null,2)+'\n'),
    writeFile(join(options.out,'manual-review.csv'),review.csv),
    writeFile(join(options.out,'manual-role-review.csv'),roleReview.csv)
  ]);
  console.log(JSON.stringify({status:'U30_BATCH_COMPLETED',batch:options.batch,
    reviewRows:review.rows,baseline3:summary.baseline3,depth12:summary.depth12,
    quoteMatchPct:summary.sourceSignals.claimTraceabilityPct}));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))
  main().catch(e=>{console.error(String(e?.message||e));process.exitCode=1;});
