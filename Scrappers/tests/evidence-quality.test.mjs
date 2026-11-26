import test from 'node:test';
import assert from 'node:assert/strict';
import {runResearchV3} from '../tools/research-v3.mjs';
import {assessPageEvidence,createQualityTracker,gapPriority,adaptiveStop} from '../tools/evidence-quality.mjs';
import {extractPageIntelligence} from '../tools/product-intelligence.mjs';
import {offlineProductLeads} from '../tools/research-stage2.mjs';

const root='https://maker.example.com/',host='maker.example.com';
const model=root+'products/pump-100';
const fixture=(url,content={},status='completed')=>({sourceUrl:url,url,status,strategy:url.endsWith('.pdf')?'S03':'S01',reason:'Fixture',warnings:[],evidence:[],content:{title:'Company',headings:[],text:'Published information for our visitors and customers.',links:[],...content}});
const product=fixture(model,{title:'Pump 100',headings:['Pump 100'],text:'Pump 100 includes a stainless steel impeller. Pressure rating 25 bar. Shaft is CNC machined. Designed for industrial water systems.'});
const link=(url,label)=>({url,label});
async function crawl(fixtures,options={}){
 const visited=[],accepted=[];
 const report=await runResearchV3({url:root,maxPages:10,delayMs:0,extractPage:async u=>{visited.push(u);return fixtures[u]||fixture(u)},onEvidence:p=>accepted.push(p),...options});
 return {report,visited,accepted};
}

test('HTTP 200 soft error is rejected before discovery and evidence intake',async()=>{
 const {report,visited,accepted}=await crawl({[root]:fixture(root,{title:'404 - Page not found',text:'Page not found. Steel shaft and 100 mm unrelated navigation.',links:[link(model,'Pump 100')]})});
 assert.deepEqual(visited,[root]);assert.equal(accepted.length,0);
 assert.equal(report.pages[0].status,'soft_error');assert.equal(report.evidenceQuality.counts.retrieved,1);
 assert.equal(report.evidenceQuality.counts.accepted,0);assert.equal(report.evidenceQuality.verdict,'no_usable_evidence');
 assert.equal(report.evidenceQuality.falseSuccessRisk,true);
});
test('a legitimate model number beginning 404 is not a soft error',()=>{
 const q=assessPageEvidence(fixture(model,{title:'404 Series',headings:['404 Series'],text:'404 Series industrial pump. Rated pressure 10 bar.'}),'product');
 assert.equal(q.accepted,true);assert.equal(q.productIdentities.length,1);
});
test('empty navigable shell is not evidence but observed safe links remain eligible',async()=>{
 const {report,visited,accepted}=await crawl({[root]:fixture(root,{text:'',links:[link(model,'Pump 100')]}),[model]:product});
 assert.deepEqual(visited,[root,model]);assert.equal(report.pages[0].status,'insufficient');
 assert.equal(report.coverage.insufficientPages,1);assert.equal(accepted.length,1);
 assert.equal(report.evidenceQuality.distinctProductCandidates,1);
});
test('generic HTTP success and a product-shaped URL do not establish product evidence',async()=>{
 const {report}=await crawl({[root]:fixture(root,{links:[link(model,'Pump 100')]}),[model]:fixture(model,{title:'Products',headings:['Products'],text:'Welcome to our website. We are delighted to share the latest information.'})});
 assert.equal(report.coverage.retrievedPages,2);assert.equal(report.coverage.productEvidenceCandidates,0);
 assert.equal(report.evidenceQuality.verdict,'retrieved_without_product_evidence');assert.equal(report.evidenceQuality.falseSuccessRisk,true);
 assert.ok(report.evidenceQuality.missingDimensions.includes('product'));
});
test('literal product heading and technical statements produce source-attributed candidate signals',()=>{
 const q=assessPageEvidence(product,'product');
 for(const k of ['product','components','materials','specifications','processes','applications'])assert.ok(q.signals[k]?.length,k);
 assert.equal(q.productIdentities[0].name,'Pump 100');
 for(const [k,examples] of Object.entries(q.signals))for(const ex of examples)assert.ok(product.content.text.includes(ex.quote),k);
});
test('published JSON-LD product identity is retained even when visible text is sparse',()=>{
 const q=assessPageEvidence(fixture(model,{text:''}),'product',[{name:'Pump 100',sku:'P100'}]);
 assert.equal(q.accepted,true);assert.equal(q.productIdentities[0].sku,'P100');
 assert.equal(q.signals.product[0].locator,'published JSON-LD product name');
});
test('generic published product names do not create product identities',()=>{
 const q=assessPageEvidence(fixture(model,{text:''}),'product',[{name:'Products'}]);
 assert.equal(q.accepted,false);assert.equal(q.productIdentities.length,0);
});
test('quality score is not an accuracy estimate or an exhaustive product count',async()=>{
 const {report}=await crawl({[root]:fixture(root,{text:'We manufacture industrial pumps. Our company serves customers worldwide.',links:[link(model,'Pump 100')]}),[model]:product});
 const q=report.evidenceQuality;
 assert.equal(q.score,100);assert.equal(q.verdict,'product_and_technical_signal_sample');
 assert.equal(q.verifiedAccuracy,null);assert.equal(q.catalogCompleteness,null);assert.equal(q.independentValidation,'not_performed');
 assert.deepEqual(q.missingDimensions,[]);assert.equal(q.distinctProductCandidates,1);
 assert.equal(q.falseSuccessRisk,false);
});
test('late PDF text is counted but OCR and geometry-only candidates are not',()=>{
 const url=root+'manual.pdf',p=fixture(url,{text:'Introductory information for customers.',pdfPages:[{page:1,text:'Introductory information for customers.',ocrText:'Welded aluminum bracket 50 mm',layoutRows:[{cells:[{text:'CNC machining'}]}]},{page:50,text:'Operating pressure 25 bar. Stainless steel impeller.'}]},'partial');
 const q=assessPageEvidence(p,'document');
 assert.equal(q.signals.specifications[0].locator,'PDF page 50');
 assert.equal(q.signals.materials[0].locator,'PDF page 50');
 assert.equal(q.signals.processes,undefined);
 assert.ok(q.flags.includes('partial_source'));
});
test('merged, clipped or different-source HTML cells are not promoted to signals',()=>{
 const q=assessPageEvidence(fixture(root,{text:'Published company information and public navigation.',tables:[{hasMergedCells:true,rows:[['Steel','25 mm']]},{truncated:true,rows:[['CNC machining','Shaft']]},{sourceUrl:model,rows:[['Aluminum','20 bar']]}]}),'company');
 assert.equal(q.signals.materials,undefined);assert.equal(q.signals.specifications,undefined);assert.equal(q.signals.processes,undefined);
 assert.ok(q.flags.includes('ambiguous_or_truncated_table'));
});
test('distinct physical native cells retain their literal evidence locators',()=>{
 const q=assessPageEvidence(fixture(root,{text:'Published company information.',tables:[{sourceUrl:root,tableIndex:2,rows:[['Shaft diameter','25 mm']]}]}),'company');
 assert.equal(q.signals.specifications[0].quote,'25 mm');
 assert.equal(q.signals.specifications[0].locator,'HTML table 2, row 1, cell 2');
});
test('repeat signals do not reset novelty; distinct model identities remain separate',()=>{
 const t=createQualityTracker(),q=assessPageEvidence(product,'product');
 assert.equal(t.add({url:model,branch:'pumps',quality:q}),true);
 assert.equal(t.add({url:model+'?utm_source=x',branch:'pumps',quality:q}),false);
 const variant=fixture(model+'?ref=B',{title:'Pump 101',headings:['Pump 101'],text:'Pump 101 includes a stainless steel impeller. Pressure rating 25 bar.'});
 assert.equal(t.add({url:variant.url,branch:'pumps',quality:assessPageEvidence(variant,'product')}),true);assert.equal(t.productCount(),2);
});
test('gap-aware ranking does not outrank direct product-document priority',()=>{
 assert.ok(gapPriority({kind:'product'},['product'])>0);
 assert.ok(gapPriority({kind:'company'},['identity'])>0);
 assert.ok(gapPriority({kind:'document'},['materials'])>0);
 assert.equal(gapPriority({kind:'document',fromProductPage:true},['materials']),0);
});
test('adaptive stopping requires enough attempts and stagnation, and preserves high-value or unvisited branches',()=>{
 const branchStats=new Map([['same',{}]]);
 const input={visited:23,maxPages:50,noGain:9,missing:['product'],branchStats};
 assert.equal(adaptiveStop({...input,frontier:[{kind:'other',branch:'same'}]}),true);
 for(const kind of ['product','catalog','technical','document'])assert.equal(adaptiveStop({...input,frontier:[{kind,branch:'same'}]}),false);
 assert.equal(adaptiveStop({...input,frontier:[{kind:'other',branch:'new'}]}),false);
 assert.equal(adaptiveStop({...input,visited:10,frontier:[{kind:'other',branch:'same'}]}),false);
 assert.equal(adaptiveStop({...input,noGain:2,frontier:[{kind:'other',branch:'same'}]}),false);
});
test('budget exhaustion reports remaining leads, missing dimensions and unverified completeness',async()=>{
 const {report}=await crawl({[root]:fixture(root,{links:[link(model,'Pump 100'),link(root+'technical/manual.pdf','Manual')]}),[model]:product},{maxPages:1});
 const q=report.evidenceQuality;
 assert.equal(q.stopReason,'budget_exhausted');assert.equal(q.remainingLeads,2);
 assert.equal(q.unresolvedProductLeads,1);assert.equal(q.unresolvedTechnicalLeads,1);
 assert.ok(q.missingDimensions.includes('product'));assert.equal(q.catalogCompleteness,null);
});
test('access stops remain unassessed, not evidence of absent products',async()=>{
 const {report}=await crawl({[root]:{...fixture(root,{},'blocked'),reason:'HTTP 429; no bypass attempted'}});
 assert.equal(report.coverage.stopReason,'rate_limited');assert.equal(report.evidenceQuality.unassessedSources[0].status,'blocked');
 assert.equal(report.evidenceQuality.counts.retrieved,0);assert.equal(report.evidenceQuality.dimensions.product.status,'not_observed_in_sample');
});
test('source-backed identity gate prevents URL-only downstream heading leads',()=>{
 const p=fixture(model,{title:'Industrial Company',headings:['Industrial Company'],text:'General public information for visitors and customers.'});
 const q=assessPageEvidence(p,'product');assert.equal(q.productIdentities.length,0);
 assert.equal(extractPageIntelligence({...p,acquisitionQuality:q},host).products.length,0);
 assert.equal(offlineProductLeads([{url:model,status:'completed',title:p.content.title,headings:p.content.headings,aiText:p.content.text,pageKind:'product',quality:q}]).length,0);
});
