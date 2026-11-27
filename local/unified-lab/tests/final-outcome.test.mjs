import {test} from 'node:test';
import assert from 'node:assert/strict';
import {makeOutcomeWorklist,validateOutcomeReview,buildOutcomeCatalogue,outcomeHash,assembleOutcomeReview,LEGACY_REVIEW_SCHEMA,REVIEW_SCHEMA} from '../app/final-outcome.mjs';
const url='https://example.test/products/a',report={products:[{name:'Exact model A',sku:'A-1',sourceUrl:url},{name:'Exact model A',sku:'A-2',sourceUrl:url}]},packet={batches:[{input:{sources:[{id:1,url,text:'The housing is anodized aluminum and protects the electronics.'}]}}]};
const work=makeOutcomeWorklist('run-1',report,packet);
function review(){const x=structuredClone(work.review_template);x.products[0].status='assessed';x.products[0].parts=[{component:'housing',material:'Aluminum',processes:['CNC machining'],condition:'If machined from billet',basis:'inferred'}];return x;}
test('preserves exact names, SKU variants and source links',()=>{assert.deepEqual(work.leads.map(x=>[x.name,x.sku,x.source_ids]),[['Exact model A','A-1',[1]],['Exact model A','A-2',[1]]]);});
test('accepts assessed and unassessed products without merging variants',()=>{assert.deepEqual(validateOutcomeReview(work,review()).products.map(x=>[x.sku,x.status]),[['A-1','assessed'],['A-2','unassessed']]);});
test('rejects stale run, mismatched identity and duplicate product IDs',()=>{for(const mutate of [x=>x.run_id='old',x=>x.products[0].sku='fake',x=>x.products[1]=x.products[0]]){const x=review();mutate(x);assert.throws(()=>validateOutcomeReview(work,x));}});
test('requires design condition and literal source quote for documented component',()=>{const x=review();const p=x.products[0].parts[0];p.basis='source_quoted_component';p.source_id=1;p.quote='The housing is anodized aluminum';assert.equal(validateOutcomeReview(work,x).products[0].parts[0].quote,p.quote);p.quote='The housing is forged titanium';assert.throws(()=>validateOutcomeReview(work,x));p.basis='inferred';p.condition='';assert.throws(()=>validateOutcomeReview(work,x));});
test('allows explicit insufficient evidence but no parts under that status',()=>{const x=review();x.products[0].status='insufficient_evidence';assert.throws(()=>validateOutcomeReview(work,x));x.products[0].parts=[];assert.equal(validateOutcomeReview(work,x).products[0].status,'insufficient_evidence');});

test('bounded owner-filtered review chunks reassemble in order and reject corrupt, duplicate and missing data',()=>{
 const raw=JSON.stringify(review()),chunks=[raw.slice(0,37),raw.slice(37)],job={jobId:'fixture_review',reviewParts:2,reviewSha256:outcomeHash(raw)};
 const comments=chunks.map((text,i)=>({body:'PI_OUTCOME_REVIEW:'+job.jobId+':'+(i+1)+'/2\n'+JSON.stringify({text})}));
 assert.equal(assembleOutcomeReview(comments.slice().reverse(),job),raw);
 assert.throws(()=>assembleOutcomeReview([comments[0]],job),/Incomplete/);
 assert.throws(()=>assembleOutcomeReview([...comments,comments[0]],job),/Duplicate/);
 assert.throws(()=>assembleOutcomeReview(comments,{...job,reviewSha256:'0'.repeat(64)}),/SHA-256/);
 assert.throws(()=>assembleOutcomeReview([{body:'PI_OUTCOME_REVIEW:fixture_review:1/2\n'+JSON.stringify({text:'x'.repeat(24001)})},comments[1]],job),/chunk content/);
 assert.throws(()=>assembleOutcomeReview(comments,{...job,reviewParts:65}),/metadata/);
});

const catalogUrl='https://maker.test/products',catalogText='Square conveyor: uses cylindrical end rolls.\nModular conveyor: tapered plastic modules.\nFlow lift: carries totes vertically.',catalogPacket={batches:[{input:{sources:[{id:1,url:catalogUrl,text:catalogText},{id:2,url:'https://maker.test/manual.pdf',text:'Square conveyor manual: cylindrical end rolls support the belt.'},{id:3,url:'https://maker.test/other',text:'Unrelated housing uses steel.'}]}}]};
const catalogReport={requestedUrl:'https://maker.test/',products:[]},catalogWork=makeOutcomeWorklist('catalog-run',catalogReport,catalogPacket);
const discovered=()=>({name:'Square conveyor',sku:'',source_id:1,source_url:catalogUrl,quote:'Square conveyor: uses cylindrical end rolls.',status:'assessed',parts:[{component:'cylindrical end rolls',material:'Steel',processes:['Turning'],condition:'If steel rollers are used',basis:'source_quoted_component',source_id:2,quote:'cylindrical end rolls support the belt.'}]});
function catalogReview(){const r=structuredClone(catalogWork.review_template);r.discovered_products=[discovered(),{name:'Modular conveyor',sku:'',source_id:1,source_url:catalogUrl,quote:'Modular conveyor: tapered plastic modules.',status:'insufficient_evidence',parts:[]}];return r;}
test('zero extractor leads supports multiple source-quoted products and engineering from the same catalogue',()=>{
 assert.equal(catalogWork.leads.length,0);assert.equal(catalogWork.requested_url,'https://maker.test/');
 const v=validateOutcomeReview(catalogWork,catalogReview()),view=buildOutcomeCatalogue(catalogReport,v);
 assert.equal(v.discovered_products.length,2);assert.equal(view.assessed,1);assert.equal(view.discovered,2);
 assert.deepEqual(view.products.map(p=>p.name),['Square conveyor','Modular conveyor']);assert.equal(view.products[0].review.parts[0].source_url,'https://maker.test/manual.pdf');
 assert.deepEqual(validateOutcomeReview(catalogWork,v),v);assert.equal(catalogReport.products.length,0);
});
test('rejects invented names, URLs, source IDs, SKUs, duplicate identities, foreign component sources and omission spans',()=>{
 for(const mutate of [r=>r.discovered_products[0].name='Invented',r=>r.discovered_products[0].source_url='https://other.test/',r=>r.discovered_products[0].source_id=99,r=>r.discovered_products[0].sku='Made-up',r=>r.discovered_products.push({...r.discovered_products[0]}),r=>{const p=r.discovered_products[0].parts[0];p.source_id=3;p.component='housing';p.quote='Unrelated housing uses steel.';},r=>r.discovered_products[0].quote='Square conveyor [... omitted source text ...]']){
  const r=catalogReview();mutate(r);assert.throws(()=>validateOutcomeReview(catalogWork,r));
 }
});
test('mixed review excludes rejected extractor records, preserves originals and blocks duplicate active identity',()=>{
 const report={products:[{name:'Videos Hide Videos',sourceUrl:catalogUrl},{name:'Square conveyor',sourceUrl:catalogUrl}]},w=makeOutcomeWorklist('mixed',report,catalogPacket),r=structuredClone(w.review_template);
 r.products[0].status='rejected';r.products[0].reason='Navigation controls, not a product';r.discovered_products=[catalogReview().discovered_products[1]];
 const v=validateOutcomeReview(w,r),view=buildOutcomeCatalogue(report,v);
 assert.deepEqual(view.products.map(p=>p.name),['Square conveyor','Modular conveyor']);assert.equal(view.rejected[0].name,'Videos Hide Videos');assert.equal(report.products.length,2);
 const duplicate=structuredClone(r);duplicate.discovered_products.push(discovered());assert.throws(()=>validateOutcomeReview(w,duplicate),/Duplicate/);
 const noReason=structuredClone(r);delete noReason.products[0].reason;assert.throws(()=>validateOutcomeReview(w,noReason),/reason/);
 const incomplete=structuredClone(r);incomplete.products.pop();assert.throws(()=>validateOutcomeReview(w,incomplete),/every extracted lead/);
});
test('saved v1 reviews remain valid without permitting unquoted discoveries or rejected status',()=>{
 const old={schemaVersion:LEGACY_REVIEW_SCHEMA,run_id:work.run_id,products:review().products};const v=validateOutcomeReview(work,old);assert.equal(v.schemaVersion,LEGACY_REVIEW_SCHEMA);assert.equal(buildOutcomeCatalogue(report,v).products.length,2);
 assert.throws(()=>validateOutcomeReview(work,{...old,discovered_products:[]}));
 const bad=structuredClone(old);bad.products[1].status='rejected';bad.products[1].reason='not supported';assert.throws(()=>validateOutcomeReview(work,bad));
});
