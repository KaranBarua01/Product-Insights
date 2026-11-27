import {test} from 'node:test';
import assert from 'node:assert/strict';
import {makeOutcomeWorklist,validateOutcomeReview,outcomeHash,assembleOutcomeReview} from '../app/final-outcome.mjs';
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
