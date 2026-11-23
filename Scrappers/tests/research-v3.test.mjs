import test from 'node:test';
import assert from 'node:assert/strict';
import {runResearchV3,v3SafeUrl,v3RankLink,V3_MAX_PAGES} from '../tools/research-v3.mjs';
import {enrichPartEvidenceV3,linkedDocumentForProduct,extractProductIntelligenceV3,v3FamilyPageCandidate} from '../tools/evidence-bridge-v3.mjs';
const root='https://industrial.example.com/',detail=root+'product/pump-100',doc=root+'technical/pump-100-manual.pdf';
function companyPage(url,content={}){return {sourceUrl:url,url,status:'completed',strategy:url.endsWith('.pdf')?'S03':'S01',
  content:{title:'Industrial',headings:[],text:'Published company information.',links:[],...content},evidence:[]};}
const document={url:doc,sourceUrl:doc,status:'completed',strategy:'S03',content:{
  text:'Pump 100 service manual. Impeller material: stainless steel. Shaft is CNC machined.',
  pdfPages:[{page:1,text:'Pump 100 service manual.\nImpeller material: stainless steel.\nShaft is CNC machined.'}]}};
const product={name:'Pump 100',sourceUrl:detail,sku:null,components:[]};
const productPage=companyPage(detail,{title:'Pump 100',headings:['Pump 100'],
  text:'Pump 100 is a centrifugal pump with an impeller and shaft.',links:[{url:doc,label:'Pump 100 parts manual PDF'}]});
function execute(opts={}){return enrichPartEvidenceV3({companyName:'Industrial',companyUrl:root,
  products:[product],pages:[productPage,document],documentLinks:[{productPageUrl:detail,documentUrl:doc}],...opts});}

test('V3 limits 1-50 pages and refuses invalid budgets',async()=>{
  await assert.rejects(runResearchV3({url:root,maxPages:51,extractPage:async()=>companyPage(root)}),/1-50/);
  assert.equal(V3_MAX_PAGES,50);
});
test('V3 does not mistake material categories for technical documents',()=>{
 const unrelated=v3RankLink({url:root+'3d-printing-material/3d-printer-materials',label:'3D printer materials'},'industrial.example.com',
   {parentKind:'company',productCount:0});
 assert.ok(!unrelated||unrelated.score<95);
 const docRank=v3RankLink({url:root+'technical/pump-100-manual.pdf',label:'Pump 100 manual'},'industrial.example.com',
   {parentKind:'product',productCount:1});
 assert.ok(docRank.score>=200);
});
test('replacement parts catalogs do not displace main finished-product catalogs',()=>{
 const primary=v3RankLink({url:root+'product-category/products/all',label:'All products'},'industrial.example.com',
   {parentKind:'company',productCount:0});
 const replacement=v3RankLink({url:root+'product-category/parts/replacement-parts',label:'Replacement parts'},'industrial.example.com',
   {parentKind:'company',productCount:0});
 assert.ok(primary.score>replacement.score);
});
test('a trailing slash or tracking fragment never consumes a second crawl slot',()=>{
 const host='industrial.example.com';
 assert.equal(v3SafeUrl(root+'product/pump-100/',host),v3SafeUrl(root+'product/pump-100',host));
 assert.equal(v3SafeUrl(root+'product/pump-100?utm_source=mail#top',host),v3SafeUrl(root+'product/pump-100',host));
});
test('cross-host URLs and private-data links cannot enter frontier',()=>{
  assert.equal(v3SafeUrl('https://other.example.com/product/part','industrial.example.com'),null);
  assert.equal(v3RankLink({url:root+'login',label:'Login'},'industrial.example.com'),null);
});
test('product-linked technical PDF outranks unrelated catalogue leads',async()=>{
 const page=root+'products'; const other=root+'products/other';const visited=[];
 const r=await runResearchV3({url:root,maxPages:5,delayMs:0,extractPage:async url=>{
   visited.push(url);
   if(url===root)return companyPage(url,{links:[{url:page,label:'Products catalogue'}]});
   if(url===page)return companyPage(url,{links:[{url:detail,label:'Pump 100'},{url:other,label:'Other Model'}]});
   if(url===detail)return productPage;
   if(url===doc)return document;
   return companyPage(url);
 }});
 assert.ok(visited.indexOf(doc)>visited.indexOf(detail));
 assert.equal(visited.indexOf(doc),visited.indexOf(detail)+1);
 assert.equal(r.documentLinks.length,1);
 assert.equal(r.documentLinks[0].productPageUrl,detail);
 assert.equal(r.coverage.directProductDocumentLinks,1);
});
test('model-specific technical document is eligible only with a direct product-page link',()=>{
 const link={productPageUrl:detail,documentUrl:doc};
 assert.equal(linkedDocumentForProduct({product,productPage,documentPage:document,documentLink:link,products:[product]}),true);
 assert.equal(linkedDocumentForProduct({product,productPage:{...productPage,content:{...productPage.content,links:[]}},documentPage:document,documentLink:link}),false);
 assert.equal(linkedDocumentForProduct({product,productPage,documentPage:{...document,content:{text:'Another pump uses steel in shaft.',pdfPages:[]}},documentLink:link}),false);
});
test('source documents cannot describe unrelated product variants without SKU disambiguation',()=>{
 const p2={name:'Pump 200',sourceUrl:root+'product/pump-200',sku:null};
 const multi={...document,content:{text:'Pump 100 and Pump 200. Impeller material: stainless steel.'}};
 assert.equal(linkedDocumentForProduct({product,productPage,documentPage:multi,
   documentLink:{productPageUrl:detail,documentUrl:doc},products:[product,p2]}),false);
});
test('PDFs with no line breaks retain late document component and process evidence',()=>{
 const lead='Pump 100 service manual. '+'General product overview and warranty text. '.repeat(55);
 const tail=' Impeller material: stainless steel. Shaft is CNC machined.';
 const long={...document,content:{text:lead+tail,pdfPages:[{page:2,text:lead+tail}]}};
 const r=execute({pages:[productPage,long]});
 assert.ok(r.products[0].parts.some(p=>/impeller/.test(p.name)&&
   p.materialClaims.some(m=>m.name==='stainless steel'&&m.evidence.locator.includes('PDF page 2'))));
 assert.ok(r.products[0].parts.some(p=>/shaft/.test(p.name)&&
   p.processClaims.some(m=>m.name==='CNC machining')));
});
test('a shared source-page manual without a specific SKU cannot be copied to sibling variants',()=>{
 const p1={...product,sku:'PUMP-100-A'};
 const p2={...product,sku:'PUMP-100-B'};
 assert.equal(linkedDocumentForProduct({product:p1,productPage,documentPage:document,
  documentLink:{productPageUrl:detail,documentUrl:doc},products:[p1,p2]}),false);
});
test('linked PDF adds source-attributed part/material/process candidates but no in-house assertions',()=>{
 const r=execute();
 assert.equal(r.schemaVersion,'pi-part-evidence/v3');
 assert.equal(r.v3.linkedDocumentsAccepted,1);
 const p=r.products.find(x=>x.name==='Pump 100');
 assert.ok(p.parts.some(x=>/impeller/i.test(x.name)));
 assert.ok(p.parts.some(x=>/shaft/i.test(x.name)));
 const impeller=p.parts.find(x=>/impeller/i.test(x.name));
 const shaft=p.parts.find(x=>/shaft/i.test(x.name));
 assert.ok(impeller.materialClaims.some(x=>x.name==='stainless steel'&&x.evidence.sourceUrl===doc));
 assert.ok(shaft.processClaims.some(x=>x.name==='CNC machining'&&x.evidence.sourceUrl===doc));
 assert.equal(impeller.processClaims.some(x=>x.name==='CNC machining'),false);
 assert.ok(p.parts.every(x=>x.isCompanyCapability===false&&x.isVerifiedBom===false));
 assert.equal(r.d1,null);
});
test('industrial product-family technical page yields new product->part manufacturing evidence without SKU inheritance',()=>{
 const eurl=root+'cable-carriers/special-solutions/e-loop';
 const text='e-loop modular top drive cable carrier. The inner body consists of four injection molded parts. '+
  'Outer protectors made of impact-absorbing PU protect the cables. '+
  'The chain links attach to the high strength hauling rope. The hauling rope is made of plastic fiber. '+
  'The mounting brackets are stable steel mounting brackets. Rated tensile load 50 kN.';
 const page=companyPage(eurl,{headings:['e-loop modular top drive cable carrier'],
   title:'e-loop modular top drive cable carrier',text});
 const family=v3FamilyPageCandidate(page,root);
 assert.ok(family);
 assert.equal(family.familyScope,'product_family_not_individual_variant');
 const catalog=extractProductIntelligenceV3({companyName:'igus',rootUrl:root,pages:[page]});
 assert.equal(catalog.products.length,1);
 const facts=enrichPartEvidenceV3({companyName:'igus',companyUrl:root,
    products:catalog.products,pages:[page]});
 assert.ok(facts.counts.partEvidenceCandidates>=3);
 const parts=facts.products[0].parts;
 assert.ok(parts.some(p=>/inner body/.test(p.name)&&p.processClaims.some(c=>c.name==='Injection molding')));
 assert.ok(parts.some(p=>/outer protectors?/i.test(p.name)&&p.materialClaims.some(c=>c.name==='polyurethane')));
 assert.ok(parts.some(p=>/mounting brackets?/.test(p.name)&&p.materialClaims.some(c=>c.name==='steel')));
 assert.equal(parts.some(p=>/cables?/.test(p.name)&&p.materialClaims.some(c=>c.name==='polyurethane')),false);
 assert.equal(facts.products[0].name,'e-loop modular top drive cable carrier');
 assert.ok(parts.every(p=>p.isVerifiedBom===false));
});
test('product-specific specification tables create correctly sourced material candidates',()=>{
 const page={...productPage,content:{...productPage.content,
   tables:[{rows:[['Component','Material'],['Impeller','stainless steel'],['Seal','rubber']]}]}};
 const r=execute({pages:[page]});
 const p=r.products[0];
 const impeller=p.parts.find(x=>/impeller/i.test(x.name));
 const seal=p.parts.find(x=>/seal/i.test(x.name));
 assert.ok(impeller?.materialClaims.some(m=>m.name==='stainless steel'&&m.evidence.sourceUrl===detail));
 assert.ok(seal?.materialClaims.some(m=>m.name==='rubber'&&m.evidence.sourceUrl===detail));
 assert.equal(r.v3.linkedDocumentsAccepted,0);
});
test('unverified D1 company priors never create part-process claims',()=>{
 const r=execute({pages:[productPage],d1Record:{website:'industrial.example.com',
   commodity:'sand casting, CNC machining',materials_required:'Titanium, Steel'}});
 assert.ok(r.d1?.processHypotheses.length);
 assert.equal(r.v3.linkedDocumentsAccepted,0);
 assert.equal(r.counts.partProcessCandidates,0);
});
test('blocked PDF never creates engineering evidence',()=>{
 const r=execute({pages:[productPage,{...document,status:'blocked'}]});
 assert.equal(r.v3.linkedDocumentsAccepted,0);
 assert.equal(r.counts.partMaterialCandidates,0);
});
test('unsupported outside-host document does not cross evidence boundary',()=>{
 const outside='https://other.example.com/pump-100.pdf';
 const r=execute({documentLinks:[{productPageUrl:detail,documentUrl:outside}]});
 assert.equal(r.v3.linkedDocumentsAccepted,0);
});
test('if source is only company text, no guessed materials or processes become part evidence',()=>{
 const r=execute({pages:[companyPage(root,{text:'We provide CNC machining, steel and pumps.'})]});
 assert.equal(r.counts.partProcessCandidates,0);
 assert.equal(r.counts.partMaterialCandidates,0);
});
test('V3 50-page product extraction wrapper processes extra pages without changing frozen original',()=>{
 const pages=Array.from({length:50},(_,i)=>companyPage(root+'product/model-'+(i+1)));
 const result=extractProductIntelligenceV3({companyName:'Example',rootUrl:root,pages});
 assert.equal(result.coverage.pagesSubmitted,50);
 assert.throws(()=>extractProductIntelligenceV3({companyName:'Example',rootUrl:root,pages:[...pages,pages[0]]}),/50/);
});