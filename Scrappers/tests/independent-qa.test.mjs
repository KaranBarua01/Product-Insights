import test from 'node:test';
import assert from 'node:assert/strict';
import {identifyCompanyRole} from '../tools/research-intelligence.mjs';
import {mapProductCandidates,runResearch} from '../tools/research-planner.mjs';
import {validateAiProducts} from '../tools/research-stage2.mjs';
import {handleStage2Request} from '../dist/stage2-routes.js';
import {parseHtml} from '../dist/html.js';
import {offlineProductLeads} from '../tools/research-stage2.mjs';

const root='https://1up-usa.com/';

test('passive own-product manufacturing statement on About page supports manufacturer candidate',()=>{
  const page={url:root+'about-us/',status:'completed',title:'About Us',
    aiText:'From raw aluminum to road-ready, our bike racks are proudly designed, manufactured, and assembled in the United States.'};
  const role=identifyCompanyRole([page],root);
  assert.equal(role.primaryRole,'manufacturer');
  assert.equal(role.evidence[0].sourceUrl,page.url);
  assert.ok(page.aiText.includes(role.evidence[0].quote));
  assert.equal(role.evidence[0].reviewStatus,'requires_human_verification');
  assert.equal(identifyCompanyRole([{...page,aiText:'Our bike racks are never manufactured at this facility.'}],root).primaryRole,'unknown');
  assert.equal(identifyCompanyRole([{...page,url:root+'product/vendor-rack'}],root).primaryRole,'unknown');
});

test('Heavy Duty bicycle rack cannot map to truck transmissions by shared modifiers alone',()=>{
  // Sanitized reference choices; no private taxonomy file is embedded in this test.
  const nodes=[{code:'truck-transmissions',label:'Heavy-duty transmissions',level:3,
    path:'Mobility > Trucks > Powertrain > Heavy-duty transmissions'}];
  const [rack]=mapProductCandidates([{name:'Heavy Duty',quote:'The ultimate hauler for road bikes and e-bikes.'}],nodes);
  assert.equal(rack.taxonomy.status,'gap_or_insufficient_evidence');
  assert.deepEqual(rack.taxonomy.suggestions,[]);
  const [gearbox]=mapProductCandidates([{name:'Heavy Duty Transmissions'}],nodes);
  assert.equal(gearbox.taxonomy.suggestions[0].code,'truck-transmissions');
});

test('bounded research reaches observed product detail ahead of broad category menus',async()=>{
  const visited=[];
  await runResearch({url:root,maxPages:4,extractPage:async url=>{
    visited.push(url);
    return {sourceUrl:url,status:'completed',strategy:'S01',content:{title:'1UP USA',text:'Published page text',
      links:url===root?[
        {url:root+'product-category/racks/',label:'Racks'},
        {url:root+'product-category/racks/hitch-bike-racks/',label:'Hitch Bike Racks'},
        {url:root+'product-category/racks/hitch-bike-racks/quik-rack/',label:'Quik Rack'},
        {url:root+'product-category/products/collections/',label:'Collections'},
        {url:root+'about-us/',label:'About Us'},
        {url:root+'product/quik-rack',label:'SHOP NOW'},
        {url:root+'product/equipd',label:'SHOP NOW'}]:[]},evidence:[],warnings:[]};
  }});
  assert.deepEqual(visited,[root,root+'about-us/',root+'product/quik-rack',root+'product/equipd']);
});

test('local AI validator rejects invented product names paired with genuine quotes',()=>{
  const sourceUrl=root+'product/quik-rack',quote='Quik Rack carries bicycles on a vehicle hitch.';
  const good={name:'Quik Rack',quote,sourceUrl,kind:'product_model'};
  const accepted=validateAiProducts([good,{...good,name:'Quantum Laser Welder'},{...good,name:'Quik Rack+'}],[{url:sourceUrl,aiText:quote}]);
  assert.deepEqual(accepted.map(p=>p.name),['Quik Rack']);
});

test('Worker AI validator rejects invented product names paired with genuine quotes',async()=>{
  const text='Quik Rack carries bicycles on a vehicle hitch.';
  const request=new Request('https://worker.example/api/stage2/analyze',{method:'POST',
    headers:{authorization:'Bearer test-only','content-type':'application/json'},
    body:JSON.stringify({rootUrl:root,pages:[{url:root+'product/quik-rack',title:'Quik Rack',text}]})});
  const response=await handleStage2Request(request,{SCRAPPERS_API_TOKEN:'test-only',AI:{run:async(_model,params)=>({response:
    params.response_format.json_schema.properties.facts?{facts:[]}:{products:[
      {name:'Quik Rack',kind:'product_model',quote:text,sourceId:1},
      {name:'Quantum Laser Welder',kind:'product_model',quote:text,sourceId:1},
      {name:'Quik Rack+',kind:'product_model',quote:text,sourceId:1}
    ]}})}});
  const out=await response.json();
  assert.deepEqual(out.aiProducts.map(p=>p.name),['Quik Rack']);
  assert.equal(out.diagnostics.rejectedProductSuggestions,2);
});

test('passive manufacturing by a named supplier never becomes the researched company role',()=>{
  const page={url:root+'about-us/',status:'completed',title:'About Us',
    aiText:'Our bike racks are manufactured by independent suppliers. We are a retailer.'};
  assert.equal(identifyCompanyRole([page],root).primaryRole,'distributor');
  assert.equal(identifyCompanyRole([{...page,aiText:'Our bike racks are manufactured by VendorCo, not by us.'}],root).primaryRole,'unknown');
});

test('technical detail bonuses and AI planning cannot displace the reserved identity page',async()=>{
  const visited=[];
  await runResearch({url:root,maxPages:4,prioritizeLinks:async()=>[root+'product/rack-1'],extractPage:async url=>{
    visited.push(url);
    return {sourceUrl:url,status:'completed',strategy:'S01',content:{title:'Company',text:'Published text',
      links:url===root?[
        {url:root+'about-us/',label:'About Us'},
        ...[1,2,3].map(i=>({url:root+'product/rack-'+i,label:'Technical specifications'}))
      ]:[]},evidence:[],warnings:[]};
  }});
  assert.equal(visited[1],root+'about-us/');
  assert.ok(visited.includes(root+'product/rack-1'));
});

test('product heading outside description article survives extraction instead of becoming a Videos product',()=>{
  const url=root+'product/heavy-duty';
  const {content}=parseHtml('<html><head><title>Heavy Duty Hitch Bike Rack | 1UP USA</title></head><body><h1>Heavy Duty</h1><article><p>Heavy Duty is a tray-style bike rack.</p><h3>Videos Hide Videos Show Videos</h3></article></body></html>',url,'S02');
  const leads=offlineProductLeads([{url,status:'completed',title:content.title,headings:content.headings,aiText:content.text}]);
  assert.equal(leads.length,1);
  assert.equal(leads[0].name,'Heavy Duty');
  assert.ok(leads[0].quote.includes('Heavy Duty'));
});

test('utility section heading without a product heading falls back to published page title',()=>{
  const leads=offlineProductLeads([{url:root+'product/heavy-duty',status:'completed',
    title:'Heavy Duty Hitch Bike Rack | 1UP USA',headings:['Videos Hide Videos Show Videos'],
    aiText:'Heavy Duty is a tray-style bike rack. Videos Hide Videos Show Videos'}]);
  assert.equal(leads[0].name,'Heavy Duty Hitch Bike Rack');
});

test('site header H1 cannot displace the primary product heading',()=>{
  const url='https://rackshop.example/product/quik-rack/';
  const {content}=parseHtml('<header><h1>Rack Shop</h1></header><main><h1>Quik Rack</h1><p>Quik Rack is a hitch bicycle carrier.</p></main>',url);
  const leads=offlineProductLeads([{url,status:'completed',headings:content.headings,aiText:content.text}]);
  assert.equal(leads[0]?.name,'Quik Rack');
});

test('utility filtering preserves real model names beginning with Video or Guide',()=>{
  for(const name of ['Videojet 1280','Guide Rail Assembly']){
    const leads=offlineProductLeads([{url:'https://vidshop.example/product/model',status:'completed',
      title:'Industrial Equipment | Vidshop',headings:[name],aiText:name+' is available in the published catalog.'}]);
    assert.equal(leads[0].name,name);
  }
});
