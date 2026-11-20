import test from 'node:test';
import assert from 'node:assert/strict';
import {buildBusinessView,normalizeOsSnapshot,compareWithOs,osSnapshotTemplate,
  LAB_BUSINESS_SCHEMA,LAB_HANDOFF_SCHEMA,LAB_OS_SNAPSHOT_SCHEMA}
  from '../tools/lab-business.mjs';
function demo(){
  const url='https://products.example.org/product/heavy-duty';
  const e=(q,loc='primary page text')=>({sourceUrl:url,quote:q,locator:loc});
  return {
    requestedUrl:'https://products.example.org/',status:'sampled',
    coverage:{visitedPages:3},pages:[{url,status:'completed',strategy:'S01'}],
    productIntelligence:{
      company:{name:'Products Co',website:'https://products.example.org/',
        roleCandidate:{primaryRole:'manufacturer'}},
      categories:[{id:'rack-category',name:'Hitch Bike Racks',
        sourceUrl:'https://products.example.org/product-category/racks'}],
      products:[{id:'heavy-duty-v1',name:'Heavy Duty',sku:'HD-01',sourceUrl:url,
        extractionMethod:'product_page_heading',categoryIds:['rack-category'],
        evidence:[e('Heavy Duty','product heading')],
        specifications:[{attribute:'weight_capacity',value:'65 lbs',unit:'lbs',
          evidence:e('Weight Capacity: 65 lbs')}],
        components:[{component:'tray',evidence:e('Includes a loading tray')}],
        materials:[{material:'aluminum',evidence:e('Made entirely from corrosion-resistant aluminum')}]
      }]
    },
    families:[{name:'Heavy Duty',sourceUrl:url,members:[{name:'Heavy Duty'}],
      taxonomy:{status:'candidate_requires_review',
        suggestions:[{code:'rack_x',label:'Bicycle Rack',path:'Vehicle / Bicycle Rack',score:.8}]}}],
    stage2:{companyProfile:{sections:[
      {code:'JS5',claims:[{claim:'CNC milling is used for a relevant part',
        quote:'CNC milling is used for a relevant part',sourceUrl:url}]},
      {code:'JS6',claims:[{claim:'We offer CNC machining',
        quote:'We offer CNC machining',sourceUrl:'https://products.example.org/about'}]}
    ]}}
  };
}
test('Manuel view presents source-backed product/category/spec/material and never infers BOM or process',()=>{
  const result=buildBusinessView(demo());
  assert.equal(result.schemaVersion,LAB_BUSINESS_SCHEMA);
  assert.equal(result.mode,'real_website_research');
  assert.equal(result.coverage.products,1);
  assert.equal(result.coverage.categories,1);
  assert.equal(result.coverage.specifications,1);
  assert.equal(result.coverage.componentMentions,1);
  assert.equal(result.coverage.materialClaims,1);
  assert.equal(result.coverage.verifiedProductParts,0);
  assert.equal(result.coverage.verifiedProductManufacturingProcesses,0);
  const p=result.products[0];
  assert.equal(p.name,'Heavy Duty');
  assert.deepEqual(p.categories,['Hitch Bike Racks']);
  assert.equal(p.categoryLinkStatus,'observed_unverified');
  assert.equal(p.specifications[0].value,'65 lbs');
  assert.equal(p.specifications[0].evidence.quote,'Weight Capacity: 65 lbs');
  assert.equal(p.components[0].relationship,'published_mention_not_confirmed_BOM');
  assert.equal(p.materials[0].name,'aluminum');
  assert.deepEqual(p.parts,[]);
  assert.deepEqual(p.manufacturingProcesses,[]);
  assert.equal(p.manufacturingProcessesStatus,'not_established');
  assert.equal(p.ownership,'manufactured_or_sold_unknown');
  assert.equal(p.taxonomySuggestions[0].status,'unverified_candidate_not_os_mapping');
  assert.equal(result.handoff.schemaVersion,LAB_HANDOFF_SCHEMA);
  assert.equal(result.handoff.osWritePerformed,false);
  assert.equal(result.handoff.products[0].ownedManufacturingNotEstablished,true);
  assert.deepEqual(result.handoff.products[0].manufacturingProcesses,[]);
  assert.equal(result.osComparison.status,'os_not_connected');
});
test('JS5 product processes are not turned into JS6 company capability or into product facts',()=>{
  const data=buildBusinessView(demo());
  assert.equal(data.processEvidence.claims.length,2);
  assert.equal(data.processEvidence.claims[0].section,'JS5');
  assert.equal(data.processEvidence.claims[0].kind,'product_relevant_process');
  assert.equal(data.processEvidence.claims[1].section,'JS6');
  assert.equal(data.processEvidence.claims[1].kind,'claimed_company_capability');
  assert.equal(data.processEvidence.claims[0].linkedProductId,null);
  assert.equal(data.processEvidence.claims[1].linkedProductId,null);
  assert.equal(data.handoff.separateProcessEvidence.length,2);
  assert.deepEqual(data.products[0].manufacturingProcesses,[]);
});
test('when process AI is not configured, show unknown rather than fictitious capabilities',()=>{
  const sample=demo();delete sample.stage2;
  const r=buildBusinessView(sample);
  assert.equal(r.processEvidence.status,'not_analyzed_or_not_found');
  assert.deepEqual(r.processEvidence.claims,[]);
  assert.deepEqual(r.handoff.separateProcessEvidence,[]);
});
test('OS importer enforces explicit snapshot schema and fails closed on oversized input',()=>{
  const template=osSnapshotTemplate();
  assert.equal(template.schemaVersion,LAB_OS_SNAPSHOT_SCHEMA);
  assert.equal(template.products.length,0);
  assert.throws(()=>normalizeOsSnapshot({company:{name:'A',website:'https://products.example.org/'},products:[]}),/pi-os-snapshot/);
  assert.throws(()=>normalizeOsSnapshot({schemaVersion:LAB_OS_SNAPSHOT_SCHEMA,company:{name:'A',website:'http://localhost'},products:[]}),/company.website|explicit/);
});
test('OS snapshot import is clearly an imported snapshot, and exact matching does not update OS',()=>{
  const os=normalizeOsSnapshot({
    schemaVersion:LAB_OS_SNAPSHOT_SCHEMA,exportedAt:'2026-11-19T09:00:00Z',
    company:{id:'os-abc-123',name:'Products Co',website:'https://products.example.org/'},
    products:[{id:'p1',name:'Heavy Duty',parts:[{name:'Bracket'}],manufacturingProcesses:['Fabrication']},
      {id:'p2',name:'Other Existing Product'}],
    categories:['Existing Racks'],parts:['Bracket'],manufacturingProcesses:['Fabrication']
  });
  assert.equal(os.source,'user_imported_file_not_live_api');
  assert.equal(os.products[0].parts[0],'Bracket');
  assert.equal(os.products[0].manufacturingProcesses[0],'Fabrication');
  const view=buildBusinessView(demo(),os);
  assert.equal(view.osComparison.status,'comparable_imported_snapshot');
  assert.equal(view.osComparison.osCounts.products,2);
  assert.equal(view.osComparison.osCounts.productLinkedParts,1);
  assert.equal(view.osComparison.osCounts.productLinkedProcesses,1);
  assert.equal(view.osComparison.osProductSamples[0].parts[0],'Bracket');
  assert.equal(view.osComparison.osProductSamples[0].manufacturingProcesses[0],'Fabrication');
  assert.equal(view.osComparison.productMatches[0].osManufacturingProcesses[0],'Fabrication');
  assert.equal(view.osComparison.productMatches.length,1);
  assert.equal(view.osComparison.osOnlyRecords[0],'Other Existing Product');
  assert.equal(view.osComparison.researchOnlyCandidates.length,0);
  assert.equal(view.handoff.osWritePerformed,false);
  assert.ok(!JSON.stringify(view.handoff).includes('os-abc-123'));
});
test('mismatched OS company cannot be compared or treated as zero records',()=>{
  const wrong=normalizeOsSnapshot({
    schemaVersion:LAB_OS_SNAPSHOT_SCHEMA,
    company:{name:'Other Company',website:'https://unrelated.example.com/'},
    products:[{name:'Heavy Duty'}]
  });
  const report=buildBusinessView(demo(),wrong);
  assert.equal(report.osComparison.status,'company_mismatch');
  assert.equal(report.osComparison.productMatches.length,0);
  assert.equal(report.osComparison.osCounts.products,1);
});
test('untrusted website content is projected only into strings, source URLs and review statuses',()=>{
  const report=demo();
  report.productIntelligence.products[0].name='<img src=x onerror=alert(1)>';
  report.productIntelligence.products[0].sourceUrl='javascript:alert(1)';
  const r=buildBusinessView(report);
  assert.equal(r.products.length,0);
  assert.equal(r.handoff.products.length,0);
  assert.equal(r.coverage.products,0);
  assert.equal(r.handoff.exportStatus,'draft_candidate_not_integrated');
});
test('OS snapshots reject silently truncated company catalogs and unsupported shapes',()=>{
  const base={schemaVersion:LAB_OS_SNAPSHOT_SCHEMA,
    company:{name:'Large Co',website:'https://products.example.org/'},products:[]};
  assert.throws(()=>normalizeOsSnapshot({...base,products:Array.from({length:501},(_,i)=>({name:'P-'+i}))}),/limit/);
  assert.throws(()=>normalizeOsSnapshot({...base,products:'not array'}),/must be an array/);
});

test('UI can distinguish website-sourced JS7/JS8/JS9 quotes from unverified OS/company facts',()=>{
  const report=demo(),url='https://products.example.org/about';
  report.stage2.companyProfile.sections.push(
    {code:'JS7',claims:[{claim:'We buy brackets',quote:'We buy brackets',sourceUrl:url}]},
    {code:'JS8',claims:[{claim:'We serve transport',quote:'We serve transport',sourceUrl:url}]},
    {code:'JS9',claims:[{claim:'Proprietary mounting',quote:'Proprietary mounting',sourceUrl:url},
      {claim:'Injected off-host source',quote:'Do not trust this',sourceUrl:'https://other.example.org/'}]}
  );
  const result=buildBusinessView(report);
  assert.deepEqual(result.otherSectionClaims.map(x=>x.code),['JS7','JS8','JS9']);
  assert.ok(result.otherSectionClaims.every(x=>x.status==='ai_compiled_website_quote_requires_human_review'));
  assert.equal(result.otherSectionClaims[0].evidence.quote,'We buy brackets');
  assert.equal(result.otherSectionClaims.some(x=>x.claim==='Injected off-host source'),false);
  assert.equal(result.handoff.osWritePerformed,false);
});
