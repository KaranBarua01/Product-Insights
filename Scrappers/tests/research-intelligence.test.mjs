import test from 'node:test';
import assert from 'node:assert/strict';
import {identifyCompanyRole,groupProductFamilies} from '../tools/research-intelligence.mjs';
import {stage2Analyze} from '../tools/research-stage2.mjs';
import {parseTaxonomy,runResearch} from '../tools/research-planner.mjs';

const mk=(name,i,url='https://aircraftspruce.com/products/aviation/')=>({
  name,sku:'SKU-'+i,sourceUrl:url,evidenceType:'published_json_ld_unverified',
  taxonomy:{status:'gap_or_insufficient_evidence',suggestions:[]}
});
function variants(){
  const items=[];
  for(let i=0;i<6;i++)items.push(mk(i%2?'GARMIN GTX 345 Transponder Option '+i:'Garmin GTX-345 ADS-B Transponder '+i,i));
  for(let i=0;i<14;i++)items.push(mk(i===3||i===7?'RC Allen 2610 Digital Attitude Indicator '+i:i%2?'RC Allen RCA2610 Digital Attitude Indicator '+i:'RCA 2610 Electric Indicator '+i,6+i));
  for(let i=0;i<3;i++)items.push(mk('Lightspeed Zulu 3 Aviation Headset Variant '+i,20+i));
  items.push(mk('David Clark DC One-X Aviation Headset',23));
  items.push(mk('Private Pilot Handbook',24));
  return items;
}
test('company role detects explicit Aircraft Spruce self-description, not a supplier manufacturing statement',()=>{
  const page={status:'completed',url:'https://aircraftspruce.com/about/',
    title:'Aircraft Spruce | About Us',
    aiText:"Aircraft Spruce is the world's largest distributor of aviation products. Garmin is a manufacturer of aviation electronics."};
  const role=identifyCompanyRole([page],'https://aircraftspruce.com/');
  assert.equal(role.primaryRole,'distributor');
  assert.deepEqual(role.roles,['distributor']);
  assert.ok(role.evidence[0].quote.includes('distributor'));
  assert.equal(role.evidence[0].sourceUrl,page.url);
  assert.equal(role.evidence[0].reviewStatus,'requires_human_verification');
  const unrelated=identifyCompanyRole([{...page,aiText:'Garmin is a manufacturer of transponders.'}],
    'https://aircraftspruce.com/');
  assert.equal(unrelated.primaryRole,'unknown');
});
test('company role is unknown when no explicit role evidence; no OEM assumption',()=>{
  const pages=[{url:'https://example.org/',status:'completed',title:'Example',aiText:'Top-quality products, catalog and free shipping.'}];
  assert.equal(identifyCompanyRole(pages,'https://example.org/').status,'unknown');
  assert.equal(identifyCompanyRole(pages,'https://example.org/').roles.length,0);
});
test('manufacturer, service-provider and mixed roles stay unverified and evidence based',()=>{
  const a={url:'https://1up-usa.com/about/',status:'completed',aiText:'We design and manufacture bicycle racks in the United States.'};
  const b={url:'https://1up-usa.com/about/team',status:'completed',aiText:'We are an authorized distributor of replacement components.'};
  assert.equal(identifyCompanyRole([a],'https://1up-usa.com/').primaryRole,'manufacturer');
  const mixed=identifyCompanyRole([a,b],'https://1up-usa.com/');
  assert.equal(mixed.primaryRole,'mixed_unverified');
  assert.equal(mixed.evidence.length,2);
  const service={url:'https://abbotttool.com/about/',status:'completed',aiText:'We provide CNC machining services for industrial clients.'};
  assert.equal(identifyCompanyRole([service],'https://abbotttool.com/').primaryRole,'service_provider');
});
test('25 SKU variants collapse to 5 conservative named/model families, never 25 gaps',()=>{
  const models=variants();
  const families=groupProductFamilies(models);
  assert.equal(models.length,25);
  assert.equal(families.length,5);
  assert.deepEqual(families.map(f=>f.memberCount).sort((a,b)=>a-b),[1,1,3,6,14]);
  assert.equal(families.filter(f=>f.taxonomy.status==='gap_or_insufficient_evidence').length,5);
  assert.equal(families.every(f=>f.reviewStatus==='requires_human_verification'),true);
  assert.equal(families.reduce((n,f)=>n+f.members.length,0),25);
});
test('identical Quik Rack leads on three URLs are one provisional family',()=>{
  const products=[1,2,3].map(i=>({...mk('Quik Rack',i,'https://1up-usa.com/product-category/rack-'+i+'/'),
    kind:'product_family'}));
  const families=groupProductFamilies(products);
  assert.equal(families.length,1);
  assert.equal(families[0].memberCount,3);
  assert.equal(families[0].sourceUrls.length,3);
  assert.equal(families[0].leadId.length,16);
});
test('different named products are not collapsed merely because they are all racks',()=>{
  const families=groupProductFamilies([mk('Quik Rack',1),mk('Recon Rack',2),mk('Heavy Duty Rack',3)]);
  assert.equal(families.length,3);
});
test('no taxonomy installed is not reported as missing taxonomy categories',()=>{
  const p=[mk('Quik Rack',1),mk('Quik Rack',2)].map(x=>({...x,taxonomy:{status:'not_loaded',suggestions:[]}}));
  const f=groupProductFamilies(p);
  assert.equal(f.length,1);assert.equal(f[0].taxonomy.status,'not_loaded');
});
test('Stage 2 groups proposals by family and exports both family and raw SKU counts',async()=>{
  const raw=variants().map(p=>({name:p.name,sku:p.sku,sourceUrl:p.sourceUrl,
    evidenceType:p.evidenceType}));
  const page={url:'https://aircraftspruce.com/products/aviation/',status:'completed',
    title:'Aircraft Spruce | Aviation',
    aiText:"Aircraft Spruce is a distributor of aviation products. Garmin manufactures avionics.",
    headings:[],structuredProducts:raw};
  const report={requestedUrl:'https://aircraftspruce.com/',pages:[page],products:raw,
    coverage:{visitedPages:1,structuredProducts:raw.length},warnings:[],limitations:[],status:'sampled'};
  const nodes=parseTaxonomy(JSON.stringify([{code:'top',label:'Mobility',children:[
    {code:'other',label:'Miscellaneous',children:[{code:'parts',label:'Unrelated Parts'}]}]}]));
  const calls=[];
  const out=await stage2Analyze(report,{nodes,client:async(action,payload)=>{
    calls.push({action,payload});
    return {schemaVersion:'insidejob-stage2/1',status:'not_configured',proposals:[],aiProducts:[]};
  }});
  assert.equal(out.products.length,25);
  assert.equal(out.families.length,5);
  assert.equal(out.coverage.productLeads,25);
  assert.equal(out.coverage.productFamilies,5);
  assert.equal(out.coverage.unmappedProductRecords,25);
  assert.equal(out.coverage.taxonomyGaps,5);
  assert.equal(out.companyRole.primaryRole,'distributor');
  const proposed=calls.find(x=>x.action==='propose');
  assert.ok(proposed,'family-level candidates should be sent for review');
  assert.equal(proposed.payload.gaps.length,5);
  assert.equal(new Set(proposed.payload.gaps.map(x=>x.name)).size,5);
});
test('4-page research prioritizes identity evidence without moving a 2-page product-first test',async()=>{
  const url='https://example.org/',visited=[];
  const extractPage=async u=>{
    visited.push(u);
    return {status:'completed',strategy:'S01',sourceUrl:u,
      content:{title:'Example',text:'Products are shown here.',
        links:u===url?[{url:url+'products/widget',label:'Widget products'},
          {url:url+'about',label:'About our company'}]:[]},warnings:[],evidence:[]};
  };
  await runResearch({url,maxPages:4,extractPage});
  assert.equal(visited[1],url+'about');
  visited.length=0;
  await runResearch({url,maxPages:2,extractPage});
  assert.equal(visited[1],url+'products/widget');
});

test('a fabricated family quote cannot become an AI taxonomy proposal merely because a product name is present',async()=>{
  const site='https://1up-usa.com/products/quik-rack';
  const report={requestedUrl:'https://1up-usa.com/',pages:[{
    url:site,status:'completed',title:'Quik Rack',aiText:'Quik Rack is a hitch bicycle rack.',
    headings:['Quik Rack'],structuredProducts:[{name:'Quik Rack',sourceUrl:site}]
  }],products:[{name:'Quik Rack',quote:'A fabricated product statement not present on this page.',
    kind:'product_family',sourceUrl:site,evidenceType:'ai_quote_in_sample_unverified'}],
  coverage:{visitedPages:1},warnings:[],limitations:[]};
  const nodes=parseTaxonomy(JSON.stringify([{code:'industry',label:'Industry',children:[
    {code:'materials',label:'Materials',children:[{code:'adhesives',label:'Adhesives'}]}]}]));
  const actions=[];
  const result=await stage2Analyze(report,{nodes,client:async(action)=>{
    actions.push(action);return {schemaVersion:'insidejob-stage2/1',status:'not_configured',proposals:[],aiProducts:[]};
  }});
  assert.equal(result.coverage.taxonomyGaps,1,'unmapped is a provisional mapping issue');
  assert.equal(actions.includes('propose'),false,'never ask AI for a taxonomy node without page-supported quote');
});

test('retailer product listing cannot turn a quoted vendor self-description into the retailer role',()=>{
  const pages=[
    {url:'https://aircraftspruce.com/catalog/avpages/model.php',status:'completed',
     aiText:'We manufacture the world’s best aviation transponders. Buy from Aircraft Spruce.'},
    {url:'https://aircraftspruce.com/catalog/stpages/companyhistory.php',status:'completed',
     title:'Aircraft Spruce | History',aiText:'Aircraft Spruce is a distributor of aviation equipment.'}
  ];
  const company=identifyCompanyRole(pages,'https://aircraftspruce.com/');
  assert.equal(company.primaryRole,'distributor');
  assert.deepEqual(company.roles,['distributor']);
  assert.equal(company.evidence.length,1);
});
test('RC Allen numeric-only and RCA-alphanumeric spellings group under one provisional model family',()=>{
  const rows=[
    mk('RC Allen 2610 3P Digital Attitude Indicator',1),
    mk('RC Allen RCA2610-3P Digital Attitude Indicator',2),
    mk('RCA 2610-3 Series Digital Attitude Indicators',3)
  ];
  const groups=groupProductFamilies(rows);
  assert.equal(groups.length,1);
  assert.equal(groups[0].memberCount,3);
});
