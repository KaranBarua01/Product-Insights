import test from 'node:test';
import assert from 'node:assert/strict';
import {extractPageIntelligence,extractProductIntelligence,classifyIntelligencePage,
  canonicalPageUrl,PRODUCT_INTELLIGENCE_SCHEMA} from '../tools/product-intelligence.mjs';
const H='manufacturer.example.org',BASE='https://'+H+'/';
function page(url,text,heading='',options={}){
  return {url,sourceUrl:url,status:options.status||'completed',strategy:options.strategy||'S01',
    evidence:[],content:{title:options.title||heading||'Product Insights sample',
      headings:heading?[heading]:[],text,links:options.links||[],jsonLd:options.jsonLd||[]}};
}
test('path classification distinguishes product, category, company and false lead paths',()=>{
  assert.equal(classifyIntelligencePage(BASE+'product/heavy-duty'),'product');
  assert.equal(classifyIntelligencePage(BASE+'productcategory/standard-tubs/'),'category');
  assert.equal(classifyIntelligencePage(BASE+'product-category/racks/collections'),'category');
  assert.equal(classifyIntelligencePage(BASE+'product/r2a-fsp'),'product');
  assert.equal(classifyIntelligencePage(BASE+'catalog/inpages/730_830jpi.php'),'product');
  assert.equal(classifyIntelligencePage(BASE+'catalog/stpages/companyhistory.php'),'other');
  assert.equal(classifyIntelligencePage(BASE+'catalog/pspages/giftcards.php'),'other');
  assert.equal(classifyIntelligencePage(BASE+'about-us/'),'company');
  assert.equal(classifyIntelligencePage(BASE+'brochure.pdf','S03'),'document');
  assert.equal(canonicalPageUrl(BASE+'product/model/?utm_source=ad#extra'),BASE+'product/model');
});
test('1UP-style product page without JSON-LD yields product with grounded attributes',()=>{
  const url=BASE+'product/heavy-duty';
  const lines=[
    'Heavy Duty',
    'Heavy Duty (HD) is a rugged, tray-style bike rack built to haul downhill bikes and e-bikes up to 65 lbs.',
    'Made entirely from corrosion-resistant aluminum, it is built for durability.',
    'Includes a loading tray and two mounting arms.',
    'Weight Capacity: 65 lbs',
    'Related products', 'Quik Rack'
  ].join('\n');
  const result=extractProductIntelligence({companyName:'Rack Company',rootUrl:BASE,
    pages:[page(url,lines,'Heavy Duty')]});
  assert.equal(result.schemaVersion,PRODUCT_INTELLIGENCE_SCHEMA);
  assert.equal(result.products.length,1);
  const p=result.products[0];
  assert.equal(p.name,'Heavy Duty');
  assert.equal(p.extractionMethod,'product_page_heading');
  assert.equal(p.companyProductRole,'manufactured_vs_sold_not_determined');
  assert.ok(p.specifications.some(x=>x.attribute==='weight_capacity'&&x.value==='65 lbs'));
  assert.ok(p.materials.some(x=>x.material==='aluminum'));
  assert.ok(p.components.some(x=>x.component.includes('tray')));
  assert.ok(p.components.some(x=>x.component.includes('arms')));
  for(const x of [...p.specifications,...p.materials,...p.components]){
    assert.equal(x.evidence.sourceUrl,url);
    assert.ok(lines.includes(x.evidence.quote),'verbatim source quote required');
    assert.equal(x.evidence.reviewStatus,'requires_human_verification');
  }
});
test('Hoshizaki-style JSON-LD and HTML specification labels attach to one primary product',()=>{
  const url=BASE+'product/r2a-fsp/';
  const lines='R2A-FSP Tamper-Proof Refrigerator\nElectrical Connection: 115 V, Energy Consumption: 3.47 kWh/day, Amperage: 8A\nVoltage Range: 104 – 126V, Refrigerant: R290 (4.9 oz.)';
  const result=extractProductIntelligence({companyName:'Cooling Company',rootUrl:BASE,
    pages:[page(url,lines,'R2A-FSP Tamper-Proof Refrigerator',{
      jsonLd:[{'@type':'Product',name:'R2A-FSP Tamper-Proof Refrigerator',sku:'R2A-FSP'}]})]});
  assert.equal(result.products.length,1);
  assert.equal(result.products[0].extractionMethod,'published_jsonld');
  assert.equal(result.products[0].sku,'R2A-FSP');
  const attrs=result.products[0].specifications.map(x=>x.attribute);
  assert.ok(attrs.includes('voltage_range'));
  assert.ok(attrs.includes('electrical_connection'));
  assert.ok(attrs.includes('energy_consumption'));
  assert.ok(attrs.includes('amperage'));
  assert.ok(attrs.includes('refrigerant'));
});
test('CMC-style productcategory URLs yield categories even without Product JSON-LD',()=>{
  const category=BASE+'productcategory/standard-tubs/';
  const result=extractProductIntelligence({companyName:'Supply Company',rootUrl:BASE,pages:[
    page(category,'Standard Tubs\nBrowse our range of bathroom fixtures.','Standard Tubs'),
    page(BASE+'productcategory/bath-faucets/','Bath Faucets\nSee models.','Bath Faucets')]});
  assert.equal(result.categories.length,2);
  assert.deepEqual(result.categories.map(x=>x.name).sort(),['Bath Faucets','Standard Tubs']);
  assert.equal(result.products.length,0);
  assert.equal(result.coverage.categoryPages,2);
});
test('only observed same-host category-to-product links create relationships',()=>{
  const catalog=BASE+'productcategory/bike-racks/';
  const item=BASE+'product/heavy-duty';
  const report=extractProductIntelligence({companyName:'Rack Company',rootUrl:BASE,pages:[
    page(catalog,'Bike Racks','Bike Racks',{links:[{url:item+'/',label:'Heavy Duty'},{url:'https://unrelated.example.net/product/fake',label:'Fake'}]}),
    page(item,'Heavy Duty\nWeight Capacity: 65 lbs','Heavy Duty')]});
  assert.equal(report.products.length,1);
  assert.deepEqual(report.products[0].categoryIds,[report.categories[0].id]);
  assert.equal(report.products[0].categoryLinkStatus,'linked_from_category_page_unverified');
  assert.ok(report.products[0].specifications.length);
});
test('no transfer of specs, materials or manufacturing claims from categories or distributors',()=>{
  const r=extractProductIntelligence({companyName:'Aircraft Dealer',rootUrl:BASE,pages:[
    page(BASE,'We are a distributor of products. The catalog offers aluminum aircraft components.','Welcome'),
    page(BASE+'productcategory/parts','Made from carbon fiber and steel. Weight Capacity: 100 kg','Parts'),
    page(BASE+'product/headset','Aviation Headset','Aviation Headset')]});
  assert.equal(r.products.length,1);
  assert.deepEqual(r.products[0].specifications,[]);
  assert.deepEqual(r.products[0].materials,[]);
  assert.deepEqual(r.products[0].components,[]);
  assert.equal(r.products[0].companyProductRole,'manufactured_vs_sold_not_determined');
  assert.equal(r.company.roleCandidate.primaryRole,'distributor');
});
test('false-positive catalog paths, generic headings and blocked pages never become products',()=>{
  const r=extractProductIntelligence({companyName:'Aircraft Dealer',rootUrl:BASE,pages:[
    page(BASE+'catalog/stpages/companyhistory.php','Company history','Company History'),
    page(BASE+'catalog/pspages/giftcards.php','Gift cards','Gift Cards'),
    page(BASE+'product/new','Videos\nShow videos\nNo identified product here','Videos'),
    page(BASE+'product/heavy-duty','Heavy Duty\nWeight: 10 kg','Heavy Duty',{status:'blocked'}),
    page('https://outside.example.net/product/fake','Fake Product','Fake Product')]});
  assert.equal(r.products.length,0);
});
test('published variants remain independent SKUs but only primary named product gets page specifications',()=>{
  const u=BASE+'products/mixer-10';
  const r=extractProductIntelligence({companyName:'Machine Maker',rootUrl:BASE,pages:[
    page(u,'Mixer 10\nPower: 200 W','Mixer 10',{jsonLd:[
      {'@type':'Product',name:'Mixer 10',sku:'M10'},
      {'@type':'Product',name:'Mixer 20',sku:'M20'}
    ]})]});
  assert.equal(r.products.length,2);
  assert.equal(r.products.find(x=>x.name==='Mixer 10').specifications.length,1);
  assert.equal(r.products.find(x=>x.name==='Mixer 20').specifications.length,0);
});
test('bounds: at most twelve input pages, exact host only, source-domain and quote confinement',()=>{
  const pages=Array.from({length:13},(_,i)=>page(BASE+'product/model-'+i,'Model '+i+'\nWeight: 12 kg','Model '+i));
  assert.throws(()=>extractProductIntelligence({companyName:'A',rootUrl:BASE,pages}),/at most 12/);
  const r=extractProductIntelligence({companyName:'A',rootUrl:BASE,
    pages:[pages[0],pages[0],page('https://other.example.net/product/fake','Fake\nWeight: 12 kg','Fake')]});
  assert.equal(r.products.length,1);
  assert.equal(r.coverage.pagesUnique,1);
  assert.equal(r.products[0].specifications[0].evidence.sourceUrl,pages[0].url);
});
test('unsupported body text cannot create invented components or assumed engineering facts',()=>{
  const result=extractPageIntelligence(page(BASE+'product/industrial-rack',
    'Industrial Rack\nLightweight, efficient, industry-leading solution for diverse applications.',
    'Industrial Rack'),H);
  assert.equal(result.products.length,1);
  assert.deepEqual(result.products[0].materials,[]);
  assert.deepEqual(result.products[0].components,[]);
  assert.deepEqual(result.products[0].specifications,[]);
});
