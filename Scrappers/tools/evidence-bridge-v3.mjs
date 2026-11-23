/**
 * V3 engineering evidence bridge. It conservatively connects a visited,
 * manufacturer-linked technical PDF/HTML document to exactly one inspected
 * product, without manufacturing ownership inference or D1 inheritance.
 * All findings remain source-quoted candidates requiring human review.
 */
import {createHash} from 'node:crypto';
import {buildPartEvidenceReport} from './part-evidence-verifier.mjs';
import {extractProductIntelligence,productFamilyKey} from './product-intelligence.mjs';

const norm=x=>String(x??'').replace(/\s+/g,' ').trim();
const key=x=>norm(x).toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const hash=x=>createHash('sha256').update(x).digest('hex').slice(0,16);
const same=(a,b)=>{try{const x=new URL(a),y=new URL(b);return x.hostname.toLowerCase()===y.hostname.toLowerCase()&&['http:','https:'].includes(x.protocol)&&['http:','https:'].includes(y.protocol);}catch{return false;}};
function canon(url){try{const u=new URL(url);if(!['http:','https:'].includes(u.protocol))return null;
  u.hash='';for(const k of [...u.searchParams.keys()])if(/^utm_|^(?:fbclid|gclid|ref)$/i.test(k))u.searchParams.delete(k);
  return u.href.replace(/\/$/,'');}catch{return null;}}
const MATERIALS=[
 ['stainless steel',/\bstainless\s+steel\b/i],['carbon steel',/\bcarbon\s+steel\b/i],
 ['cast iron',/\bcast\s+iron\b/i],['polyurethane',/\bpolyurethane\b/i],
 ['polypropylene',/\bpolypropylene\b/i],['polycarbonate',/\bpolycarbonate\b/i],
 ['aluminum',/\balumin(?:um|ium)\b/i],['titanium',/\btitanium\b/i],
 ['copper',/\bcopper\b/i],['brass',/\bbrass\b/i],['steel',/\bsteel\b/i],
 ['nylon',/\bnylon\b/i],['rubber',/\brubber\b/i],
 ['carbon fiber',/\bcarbon\s+fi(?:ber|bre)\b/i],['fiber',/\bfi(?:ber|bre)\b/i],
 ['plastic',/\bplastic\b/i],['polymer',/\bpolymer\b/i]
];
const PROCESSES=[
 ['Injection molding',/\binjection[- ](?:mold|mould)(?:ed|ing)?\b/i],
 ['CNC machining',/\bCNC\s+machin(?:e|ed|ing)\b/i],
 ['Machining',/\bmachin(?:e|ed|ing)\b/i],
 ['Casting',/\b(?:sand|investment|die)[- ]cast(?:ing)?\b|\bcast[- ]metal\b/i],
 ['Extrusion',/\bextrud(?:ed|ing)|\bextrusion\b/i],
 ['Welding',/\bweld(?:ed|ing)\b/i],
 ['Laser cutting',/\blaser[- ]cut(?:ting)?\b/i],
 ['Forging',/\bforg(?:ed|ing)\b/i],
 ['Stamping',/\bstamp(?:ed|ing)\b/i],
 ['3D printing',/\b3D[- ]print(?:ed|ing)?\b/i]
];
const COMPONENTS=/(?:\b(?:inner\s+(?:pieces|parts|elements|components)|outer\s+protectors?|tension\s+ropes?|mounting\s+brackets?|hitch\s+bars?|rack\s+arms?|bike\s+trays?|locking\s+mechanisms?|impellers?|shafts?|pump\s+heads?|bearing\s+housings?|housings?|diffusers?|rotors?|stators?|bearings?|bushings?|seals?|gaskets?|o[- ]rings?|motors?|gears?|pulleys?|valves?|sensors?|control\s+boards?|circuit\s+boards?|connectors?|cables?|brackets?|chambers?|rails?|frames?|fasteners?|sleeves?|cartridges?|filters?|guide\s+bars?)\b)/gi;
const CAUTION=/\b(?:could|may|might|potentially|typically|normally|often|generally|possibly|not included|sold separately|compatible with|optional|example|alternatively|hypothetical)\b/i;
const PART_CONTEXT=/\b(?:assembly|component|construction|includes?|consists?|contains?|comprises?|material|parts?|description|made\s+of|made\s+from|manufactured|machined|molded|moulded|cast|extruded|welded|impeller|shaft|housing)\b/i;
const PROCESS_CONTEXT=/\b(?:made|manufactured|fabricated|produced|process|molded|moulded|machined|cast|extruded|welded|stamped|laser[- ]cut|forged|printed)\b/i;
const makeEvidence=(sourceUrl,quote,locator)=>({sourceUrl,quote:norm(quote).slice(0,420),locator,
  method:'linked_primary_technical_document',reviewStatus:'requires_human_verification',
  status:'source_stated_not_independently_verified'});
function tokenMatch(hay,needle){
  const h=key(hay),n=key(needle);if(!h||!n||n.length<4)return false;
  return (' '+h+' ').includes(' '+n+' ');
}
/** Read only documents actually linked from a visited product detail page. */
export function linkedDocumentForProduct({product,productPage,documentPage,documentLink,products=[]}={}){
  if(!product||!productPage||!documentPage||!documentLink)return false;
  const pu=canon(product.sourceUrl),src=canon(productPage.url||productPage.sourceUrl);
  const du=canon(documentPage.url||documentPage.sourceUrl),link=canon(documentLink.documentUrl);
  if(!pu||!src||!du||!link||pu!==src||du!==link||!same(pu,du))return false;
  if(!['completed','partial'].includes(productPage.status)||!['completed','partial'].includes(documentPage.status))return false;
  if(canon(documentLink.productPageUrl)!==pu)return false;
  const anchors=[...(productPage.content?.links||[]),...(productPage.content?.documents||[]).map(url=>({url}))];
  if(!anchors.some(x=>canon(x.url)===du))return false;
  const pdfText=(documentPage.content?.pdfPages||[]).map(x=>String(x.text||'')).join('\n');
  const text=String(documentPage.content?.text||pdfText).slice(0,90000);
  if(text.length<30)return false;
  const title=String(documentPage.content?.title||'');
  const productName=String(product.name||'');
  const sku=String(product.sku||'').trim();
  // The content itself, not just a link label, must identify the model.
  const explicitSku=sku.length>=4&&tokenMatch(text+' '+title,sku);
  const named=tokenMatch(text+' '+title,productName);
  if(!named&&!explicitSku)return false;
  // If the same document matches another sampled product title, it is a
  // multi-model document. Without an explicit SKU anchor, abstain.
  if(!explicitSku&&products.some(p=>p!==product&&p.sourceUrl!==product.sourceUrl&&
     tokenMatch(text+' '+title,String(p.name||''))))return false;
  return true;
}
function getBlocks(doc){
  const out=[];
  for(const p of (doc.content?.pdfPages||[]).slice(0,15)){
    const raw=String(p.text||'').slice(0,18000);
    const parts=raw.split(/(?:\n|(?<=[.!?])\s+|\s*;\s*)/);
    for(const line of parts)if(line.trim().length>=12)out.push({line:line.trim().slice(0,900),locator:'PDF page '+p.page});
  }
  if(!out.length){
    const text=String(doc.content?.text||'').slice(0,90000);
    for(const line of text.split(/(?:\n|(?<=[.!?])\s+|\s*;\s*)/))
      if(line.trim().length>=12)out.push({line:line.trim().slice(0,900),locator:'technical HTML text'});
  }
  for(const t of (doc.content?.tables||[]).slice(0,16)){
    for(const row of (t.rows||[]).slice(0,40)){
      const text=(Array.isArray(row)?row:row.cells||[]).map(norm).join(' | ');
      if(text.length>=8)out.push({line:text.slice(0,900),locator:'technical table row'});
    }
  }
  return out.slice(0,1400);
}
function cleanPart(s){return norm(s).replace(/^(?:stainless\s+steel|cast\s+iron|carbon\s+steel|steel|aluminum|aluminium|polyurethane|polypropylene|polycarbonate|fiber|injection[- ]molded|injection[- ]moulded)\s+/i,'').toLowerCase();}
function groupParts(line){const out=[];for(const m of line.matchAll(COMPONENTS)){
  const name=cleanPart(m[0]);if(name.length<4)continue;
  if(!out.some(x=>x.name===name))out.push({name,index:m.index,length:m[0].length});
}return out.slice(0,12);}
function nearestMatch(terms,line,part,peers,maxDistance=80){
  const found=[];for(const [name,re] of terms){const m=re.exec(line);if(!m)continue;
    const distance=Math.abs(m.index-part.index);
    if(distance>maxDistance)continue;
    if(peers.some(x=>x!==part&&Math.abs(m.index-x.index)<distance))continue;
    found.push({name,distance,index:m.index});
  }
  return found.sort((a,b)=>a.distance-b.distance);
}
function extractBlock(line,loc,docUrl){
  if(CAUTION.test(line)||(!PART_CONTEXT.test(line)&&loc!=='technical table row'))return[];
  const parts=groupParts(line);if(!parts.length)return[];
  return parts.map(part=>{
    const materials=nearestMatch(MATERIALS,line,part,parts,75);
    const processes=PROCESS_CONTEXT.test(line)?nearestMatch(PROCESSES,line,part,parts,65):[];
    // Materials only if explicitly connected to the component via adjective,
    // labeled row or "made of"; no process inference from material alone.
    const materialClaims=materials.filter(m=>{
      const pre=line.slice(Math.max(0,m.index-35),Math.min(line.length,part.index+part.length+70));
      const adjacency=m.index<=part.index&&part.index-m.index<=26;
      const labeled=/\b(?:material|made\s+(?:of|from)|construction)\b/i.test(pre);
      return adjacency||labeled||loc==='technical table row';
    }).slice(0,2).map(m=>({name:m.name,evidence:makeEvidence(docUrl,line,loc),
      status:'source_supported_candidate_requires_review'}));
    const processClaims=processes.filter(m=>{
      if(m.name==='Machining'&&processes.some(x=>x.name==='CNC machining'))return false;
      const between=line.slice(Math.min(m.index,part.index),Math.max(m.index,part.index));
      // Only claim a literal operation adjacent to this part in one clause.
      return between.length<=60&&!/\b(?:and\s+another|whereas|unlike|rather than)\b/i.test(between);
    }).map(m=>({name:m.name,evidence:makeEvidence(docUrl,line,loc),
      status:'published_manufacturing_statement_requires_review',inHouseStatus:'unknown'}));
    return {name:part.name,quote:norm(line).slice(0,420),loc,materialClaims,processClaims};
  });
}
function addClaims(entry,doc,candidates){
  for(const cand of candidates){
    if(entry.parts.length>=70)break;
    let part=entry.parts.find(x=>key(x.name)===key(cand.name));
    if(!part){part={id:'part:'+hash(entry.sourceUrl+'|'+key(cand.name)),
      name:cand.name,sourceUrl:entry.sourceUrl,relationship:'source_mentioned_part_requires_review',
      isVerifiedBom:false,isCompanyCapability:false,observations:[],materialClaims:[],processClaims:[]};entry.parts.push(part);}
    const ev=makeEvidence(doc.url||doc.sourceUrl,cand.quote,cand.loc);
    if(!part.observations.some(x=>x.sourceUrl===ev.sourceUrl&&key(x.quote)===key(ev.quote)))part.observations.push(ev);
    for(const m of cand.materialClaims)if(!part.materialClaims.some(x=>x.name===m.name&&x.evidence.sourceUrl===m.evidence.sourceUrl))part.materialClaims.push(m);
    for(const p of cand.processClaims)if(!part.processClaims.some(x=>x.name===p.name&&x.evidence.sourceUrl===p.evidence.sourceUrl))part.processClaims.push(p);
  }
}
/** Add source-linked document facts while preserving each original observation. */
export function enrichPartEvidenceV3({companyName,companyUrl,products=[],pages=[],documentLinks=[],d1Record=null}={}){
  const base=buildPartEvidenceReport({companyName,companyUrl,products,pages,d1Record,maxProducts:60});
  const documentIndex=new Map(pages.filter(p=>['completed','partial'].includes(p.status))
    .filter(p=>same(companyUrl,p.url||p.sourceUrl)).map(p=>[canon(p.url||p.sourceUrl),p]));
  let inspected=0,accepted=0,skipped=0,sourceClaims=0;
  for(const entry of base.products){
    const product=products.find(p=>canon(p.sourceUrl)===canon(entry.sourceUrl)&&p.name===entry.name);
    if(!product)continue;
    const productPage=documentIndex.get(canon(entry.sourceUrl));
    // Structured product-page rows can identify part materials even when
    // generic text flattening loses their column relationships.
    if(productPage&&Array.isArray(productPage.content?.tables)&&
       productPage.content.tables.length&&
       tokenMatch(String(productPage.content?.headings?.[0]||productPage.content?.title||''),product.name)){
      const tableClaims=getBlocks({...productPage,content:{...productPage.content,
        text:'',pdfPages:[]}}).filter(x=>x.locator==='technical table row')
        .flatMap(({line,locator})=>extractBlock(line,locator,productPage.url||productPage.sourceUrl))
        .slice(0,100);
      addClaims(entry,productPage,tableClaims);
    }
    for(const link of documentLinks.filter(l=>canon(l.productPageUrl)===canon(entry.sourceUrl)).slice(0,12)){
      inspected++;
      const doc=documentIndex.get(canon(link.documentUrl));
      if(!linkedDocumentForProduct({product,productPage,documentPage:doc,documentLink:link,products})){
        skipped++;continue;
      }
      accepted++;
      const rows=getBlocks(doc);
      const claims=rows.flatMap(({line,locator})=>extractBlock(line,locator,doc.url||doc.sourceUrl)).slice(0,120);
      sourceClaims+=claims.length;
      addClaims(entry,doc,claims);
    }
    entry.missingEvidence=entry.parts.length?'part_material_process_coverage_partial':'no_source_supported_integral_parts';
  }
  base.schemaVersion='pi-part-evidence/v3';
  base.counts.partEvidenceCandidates=base.products.reduce((n,p)=>n+p.parts.length,0);
  base.counts.partMaterialCandidates=base.products.reduce((n,p)=>n+p.parts.reduce((s,x)=>s+x.materialClaims.length,0),0);
  base.counts.partProcessCandidates=base.products.reduce((n,p)=>n+p.parts.reduce((s,x)=>s+x.processClaims.length,0),0);
  base.v3={linkedDocumentsInspected:inspected,linkedDocumentsAccepted:accepted,
    linkedDocumentsRejected:skipped,linkedDocumentPartObservations:sourceClaims,
    sourceRule:'same_company_host + direct_product_page_link + document_model_mention',
    reviewStatus:'all_candidate_claims_require_review'};
  base.limitations.push('Document links are never evidence without a direct product-page link and document-side model match.');
  return base;
}
/** Keep the frozen V2 extractor unchanged; split 50-page V3 runs into chunks. */
export function extractProductIntelligenceV3({companyName,rootUrl,pages=[]}={}){
  if(!Array.isArray(pages)||pages.length>50)throw Error('V3 supports at most 50 source pages');
  if(pages.length<=30)return extractProductIntelligence({companyName,rootUrl,pages});
  const results=[];
  for(let i=0;i<pages.length;i+=30)results.push(extractProductIntelligence({companyName,rootUrl,pages:pages.slice(i,i+30)}));
  const base=results[0],prods=new Map(),cats=new Map(),leads=new Map();
  for(const r of results){
    for(const p of r.products)if(!prods.has(p.id))prods.set(p.id,p);
    for(const c of r.categories)if(!cats.has(c.id))cats.set(c.id,c);
    for(const l of r.productLeads)if(!leads.has(l.sourceUrl))leads.set(l.sourceUrl,l);
  }
  const products=[...prods.values()].slice(0,120),categories=[...cats.values()].slice(0,60);
  const families=new Map();
  for(const p of products){const k=productFamilyKey(p.name);if(!families.has(k))families.set(k,{name:p.name,productSkuCandidates:0,
    reviewStatus:'unreviewed_name_grouping_not_approved_product_family'});families.get(k).productSkuCandidates++;}
  const productFamilies=[...families.values()].slice(0,100);
  return {...base,products,categories,productLeads:[...leads.values()].slice(0,100),productFamilies,
    schemaVersion:'pi-product-intelligence/v3-wrapper',coverage:{...base.coverage,
      pagesSubmitted:pages.length,pagesUnique:results.reduce((n,x)=>n+x.coverage.pagesUnique,0),
      pagesUsable:results.reduce((n,x)=>n+x.coverage.pagesUsable,0),
      productPages:results.reduce((n,x)=>n+x.coverage.productPages,0),
      categoryPages:results.reduce((n,x)=>n+x.coverage.categoryPages,0),
      products:products.length,categories:categories.length,
      skuNamedProductCandidates:products.filter(x=>x.sku).length,
      productsWithSpecifications:products.filter(x=>x.specifications?.length).length,
      productsWithComponents:products.filter(x=>x.components?.length).length,
      productsWithMaterials:products.filter(x=>x.materials?.length).length,
      distinctProductFamilyLabels:productFamilies.length,
      specifications:products.reduce((n,x)=>n+(x.specifications||[]).length,0),
      components:products.reduce((n,x)=>n+(x.components||[]).length,0),
      materials:products.reduce((n,x)=>n+(x.materials||[]).length,0)}
  };
}