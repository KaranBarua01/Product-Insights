#!/usr/bin/env node
/** Fixed seven-company source-backed product intelligence pilot.
 * Re-fetch needed: historical depth reports retained metrics and short excerpts,
 * not full per-page content. No AI, no private taxonomy and no OS writes.
 */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname,join,relative,isAbsolute,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {extract} from '../dist/engine.js';
import {createPlaywrightBrowserCapture} from './node-browser.mjs';
import {prepareSites} from './benchmark-lib.mjs';
import {runResearch} from './research-planner.mjs';
import {extractProductIntelligence,PRODUCT_INTELLIGENCE_SCHEMA} from './product-intelligence.mjs';

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const SITE_IDS=['OS10-001','OS10-003','OS10-005','OS10-006','OS10-008','OS10-009','OS10-010'];
const MAX_PAGES=12,DEADLINE_MS=90000,DELAY_MS=350;
function output(raw){
  const name=String(raw||'').replace(/\\/g,'/');
  if(!/^local-data\/pi-local-agent\/outputs\/[a-zA-Z0-9_-]{8,64}-products7$/.test(name))
    throw Error('Only a fixed private products7 job directory is permitted');
  const path=resolve(ROOT,name),rel=relative(ROOT,path);
  if(rel.startsWith('..'+sep)||rel==='..'||isAbsolute(rel))throw Error('Output escapes workspace');
  return path;
}
function args(xs){
  if(xs.length===1&&xs[0]==='--dry-run')return {dryRun:true};
  if(xs.length===2&&xs[0]==='--out')return {directory:output(xs[1])};
  throw Error('Use --dry-run or --out local-data/pi-local-agent/outputs/<job>-products7');
}
function prioritize({links}){
  const priority=links.filter(x=>/\/(?:product|products|productcategory|product-category|categories|collections|catalog)\//i.test(x.url))
    .slice(0,7);
  const document=links.find(x=>/\.pdf(?:$|\?)/i.test(x.url)&&
    /(?:spec|manual|datasheet|technical|catalog)/i.test(x.url+' '+x.label));
  return [...new Set([...priority.map(x=>x.url),document?.url].filter(Boolean))].slice(0,8);
}
function rollup(rows,key){
  const fields=['pagesUsable','productPages','categoryPages','products','categories','productsWithSpecifications',
    'productsWithComponents','productsWithMaterials','specifications','components','materials','unlinkedProducts'];
  return Object.fromEntries(fields.map(k=>[k,rows.reduce((n,r)=>n+Number(r[key]?.coverage?.[k]||0),0)]));
}
export async function main(argv=process.argv.slice(2)){
  const opts=args(argv);
  const [csv,hosts]=await Promise.all([
    readFile(join(ROOT,'benchmark/insidejob-os-ten-sites.csv'),'utf8'),
    readFile(join(ROOT,'benchmark/insidejob-os-ten-approved-hosts.txt'),'utf8')]);
  const allowed=hosts.split(/\r?\n/).map(s=>s.replace(/#.*/,'').trim()).filter(Boolean);
  const list=prepareSites(csv,allowed,10);
  const selected=SITE_IDS.map(x=>list.find(s=>s.siteId===x));
  if(selected.some(x=>!x)||new Set(selected.map(x=>x.url)).size!==7)throw Error('Fixed seven source sites missing/duplicated');
  if(opts.dryRun){
    console.log(JSON.stringify({status:'DRY_RUN_NO_NETWORK',sites:selected.map(s=>({id:s.siteId,company:s.companyName,url:s.url})),pageBudget:MAX_PAGES}));
    return;
  }
  // Optional browser fallback retains exact-host and robots restrictions.
  let browser=null,browserAvailability='unavailable';
  try{
    await import('playwright');
    browser=createPlaywrightBrowserCapture();
    browserAvailability='installed_browser_binary_not_verified';
  }catch{}
  await mkdir(opts.directory,{recursive:true});
  const rows=[];
  for(const site of selected){
    const host=new URL(site.url).hostname,rawPages=[],start=Date.now();
    let research=null,error=null;
    try{
      research=await runResearch({url:site.url,maxPages:MAX_PAGES,delayMs:DELAY_MS,
        shouldContinue:()=>Date.now()-start<DEADLINE_MS,
        prioritizeLinks:prioritize,
        extractPage:async target=>{
          let result;
          try{
            result=await extract({url:target,mode:'auto',maxPdfPages:8},
              {fetcher:fetch,...(browser?{browser}:{})},
              {allowedHosts:[host],timeoutMs:9000,maxHtmlPages:1,maxBytesPdf:3_000_000});
          }catch(e){
            result={sourceUrl:target,status:'failed',strategy:'none',reason:String(e?.message||e),
              content:{},evidence:[],warnings:[],attempts:[]};
          }
          rawPages.push({...result,url:result.sourceUrl||target});
          return result;
        }});
    }catch(e){error=String(e?.message||e).slice(0,240);}
    const first3=extractProductIntelligence({companyName:site.companyName,rootUrl:site.url,pages:rawPages.slice(0,3)});
    const full=extractProductIntelligence({companyName:site.companyName,rootUrl:site.url,pages:rawPages.slice(0,12)});
    const row={siteId:site.siteId,company:site.companyName,rootUrl:site.url,
      runStatus:error?'error':full.coverage.pagesUsable?'sampled':'no_usable_pages',
      pagesAttempted:rawPages.length,elapsedMs:Date.now()-start,
      stoppingReason:Date.now()-start>=DEADLINE_MS?'site_deadline':rawPages.length>=12?'page_budget':'frontier_exhausted',
      remainingLeads:research?.coverage?.remainingLeads||0,browserAvailability,
      baseline3:first3,depth12:full,
      pageStatuses:rawPages.map(p=>({url:p.url,status:p.status,strategy:p.strategy,reason:String(p.reason||'').slice(0,150)})),
      errors:error?[error]:[]};
    rows.push(row);
    // Private log: counts, never entire copied website text or secrets.
    console.log(JSON.stringify({siteId:row.siteId,status:row.runStatus,visited:rawPages.length,
      products3:first3.coverage.products,products12:full.coverage.products,
      categories12:full.coverage.categories,specifications12:full.coverage.specifications,
      materials12:full.coverage.materials,components12:full.coverage.components}));
  }
  const summary={schemaVersion:PRODUCT_INTELLIGENCE_SCHEMA,siteCount:7,generatedAt:new Date().toISOString(),
    scope:'seven previously accessible websites, fixed host allowlist, up to twelve pages each',
    baseline3:rollup(rows,'baseline3'),depth12:rollup(rows,'depth12'),
    companyResults:rows.map(r=>({siteId:r.siteId,company:r.company,status:r.runStatus,
      pages:r.pagesAttempted,baseline3:r.baseline3.coverage,depth12:r.depth12.coverage})),
    limitations:[
      'All entities, attributes and company roles are source-published candidates pending independent verification.',
      'Not a complete catalog; category-to-product links are not fabricated.',
      'The original depth7 results stored excerpts and coverage counts, not enough full raw evidence for accurate extraction, so this pilot uses a new permitted bounded crawl.',
      'A distributor listing a product is not proof that it manufactures it.',
      'No manufacturing-process inference, RFQ detection, supplier qualification or private taxonomy update.'
    ]};
  await writeFile(join(opts.directory,'summary.json'),JSON.stringify(summary,null,2)+'\n');
  await writeFile(join(opts.directory,'results.json'),JSON.stringify({schemaVersion:PRODUCT_INTELLIGENCE_SCHEMA,rows},null,2)+'\n');
  console.log(JSON.stringify({completed:'products7',siteCount:7,baseline3:summary.baseline3,depth12:summary.depth12}));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))
  main().catch(e=>{console.error(String(e?.message||e));process.exitCode=1;});
