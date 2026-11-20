#!/usr/bin/env node
/**
 * Genuine, bounded, LOCAL-LAB-only cross-industry acceptance benchmark.
 * The laptop owner initiates this; no Cloudflare token, GitHub queue or
 * arbitrary remote shell. One company at a time, never overlaps active work.
 */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {dirname,resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {validatePublicCompanyUrl} from '../../live-lab/src/protocol.js';
import {assertPublicDns} from './research-lab-security.mjs';

export const DIVERSITY_BENCHMARK_SCHEMA='pi-diverse-public-company-benchmark/v1';
const BASE=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const LOCAL='http://127.0.0.1:8790';
const defaultSites=resolve(BASE,'benchmark','new-company-diversity-sites.txt');
const pause=t=>new Promise(r=>setTimeout(r,t));
const num=x=>Number.isFinite(Number(x))?Math.max(0,Number(x)):0;
const short=(x,n=170)=>String(x??'').replace(/\s+/g,' ').trim().slice(0,n);
function parseArgs(args){
 const out={file:defaultSites,maxSites:4,pages:3,output:resolve(BASE,'local-data','new-company-benchmark')};
 for(let i=0;i<args.length;i++){
   const flag=args[i],v=args[i+1];
   if(flag==='--sites'&&v){out.file=resolve(v);i++;}
   else if(flag==='--max'&&v){out.maxSites=Number(v);i++;}
   else if(flag==='--pages'&&v){out.pages=Number(v);i++;}
   else if(flag==='--output'&&v){out.output=resolve(v);i++;}
   else throw Error('Usage: node tools/test-diverse-company-websites.mjs [--sites list.txt] [--pages 3|7|12] [--max 1..8] [--output directory]');
 }
 if(![3,7,12].includes(out.pages)||!Number.isInteger(out.maxSites)||out.maxSites<1||out.maxSites>8)
   throw Error('Benchmark permits 3, 7 or 12 pages and at most 8 companies');
 return out;
}
export async function readSiteList(file,{max=8}={}){
 const raw=await readFile(file,'utf8');
 if(raw.length>7000)throw Error('Site list is too large');
 const urls=[],hosts=new Set();
 for(const line of raw.split(/\r?\n/)){
   const value=line.trim();
   if(!value||value.startsWith('#'))continue;
   const target=validatePublicCompanyUrl(value);
   if(hosts.has(target.host))continue;
   urls.push(target.url);hosts.add(target.host);
   if(urls.length>20)throw Error('Site list supports at most 20 unique public company hosts');
 }
 if(!urls.length)throw Error('No public HTTPS company URLs in site list');
 return urls.slice(0,max);
}
function localFetch(path,{method='GET',token=null,body=null,timeoutMs=9000}={}){
 return fetch(LOCAL+path,{method,redirect:'error',headers:{
   ...(token?{'x-lab-token':token}:{}),
   ...(body?{'content-type':'application/json'}:{})},
   body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(timeoutMs)})
 .then(async res=>{
   const data=await res.json().catch(()=>({error:'Lab returned non-JSON'}));
   if(!res.ok)throw Error('Local '+path+' HTTP '+res.status+': '+short(data.error||data.reason||'',190));
   return data;
 });
}
export function summarizeLabReport(requestedUrl,run,{pages,startedAt,finishedAt,editionBefore=null,editionAfter=null}={}){
 const report=run.report||{},pi=report.productIntelligence||{},g=report.researchGraph||{},
   ollama=report.lab?.ollama||{},a=report.relationshipAi||{},coverage=report.coverage||{};
 const items=Array.isArray(report.pages)?report.pages:[],found=Array.isArray(pi.products)?pi.products:[],
   completed=items.filter(x=>x.status==='completed'||x.status==='partial').length;
 const parts=found.reduce((n,p)=>n+(Array.isArray(p.components)?p.components.length:0),0),
   materials=found.reduce((n,p)=>n+(Array.isArray(p.materials)?p.materials.length:0),0);
 const issue=[];
 if(!run.ok||report.status==='no_successful_pages')issue.push('no_successful_pages');
 if(items.length<2)issue.push('single_page_only');
 if(!found.length)issue.push('zero_product_candidates');
 if(!g.counts?.processHypotheses)issue.push('no_process_hypotheses');
 if(!g.counts?.taxonomyMappings)issue.push('no_taxonomy_mappings');
 if(!['ready','completed','enriched','ok'].includes(String(ollama.status||'').toLowerCase()))
   issue.push('local_ollama_not_confirmed_enriched');
 if(!editionAfter||editionAfter.version===editionBefore?.version)issue.push('working_edition_did_not_advance');
 return {site:requestedUrl,startedAt,finishedAt,status:run.ok?'completed':'failed',
   researchStatus:short(report.status,45),requestedPages:pages,visitedPages:items.length,
   completedPages:completed,discoveredLeads:num(coverage.discoveredLeads),
   products:found.length,productNames:found.slice(0,10).map(x=>short(x.name,120)),
   componentMentions:parts,materialMentions:materials,
   sourceGraph:{products:num(g.counts?.products),observedParts:num(g.counts?.observedParts),
     aiHypotheticalParts:num(g.counts?.aiHypothesisParts),processHypotheses:num(g.counts?.processHypotheses),
     taxonomyMappings:num(g.counts?.taxonomyMappings),unmappedParts:num(g.counts?.unmappedParts),
     unmappedProducts:num(g.counts?.unmappedProducts)},
   laptopAi:{status:short(ollama.status,70),model:short(ollama.model,85),
     reviewed:num(ollama.productsReviewed),acceptedClaims:num(ollama.acceptedClaims),
     rejectedClaims:num(ollama.rejectedClaims),
     inferredPartsStatus:short(a.status,80),inferredPartProposals:num(a.hypotheses)},
   localEditionVersionBefore:editionBefore?.version??null,
   localEditionVersionAfter:editionAfter?.version??null,
   accessWarnings:(Array.isArray(report.warnings)?report.warnings:[]).slice(0,8).map(x=>short(x,180)),
   pageStatuses:items.slice(0,12).map(x=>({
     status:short(x.status,30),strategy:short(x.strategy,25),url:short(x.url,400),
     reason:short(x.reason,120)})),
   issues:issue,analysis:'Actual local research result; not a claim of complete product catalog or confirmed bill of materials.'};
}
function makeMarkdown(rows){
 let s='# Product Insights — diverse public company website benchmark\n\n';
 s+='These are actual local laptop runs, not simulated website or Ollama results. All product, part and process claims require review.\n\n';
 s+='| Company host | Pages visited | Products | Parts mentioned | Materials | Possible processes | Taxonomy mappings | AI status | Flags |\n|---|---:|---:|---:|---:|---:|---:|---|---|\n';
 for(const r of rows){
   s+='| '+new URL(r.site).hostname+' | '+(r.visitedPages??'—')+' | '+(r.products??'—')+' | '+(r.componentMentions??'—')+' | '+(r.materialMentions??'—')+' | '+(r.sourceGraph?.processHypotheses??'—')+' | '+(r.sourceGraph?.taxonomyMappings??'—')+' | '+(r.laptopAi?.status||r.status)+' | '+(r.issues||[]).join(', ')+' |\n';
 }
 s+='\n## Site-by-site failures and evidence checks\n\n';
 for(const r of rows){
   s+='### '+r.site+'\n\n';
   s+='Research: '+r.status+'; visited '+(r.visitedPages??0)+' pages, '+(r.products??0)+' product candidates.\n\n';
   s+='Flags: '+((r.issues||[]).join(', ')||'none in basic checks')+'.\n\n';
   if(r.error)s+='Failure: '+r.error+'\n\n';
   if(r.productNames?.length)s+='Observed product candidates: '+r.productNames.join('; ')+'\n\n';
   if(r.accessWarnings?.length)s+='Access notes: '+r.accessWarnings.join('; ')+'\n\n';
 }
 return s;
}
export async function runDiversityBenchmark(config,{logger=console}={}){
 const sites=await readSiteList(config.file,{max:config.maxSites});
 const health=await localFetch('/health');
 if(health.service!=='InsideJob Research Lab'||health.access!=='loopback_only'||
   health.foundationVersion!=='pi-code-foundation/v1'||health.anyCompanyTesting!==true)
   throw Error('Port 8790 must host the approved local Foundation Research Lab');
 let status=await localFetch('/api/status');
 if(status.busy)throw Error('Research Lab is already busy; do not interrupt the active Cloudflare investigation');
 const page=await fetch(LOCAL+'/',{redirect:'error',signal:AbortSignal.timeout(9000)});
 const html=await page.text(),match=html.match(/<meta name="lab-token" content="([a-f0-9]{64})"/);
 if(!page.ok||!match)throw Error('Could not retrieve Lab session token from local loopback');
 const token=match[1];
 const results=[],startedAt=new Date().toISOString();
 await mkdir(config.output,{recursive:true,mode:0o700});
 const safeWrite=async()=>{
   const file={schemaVersion:DIVERSITY_BENCHMARK_SCHEMA,startedAt,updatedAt:new Date().toISOString(),
     localFoundationVersion:health.foundationVersion,pagesPerSite:config.pages,results};
   await writeFile(join(config.output,'PI-DIVERSE-COMPANY-RESULTS.json'),JSON.stringify(file,null,2),'utf8');
   await writeFile(join(config.output,'PI-DIVERSE-COMPANY-REPORT.md'),makeMarkdown(results),'utf8');
 };
 for(let i=0;i<sites.length;i++){
   const site=sites[i],started=new Date().toISOString();
   logger.log('['+(i+1)+'/'+sites.length+'] Investigating public company:',site);
   let row=null;
   try{
     await assertPublicDns(new URL(site).hostname);
     status=await localFetch('/api/status');
     if(status.busy)throw Error('Research Lab busy (another process started a test); not overwriting it');
     const before=await localFetch('/api/working-edition/summary').catch(()=>null);
     const run=await localFetch('/api/run',{method:'POST',token,body:{
       url:site,maxPages:config.pages,strategy:'auto',browser:'headless'},timeoutMs:440000});
     const after=await localFetch('/api/working-edition/summary').catch(()=>null);
     row=summarizeLabReport(site,run,{pages:config.pages,startedAt:started,
       finishedAt:new Date().toISOString(),editionBefore:before,editionAfter:after});
   }catch(e){
     row={site,startedAt:started,finishedAt:new Date().toISOString(),status:'failed',
       error:short(e?.message||e,400),issues:['execution_failed'],visitedPages:0,products:0};
   }
   results.push(row);
   await safeWrite();
   logger.log('Result: '+row.status+'; '+(row.visitedPages||0)+' pages, '+
     (row.products||0)+' products; flags: '+(row.issues||[]).join(','));
   if(i<sites.length-1)await pause(1000);
 }
 return {schemaVersion:DIVERSITY_BENCHMARK_SCHEMA,startedAt,results,
   outputDirectory:config.output};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 runDiversityBenchmark(parseArgs(process.argv.slice(2))).then(r=>{
   console.log('Benchmark complete. Results:',r.outputDirectory);
   console.log('Review PI-DIVERSE-COMPANY-REPORT.md and PI-DIVERSE-COMPANY-RESULTS.json');
 }).catch(e=>{console.error('Benchmark could not run:',String(e?.message||e));process.exitCode=1;});
}
