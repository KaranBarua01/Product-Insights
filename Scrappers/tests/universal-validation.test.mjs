import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseCsv,csvEncode} from '../tools/benchmark-lib.mjs';
import {validateLockedCohort,traceabilityChecks,productDuplicateSignals,
  createHumanReviewTemplate,scoreHumanReviews,UNIVERSAL_SCHEMA} from '../tools/universal-validation.mjs';
import {summarizeHoldout} from '../tools/universal-benchmark.mjs';

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const file=p=>readFile(join(ROOT,p),'utf8');
async function fixture(){
  const [cohortCsv,hostsText,lockJson,extractorSource,plannerSource,osCsv,oldCsv]=await Promise.all([
    'benchmark/universal-v1/cohort.csv','benchmark/universal-v1/hosts.txt',
    'benchmark/universal-v1/cohort-lock.json','tools/product-intelligence.mjs',
    'tools/research-planner.mjs','benchmark/insidejob-os-ten-sites.csv',
    'benchmark/sites.example.csv'].map(file));
  return {cohortCsv,hostsText,lock:JSON.parse(lockJson),
    extractorSource,plannerSource,priorCsvs:[osCsv,oldCsv]};
}
test('U30 frozen cohort is 30 previously unused exact hosts, 10 sectors x3 and 5 batches x6',async()=>{
  const args=await fixture(),cohort=validateLockedCohort(args);
  assert.equal(cohort.schemaVersion,UNIVERSAL_SCHEMA);
  assert.equal(cohort.sites.length,30);
  assert.equal(new Set(cohort.sites.map(x=>x.host)).size,30);
  assert.deepEqual(Object.values(cohort.batches).sort(),[6,6,6,6,6]);
  assert.equal(cohort.sectorCount,10);
  assert.ok(cohort.sites.some(x=>x.roleStratum==='repair_service_candidate'));
  assert.ok(cohort.sites.some(x=>x.roleStratum==='distributor_candidate'));
  assert.ok(cohort.sites.some(x=>x.roleStratum==='oem_candidate'));
  assert.equal(cohort.sites.find(x=>x.companyName==='Freefly Systems').batch,'A');
});
test('tampering with cohort or pinned engine is rejected before any web request',async()=>{
  const args=await fixture();
  assert.throws(()=>validateLockedCohort({...args,
    cohortCsv:args.cohortCsv.replace('Freefly Systems','Other Company')}),/SHA mismatch/);
  assert.throws(()=>validateLockedCohort({...args,
    hostsText:args.hostsText.replace('freeflysystems.com','unapproved.example.com')}),/SHA mismatch/);
  assert.throws(()=>validateLockedCohort({...args,
    extractorSource:args.extractorSource+' \n'}),/SHA mismatch/);
  assert.throws(()=>validateLockedCohort({...args,
    plannerSource:args.plannerSource.replace('MAX_PAGES=12','MAX_PAGES=999')}),/SHA mismatch/);
});
function buildPage(url,{text='',headings=[],jsonLd=[]}={}){
  return {url,sourceUrl:url,status:'completed',strategy:'S01',
    content:{text,headings,jsonLd,title:headings[0]||''},evidence:[]};
}
test('traceability validates source quote, published JSON-LD and flags ungrounded source claims',()=>{
  const url='https://unseen.example.org/product/pump';
  const jsonLd=[{'@type':'Product',name:'Pump X'}];
  const page=buildPage(url,{text:'Pump X\nPressure: 12 bar\nMade from stainless steel.',
    headings:['Pump X'],jsonLd});
  const source=(quote,method='visible_text')=>({sourceUrl:url,quote,method});
  const intelligence={
    company:{website:'https://unseen.example.org/'},
    categories:[],
    products:[{name:'Pump X',sourceUrl:url,
      evidence:[source('Pump X','jsonld_product_name')],
      specifications:[{attribute:'pressure',value:'12 bar',evidence:source('Pressure: 12 bar')}],
      materials:[{material:'stainless steel',evidence:source('Made from stainless steel.')}],
      components:[{component:'fabricated valve',evidence:source('Never published in the website')}]},
      {name:'Unknown Unit',sourceUrl:'https://unseen.example.org/forbidden',
        evidence:[source('Unknown Unit')] ,specifications:[],materials:[],components:[]}]
  };
  const result=traceabilityChecks(intelligence,[page]);
  assert.equal(result.claimCount,5);
  assert.equal(result.matched,3);
  assert.equal(result.unmatched,2);
  assert.equal(result.missingSource,1);
  assert.ok(result.examples.some(x=>x.reason==='quote_not_observed_in_original_page'));
  assert.ok(result.examples.some(x=>x.reason==='source_page_not_in_successful_trace'));
  assert.match(result.caveat,/not whether the claim is true/);
});
test('traceability refuses attribute source different from its product source',()=>{
  const site='https://a.example.org/';
  const p1=buildPage(site+'product/a',{text:'Power: 10 W'});
  const p2=buildPage(site+'product/b',{text:'Weight: 20 kg'});
  const row={company:{website:site},categories:[],products:[{name:'A',sourceUrl:p1.url,
    evidence:[],components:[],materials:[],specifications:[{
      attribute:'weight',value:'20 kg',
      evidence:{sourceUrl:p2.url,quote:'Weight: 20 kg',method:'visible_text'}}]}]};
  const result=traceabilityChecks(row,[p1,p2]);
  assert.equal(result.matched,0);
  assert.equal(result.mismatchedEvidenceSource,1);
});
test('same-page JSON-LD and heading name variants flagged as duplicates but not auto-merged',()=>{
  const base='https://maker.example.org/product/r2a';
  const p={company:{website:'https://maker.example.org/'},products:[
    {name:'R2A-FSP, Tamper-Proof Refrigerator',sourceUrl:base,sku:'R2A'},
    {name:'R2A-FSP Tamper-Proof Refrigerator',sourceUrl:base,sku:null},
    {name:'R2A-FSP Cartridge',sourceUrl:base,sku:null}]};
  const summary=productDuplicateSignals(p);
  assert.equal(summary.recordCount,3);
  assert.equal(summary.samePageNormalizedNameGroups,1);
  assert.equal(summary.recordsInSuspectGroups,2);
});
test('manual review template is blank and cannot be scored as accuracy before review',()=>{
  const url='https://acme.example.org/product/pump';
  const evidence={sourceUrl:url,quote:'Pump X',method:'page_heading'};
  const data={company:{roleCandidate:{evidence:[]}},categories:[],products:[
    {name:'Pump X',sourceUrl:url,evidence:[evidence],specifications:[{
      attribute:'pressure',value:'12 bar',evidence:{sourceUrl:url,quote:'Pressure: 12 bar'}}],
      components:[],materials:[]}]};
  const generated=createHumanReviewTemplate([{
    siteId:'U30-001',industry:'pumps_fluid',roleStratum:'oem_candidate',depth12:data
  }]);
  assert.equal(generated.rows,2);
  const blank=scoreHumanReviews(generated.csv,generated.csv);
  assert.equal(blank.status,'no_adjudicated_labels');
  assert.equal(blank.reviewedPrecisionPct,null);
  assert.equal(blank.unreviewed,2);
  const rows=parseCsv(generated.csv);
  rows[0].review_decision='correct';rows[0].reviewer='reviewerA';
  rows[1].review_decision='incorrect';rows[1].reviewer='reviewerB';
  const labels=Object.keys(rows[0]);
  const edited=csvEncode([labels,...rows.map(r=>labels.map(f=>r[f]))]);
  const score=scoreHumanReviews(edited,generated.csv);
  assert.equal(score.reviewedPrecisionPct,50);
  assert.equal(score.correct,1);
  assert.equal(score.incorrect,1);
  const forged=parseCsv(generated.csv);
  forged[0].source_quote='NOT FROM PAGE';
  const tampered=csvEncode([labels,...forged.map(r=>labels.map(f=>r[f]))]);
  assert.throws(()=>scoreHumanReviews(tampered,generated.csv),/Frozen review source changed/);
});
test('six-site rollup includes genuine service abstention with zero products, not a negative accuracy outcome',()=>{
  const mk=(id)=>({
    siteId:'U30-'+String(id).padStart(3,'0'),company:'Synthetic '+id,industry:'pumps_fluid',
    roleStratum:id===1?'repair_service_candidate':'oem_candidate',
    runStatus:'sampled',pagesAttempted:3,
    baseline3:{coverage:{pagesUsable:3,products:0,categories:0}},
    depth12:{coverage:{pagesUsable:3,products:id===1?0:1,categories:0,
      specifications:0,components:0,materials:0}},
    traceability:{claimCount:0,matched:0,unmatched:0,offHost:0},
    duplicateSignals:{samePageNormalizedNameGroups:0}
  });
  const x=summarizeHoldout([1,2,3,4,5,6].map(mk),'A',
    {lockPins:{'product-intelligence.mjs':'sha'}});
  assert.equal(x.schemaVersion,UNIVERSAL_SCHEMA);
  assert.equal(x.depth12.products,5);
  assert.equal(x.qualityStatus,'unreviewed_no_product_accuracy');
  assert.equal(x.sourceSignals.claimTraceabilityPct,null);
  assert.throws(()=>summarizeHoldout([mk(1)],'A',{lockPins:{}}),/fixed U30/);
});
