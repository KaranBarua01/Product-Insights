#!/usr/bin/env node
/**
 * Fixed seven-site, 3-versus-12-page information acquisition experiment.
 * Only the seven accessible sites from the OS10 first pass. No arbitrary targets,
 * no AI, no taxonomy mutation, no claims of catalog completeness.
 *
 * One 12-page deterministic research trace per site: first 3 visited pages form
 * the strictly comparable baseline, pages 1..12 form the deeper arm.
 */
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,dirname,join,relative,isAbsolute,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {extract} from '../dist/engine.js';
import {createPlaywrightBrowserCapture} from './node-browser.mjs';
import {runResearch} from './research-planner.mjs';
import {prepareSites} from './benchmark-lib.mjs';
import {sampleExtraction,compareDepth,DEPTH_METRICS} from './depth-coverage.mjs';

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const SITE_IDS=Object.freeze(['OS10-001','OS10-003','OS10-005','OS10-006','OS10-008','OS10-009','OS10-010']);
const LIST='benchmark/insidejob-os-ten-sites.csv';
const HOSTS='benchmark/insidejob-os-ten-approved-hosts.txt';
const OUTPUT_PREFIX='local-data/pi-local-agent/outputs/';
const BUDGET=12,PER_SITE_DEADLINE_MS=90_000,DELAY_MS=350;
function outputPath(raw){
  const normalized=String(raw||'').replace(/\\/g,'/');
  if(!/^local-data\/pi-local-agent\/outputs\/[a-zA-Z0-9_-]{8,64}-depth7$/.test(normalized))
    throw Error('Output must be a bounded private depth7 job directory');
  const dest=resolve(ROOT,normalized);
  const rel=relative(ROOT,dest);
  if(rel.startsWith('..'+sep)||rel==='..'||isAbsolute(rel))throw Error('Invalid output location');
  return dest;
}
function args(argv){
  if(argv.length===1&&argv[0]==='--dry-run')return {dryRun:true};
  if(argv.length===2&&argv[0]==='--out')return {out:outputPath(argv[1]),dryRun:false};
  throw Error('Usage: node tools/depth-benchmark.mjs --dry-run OR --out local-data/pi-local-agent/outputs/JOB-depth7');
}
function priority({links}){
  // Resolve product documentation before generic navigation, preserving the
  // research planner's reserved company-identity page.
  const pdf=links.find(x=>/\.pdf(?:$|\?)/i.test(x.url));
  const detail=links.find(x=>/\/(?:products?|product|catalog)\/[^/?]+(?:\/|$)/i.test(new URL(x.url).pathname));
  const category=links.find(x=>/\/(?:products?|categories?|collections?)(?:\/|$)/i.test(new URL(x.url).pathname));
  return [...new Set([pdf?.url,detail?.url,category?.url].filter(Boolean))].slice(0,3);
}
function scoreTotals(rows,arm){
  const numbers=['attemptedPages','usablePages','blockedPages','otherFailedPages','uniqueSuccessfulSourceUrls',
    'textChars','evidenceRecords','categoryPageLeads','productDetailPageLeads','capabilityPages',
    'categoryLinkLeads','productLinkLeads','jsonLdProductRecords','pdfLinksDiscovered',
    'pdfDocumentsRead','pdfPagesRead','technicalEvidencePages','technicalLineSignals',
    'browserAttempts','browserSuccesses'];
  return Object.fromEntries(numbers.map(k=>[k,rows.reduce((sum,row)=>sum+Number(row[arm]?.[k]||0),0)]));
}
export function summarizeDepthBatch(rows){
  const baseline3=scoreTotals(rows,'baseline3'),depth12=scoreTotals(rows,'depth12');
  const gain=Object.fromEntries(DEPTH_METRICS.map(k=>[k,depth12[k]-baseline3[k]]));
  return {schemaVersion:'pi-depth-benchmark/v1',generatedAt:new Date().toISOString(),
    siteCount:rows.length,selectedSiteIds:[...SITE_IDS],maxPageBudget:12,baselineDefinition:'first three pages from the same twelve-page deterministic research trace',
    coverageDefinition:'Observed source and lead counts, not product classification or manufacturing accuracy',
    baseline3,depth12,gain,
    reasons:rows.map(row=>({siteId:row.siteId,status:row.status,stoppingReason:row.stoppingReason,
      attempted:row.depth12?.attemptedPages||0})),
    limitations:[
      'Counts of product pages, categories, specifications and JSON-LD are unverified discovery signals, not approved manufacturer facts.',
      'Crawl follows observed same-host links only, obeys robots and access controls; off-host PDFs and blocked hosts are excluded.',
      'No model, AI classification, semantic catalog completeness, supplier matching or process inference ran.',
      '3-page prefix uses same deeper crawl trajectory; it is not a rerun of the earlier 10-company S01 benchmark.',
      'JavaScript browser fallback is selective and optional, not guaranteed on every machine.'
    ]};
}
async function main(argv=process.argv.slice(2)){
  const options=args(argv);
  const csv=await readFile(join(ROOT,LIST),'utf8');
  const hosts=await readFile(join(ROOT,HOSTS),'utf8');
  const all=prepareSites(csv,hosts.split(/\r?\n/).map(s=>s.split('#')[0].trim()).filter(Boolean),10);
  const selected=SITE_IDS.map(id=>all.find(x=>x.siteId===id));
  if(selected.some(x=>!x)||new Set(selected.map(x=>x.url)).size!==7)throw Error('Missing or duplicate seven known OS10 site IDs');
  if(options.dryRun){
    console.log(JSON.stringify({status:'DRY_RUN_NO_NETWORK',sites:selected.map(x=>({siteId:x.siteId,company:x.companyName,url:x.url})),budget:BUDGET},null,2));
    return;
  }
  // Playwright is an optional dependency. The adapter only runs when sparse
  // HTML asks for escalation; it maintains exact-host/robots restrictions.
  let browser,availability='not_installed';
  try{await import('playwright');browser=createPlaywrightBrowserCapture();availability='installed_browser_binary_not_verified';}
  catch{availability='not_installed';}
  await mkdir(options.out,{recursive:true});
  const data=[];
  for(const site of selected){
    const start=Date.now(),deadline=start+PER_SITE_DEADLINE_MS,records=[],host=new URL(site.url).hostname;
    let research=null,error=null;
    try{
      research=await runResearch({
        url:site.url,maxPages:BUDGET,delayMs:DELAY_MS,shouldContinue:()=>Date.now()<deadline,
        prioritizeLinks:priority,
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
          records.push(sampleExtraction(target,result,host));
          return result;
        }
      });
    }catch(e){error=String(e?.message||e).slice(0,250);}
    const {baseline3,depth12,gain}=compareDepth(records);
    const stoppingReason=Date.now()>=deadline?'site_deadline':records.length>=12?'page_budget':
      (research?.coverage?.remainingLeads||0)>0?'frontier_remaining_unresolved':'frontier_exhausted';
    const status=error?'error':records.some(x=>['completed','partial'].includes(x.status))?'sampled':'no_usable_pages';
    const row={siteId:site.siteId,company:site.companyName,homeUrl:site.url,status,
      durationMs:Date.now()-start,stoppingReason,browserAvailability:availability,
      discoveredLeads:research?.coverage?.discoveredLeads??0,
      remainingLeads:research?.coverage?.remainingLeads??0,
      baseline3,depth12,gain,errors:error?[error]:[]};
    data.push(row);
    console.log(JSON.stringify({siteId:row.siteId,company:row.company,status:row.status,
      pages3:baseline3.usablePages,pages12:depth12.usablePages,
      products3:baseline3.jsonLdProductRecords,products12:depth12.jsonLdProductRecords,
      spec3:baseline3.technicalLineSignals,spec12:depth12.technicalLineSignals,
      pdfsRead:depth12.pdfDocumentsRead,stop:stoppingReason}));
  }
  const summary=summarizeDepthBatch(data);
  const resultsPath=join(options.out,'results.json'),summaryPath=join(options.out,'summary.json');
  await writeFile(summaryPath,JSON.stringify(summary,null,2)+'\n');
  await writeFile(resultsPath,JSON.stringify({schemaVersion:summary.schemaVersion,rows:data},null,2)+'\n');
  console.log('Completed seven-site research comparison; private artifact directory: '+OUTPUT_PREFIX+'<job>-depth7');
  console.log(JSON.stringify({baseline3:summary.baseline3,depth12:summary.depth12,gain:summary.gain}));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))
  main().catch(e=>{console.error(String(e?.message||e));process.exitCode=1;});
