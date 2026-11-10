import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {parseCsv,csvEncode,prepareSites,prepareLabels,evaluateSite,summarize,runBenchmark,writeArtifacts,buildReviewTemplate} from '../tools/benchmark-lib.mjs';
const A='https://manufacturer.com/products';
const B='https://another.com/';
const sampleSites=[{siteId:'A',companyName:'Manufacturer',url:A},{siteId:'B',companyName:'Another',url:B}];
const sampleHtml='Industrial pump housing specifications include cast iron materials, CNC machining services, and custom castings. '.repeat(2);
function response(site,changes={}) {return {
  schemaVersion:'0.1',requestedUrl:site.url,sourceUrl:site.url,status:'completed',strategy:'S01',reason:'HTML parsed',
  routing:{strategy:'S01',reason:'HTTP first',patternIds:[],provenance:'none'},
  content:{title:'Industrial components',text:sampleHtml,headings:['Industrial components'],links:[]},
  evidence:[{sourceUrl:site.url,locator:'h1',excerpt:'Industrial components',method:'S01'}],
  attempts:[{strategy:'S01',status:'completed',reason:'OK',durationMs:10}],warnings:[],...changes
};}

test('CSV parser handles BOM, commas, quoted fields, CRLF and Unicode',()=>{
 const csv='\uFEFFsite_id,company_name,url\r\nA,"Works, Inc.",https://manufacturer.com/products\r\nB,"High ""Precision"" Co",https://another.com/\r\n';
 const parsed=parseCsv(csv);
 assert.equal(parsed.length,2);assert.equal(parsed[0].company_name,'Works, Inc.');assert.equal(parsed[1].company_name,'High "Precision" Co');
 assert.equal(parseCsv(csvEncode([['name','notes'],['x','field, "quoted"']]))[0].notes,'field, "quoted"');
 assert.throws(()=>parseCsv('a,b\n"unclosed,x'),/unterminated/);
 assert.throws(()=>parseCsv('a,b\n1'),/expected 2 fields/);
});
test('explicit allowlist, duplicate IDs and private URLs are rejected before network calls',()=>{
 assert.throws(()=>prepareSites('site_id,url\nA,https://manufacturer.com/\n',''),/allowlist is empty/);
 assert.throws(()=>prepareSites('site_id,url\nA,https://unapproved.com/\n',['manufacturer.com']),/Host not on ALLOWED_HOSTS/);
 assert.throws(()=>prepareSites('site_id,url\nA,http://127.0.0.1/\n',['manufacturer.com']),/IP literals/);
 assert.throws(()=>prepareSites('site_id,url\nA,https://manufacturer.com/\nA,https://manufacturer.com/products\n',['manufacturer.com']),/Duplicate site_id/);
 const many=Array.from({length:31},(_,i)=>`A${i},https://manufacturer.com/${i}`).join('\n');
 assert.throws(()=>prepareSites('site_id,url\n'+many,['manufacturer.com']),/max is 30/);
});
test('manual labels remain unscored unless reviewed=yes; invalid labels rejected',()=>{
 const sites=prepareSites('site_id,url\nA,https://manufacturer.com/products\nB,https://another.com/\n',['manufacturer.com','another.com']);
 const labels=prepareLabels('site_id,reviewed,expected_initial_strategy,acceptable_final_strategies,required_terms,min_text_chars\nA,no,S02,S02,iron|machining,120\nB,yes,S01,S01|S02,CNC|machining,90\n',sites);
 assert.equal(labels.get('A').reviewed,false);
 assert.equal(labels.get('B').reviewed,true);
 const one=evaluateSite(sites[0],response(sites[0]),{status:'not_assessed'},labels.get('A'));
 const two=evaluateSite(sites[1],response(sites[1]),{status:'not_assessed'},labels.get('B'));
 assert.equal(one.initialStrategyMatches,null);
 assert.equal(one.termRecall,null);
 assert.equal(one.manualReviewNeeded,true);
 assert.equal(two.initialStrategyMatches,true);
 assert.equal(two.finalStrategyMatches,true);
 assert.equal(two.termRecall,100);
 assert.throws(()=>prepareLabels('site_id,reviewed\nXX,yes\n',sites),/unknown/);
 assert.throws(()=>prepareLabels('site_id,reviewed,expected_initial_strategy\nA,yes,S05\n',sites),/Invalid expected_initial/);
});
test('200-like completed results without text or evidence are not counted as usable',()=>{
 let a=evaluateSite(sampleSites[0],response(sampleSites[0],{content:{text:'OK'},evidence:[]}),{status:'completed'});
 assert.equal(a.status,'completed');assert.equal(a.usable,false);assert.equal(a.eligible,true);
 a=evaluateSite(sampleSites[0],response(sampleSites[0]),{status:'completed'});
 assert.equal(a.usable,true);
});
test('robots-blocked sites are kept visible but excluded from accessible usability rate',()=>{
 const a=evaluateSite(sampleSites[0],response(sampleSites[0],{status:'blocked',reason:'robots disallow',content:{},evidence:[]}),{status:'blocked'});
 const b=evaluateSite(sampleSites[1],response(sampleSites[1]),{status:'completed'});
 const summary=summarize([{...a,durationMs:22},{...b,durationMs:25}],{test:true});
 assert.equal(summary.access.blocked,1);
 assert.equal(summary.access.eligible,1);
 assert.equal(summary.quality.usableRatePct,100);
 assert.equal(summary.routing.initial.accuracyPct,null);
 assert.equal(summary.goals.routeAccuracyTargetMet,null);
 assert.equal(summary.effort.measuredApiCostUsd,null);
});
test('benchmark processes failures independently and preserves source-specific observations',async()=>{
 const patterns={assessments:[{patternId:'R01',status:'observed'},{patternId:'R04',status:'lead'}]};
 const batch=await runBenchmark({sites:sampleSites,labels:new Map(),delayMs:0,sleep:async()=>{},
  detectPatterns:async site=>site.siteId==='A'?{status:'completed',analysis:patterns}:(()=>{throw Error('Pattern service unavailable')})(),
  execute:async(site,analysis)=>site.siteId==='A'?(assert.equal(analysis,patterns),response(site)): ( ()=>{throw Error('Fetcher failed')})(),
  onProgress:()=>{}});
 assert.equal(batch.results.length,2);
 assert.deepEqual(batch.results[0].observedPatterns,['R01']);
 assert.deepEqual(batch.results[0].leadPatterns,['R04']);
 assert.equal(batch.results[0].usable,true);
 assert.equal(batch.results[1].status,'failed');
 assert.equal(batch.results[1].patternStatus,'failed');
 assert.match(batch.results[1].reason,/Fetcher failed/);
 assert.equal(batch.summary.review.unlabeled,2);
 assert.equal(batch.summary.routing.initial.accuracyPct,null);
});
test('routing denominator uses reviewed labeled first-strategy decisions only',()=>{
 const labels=new Map([
 ['A',{reviewed:true,expectedRoute:'S02',acceptableFinal:['S01','S02'],requiredTerms:['cast iron'],expectedStatus:'completed',minChars:null,note:'manual'}],
 ['B',{reviewed:true,expectedRoute:'S01',acceptableFinal:['S01'],requiredTerms:['missing wording'],expectedStatus:'completed',minChars:null,note:'manual'}]
 ]);
 const res=[evaluateSite(sampleSites[0],response(sampleSites[0]),{status:'completed'},labels.get('A')),
 evaluateSite(sampleSites[1],response(sampleSites[1]),{status:'completed'},labels.get('B'))];
 const summary=summarize(res,{});
 assert.equal(summary.routing.initial.labeled,2);
 assert.equal(summary.routing.initial.correct,1);
 assert.equal(summary.routing.initial.accuracyPct,50);
 assert.equal(summary.routing.final.accuracyPct,100);
 assert.equal(summary.keywordCoverage.labeled,2);
 assert.equal(summary.keywordCoverage.meanRecallPct,50);
 assert.equal(summary.goals.routeAccuracyTargetMet,false);
});
test('all five output artifacts are produced with evidence and no fabricated labels',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'pi-bench-'));
 try{
   const a=evaluateSite(sampleSites[0],response(sampleSites[0]),{status:'not_assessed'});
   const result={summary:summarize([{...a,durationMs:17}],{}),results:[{...a,durationMs:17}]};
   const paths=await writeArtifacts(directory,result);
   for(const p of Object.values(paths)){const content=await readFile(p,'utf8');assert.ok(content.length>40)}
   const csv=await readFile(paths.resultsCsv,'utf8');assert.match(csv,/"not_assessed"/);
   const truth=buildReviewTemplate(sampleSites);
   assert.match(truth,/"no"/);assert.equal(parseCsv(truth).length,2);
   const json=JSON.parse(await readFile(paths.resultsPath,'utf8'));
   assert.equal(json.results[0].extraction.evidence[0].sourceUrl,A);
 }finally{await rm(directory,{recursive:true,force:true})}
});
