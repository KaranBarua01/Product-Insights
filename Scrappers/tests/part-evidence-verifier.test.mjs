import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {buildPartEvidenceReport,normalizeD1Context,PART_EVIDENCE_SCHEMA} from '../tools/part-evidence-verifier.mjs';
import {loadD1CompanyContext} from '../tools/d1-company-context.mjs';
const BASE='https://www.igus.com/',P=BASE+'cable-carriers/special-solutions/e-loop';
const d1={website:'igus.com',what_they_make:'Cable carriers, bearings',commodity:'Injection molding, CNC machining',
  materials_required:'Polyurethane, aluminum, steel',manufacturing_role:'Supplier / outsource manufacturer',evidence_confidence:'High'};
function page(url,text,head='e-loop'){return {sourceUrl:url,url,status:'completed',content:{headings:[head],text}};}
function run({companyUrl=BASE,products=[{name:'e-loop',sourceUrl:P}],pages=[],d1Record=d1}={}){
 return buildPartEvidenceReport({companyName:'igus',companyUrl,products,pages,d1Record});
}
test('D1 process/material/role are only company-level unverified priors',()=>{
 const a=run();assert.equal(a.schemaVersion,PART_EVIDENCE_SCHEMA);assert.equal(a.d1.manufacturingRole,d1.manufacturing_role);
 assert.equal(a.d1.processHypotheses[0],'Injection molding');
 assert.equal(a.products[0].parts.length,0);assert.equal(a.counts.partProcessCandidates,0);
 assert.equal(a.originalMasterModified,false);assert.equal(a.osWritePerformed,false);
});
test('e-loop source text yields part/material/process links only on matching product detail',()=>{
 const text=[
  'The e-loop consists of four injection-molded inner components that hold the cables.',
  'The e-loop includes polyurethane outer protectors to resist impact.',
  'The system includes a fiber tension rope for tensile support.',
  'It features steel mounting brackets for the top drive.'
 ].join('\n');
 const a=run({pages:[page(P,text)]}),p=a.products[0];
 assert.equal(p.sourceStatus,'primary_product_page_available');
 assert.ok(p.parts.some(x=>/inner components/.test(x.name)));
 assert.ok(p.parts.some(x=>/protectors/.test(x.name)));
 assert.ok(p.parts.some(x=>/mounting brackets/.test(x.name)));
 const inner=p.parts.find(x=>/inner components/.test(x.name));
 assert.ok(inner.processClaims.some(x=>x.name==='Injection molding'));
 const protectors=p.parts.find(x=>/protectors/.test(x.name));
 assert.ok(protectors.materialClaims.some(x=>x.name==='polyurethane'));
 assert.ok(p.parts.find(x=>/brackets/.test(x.name)).materialClaims.some(x=>x.name==='steel'));
 assert.ok(p.parts.every(x=>x.isVerifiedBom===false&&x.isCompanyCapability===false));
 assert.ok(p.parts.flatMap(x=>x.observations).every(x=>text.includes(x.quote)));
});
test('wrong product pages cannot donate materials or components to another product',()=>{
 const rack='https://1up-usa.com/product/heavy-duty',quick='https://1up-usa.com/product/quik-rack';
 const a=buildPartEvidenceReport({companyName:'1UP',companyUrl:'https://1up-usa.com',
  d1Record:{website:'1up-usa.com',materials_required:'Aluminum, Steel',commodity:'CNC machining'},
  products:[{name:'Quik Rack',sourceUrl:quick,components:[{component:'casters',evidence:{sourceUrl:'https://1up-usa.com/product-category/products/collections',quote:'Features locking casters.'}}]},
            {name:'Heavy Duty',sourceUrl:rack}],
  pages:[page(rack,'Heavy Duty is made from aluminum and includes a locking mechanism.','Heavy Duty'),
    page('https://1up-usa.com/product-category/products/collections','Features locking casters.','Collections')]});
 const q=a.products.find(x=>x.name==='Quik Rack'),hd=a.products.find(x=>x.name==='Heavy Duty');
 assert.equal(q.parts.length,0);assert.equal(q.sourceStatus,'insufficient_primary_product_page_evidence');
 assert.equal(q.uncorroboratedScraperMentions.length,1);
 assert.ok(hd.productMaterials.some(x=>x.name==='aluminum'));
 assert.equal(hd.parts.find(x=>/locking mechanism/.test(x.name)).materialClaims.length,0);
});
test('collection page candidates and distributor capabilities are never promoted to product facts',()=>{
 const a=buildPartEvidenceReport({companyName:'E-Vac',companyUrl:'https://www.1evac.com',d1Record:{website:'1evac.com',
  manufacturing_role:'Distributor / dealer / service company',commodity:'Sand casting, CNC machining'},
  products:[{name:'Claw Vacuum Pumps',sourceUrl:'https://www.1evac.com/product-category/products/collections'}],
  pages:[page('https://www.1evac.com/product-category/products/collections','Contains machined housings for each pump.','Collections')]});
 assert.equal(a.products.length,0);assert.equal(a.counts.partProcessCandidates,0);
 assert.equal(a.d1.manufacturingRole,'Distributor / dealer / service company');
});
test('a statement saying a part might be machined must NOT count as observed process',()=>{
 const a=run({pages:[page(P,'The e-loop includes a steel mounting bracket that could be CNC machined.')]});
 assert.equal(a.products[0].parts[0].processClaims.length,0);
 assert.equal(a.products[0].parts[0].materialClaims[0].name,'steel');
});
test('wrong D1 domain is ignored (identity protection)',()=>{
 const a=run({d1Record:{...d1,website:'different-company.com'}});
 assert.equal(a.d1,null);
 assert.equal(normalizeD1Context(BASE,{...d1,website:'different-company.com'}),null);
});
test('source quote in scraper component must exist in primary page text',()=>{
 const text='This e-loop includes steel mounting brackets.';
 const a=run({products:[{name:'e-loop',sourceUrl:P,
  components:[{component:'casters',evidence:{sourceUrl:P,quote:'Includes locking casters.'}},
              {component:'mounting brackets',evidence:{sourceUrl:P,quote:'includes steel mounting brackets.'}}]}],
  pages:[page(P,text)]});
 assert.ok(a.products[0].parts.find(x=>/mounting brackets/.test(x.name)));
 assert.ok(!a.products[0].parts.some(x=>/casters/.test(x.name)));
 assert.equal(a.products[0].uncorroboratedScraperMentions.length,1);
});
test('D1 loader imports exact-domain subset from private local file, does not mutate it',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'pi-d1-context-')),file=join(dir,'subset.json');
 const rows=[d1,{...d1,website:'other-company.com'}];await writeFile(file,JSON.stringify(rows));
 const result=await loadD1CompanyContext({companyUrl:BASE,filename:file});
 assert.deepEqual(result,d1);assert.equal(await loadD1CompanyContext({companyUrl:'https://unknown.example',filename:file}),null);
});