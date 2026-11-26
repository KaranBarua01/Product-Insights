/**
 * Product Intelligence Extractor v1: bounded, deterministic and evidence-first.
 * No AI, no taxonomy writes and no manufacturing-process inference.
 *
 * Input: per-page outputs from existing Scrappers extract() + runResearch().
 * Facts remain candidate_requires_review, even when the website states them.
 */
import {createHash} from 'node:crypto';
import {extractStructuredProducts} from './research-planner.mjs';
import {identifyCompanyRole} from './research-intelligence.mjs';
import {catalogCardLeads,pageSignals,classifyLeadUrl} from './adaptive-research-v2.mjs';

export const PRODUCT_INTELLIGENCE_SCHEMA='pi-product-intelligence/v1';
const MAX_PAGES=30,MAX_TEXT=85_000,MAX_PRODUCTS=120;
const GENERIC=/^(?:home|homepage|about|products?|all products|shop|shop now|catalog|catalogue|categories?|collections?|services?|about us|description|overview|specifications?|details|videos?|related products?|featured|new arrivals|bargain garage|support|gift cards?|company history)$/i;
const BLOCKED_PATH=/(?:companyhistory|giftcards?|privacy|terms|warrant(?:y|ies)|return-policy|shipping-policy|catalog\/browse|\/about|\/help|\/faqs?|\/service|\/contact|\/login|\/account|\/cart)(?:[./_-]|\/|$)/i;
const CATEGORY_PATH=/(?:^|\/)(?:product-?categor(?:y|ies)|categories?|collections?|product-families?)(?:\/|$)/i;
const DETAIL_PATH=/(?:^|\/)(?:products?|items?|models?|shop)\/[^/?]+\/?$/i;
const CATALOG_DETAIL=/(?:^|\/)catalog\/(?:[^/]+\/){1,4}[^/]+\.(?:php|html?)$/i;
const TECHNICAL_UNIT=/\b\d+(?:[.,]\d+)?\s?(?:lbs?|kg|grams?|mm|cm|ft|inch(?:es)?|in\b|V\b|VAC\b|VDC\b|W\b|kW\b|A\b|amps?\b|Ah\b|psi\b|bar\b|kPa\b|MPa\b|rpm\b|Hz\b|kWh\b|°F\b|°C\b|gpm\b|lpm\b|oz\b|gal(?:lons?)?\b|L\b|mAh\b)/i;
const FIELDS=[
  ['electrical_connection',/\belectrical connection\b/i],
  ['energy_consumption',/\benergy consumption\b/i],
  ['weight_capacity',/\b(?:weight|load|carrying) capacity\b/i],
  ['voltage_range',/\bvoltage range\b/i],
  ['control_setpoint_range',/\bcontrol setpoint range\b/i],
  ['refrigerant',/\brefrigerant\b/i],
  ['pressure',/\b(?:operating pressure|working pressure|pressure rating|pressure)\b/i],
  ['flow_rate',/\bflow rate\b/i],
  ['amperage',/\b(?:amperage|current rating)\b/i],
  ['power',/\b(?:power consumption|power rating|power)\b/i],
  ['voltage',/\b(?:rated voltage|input voltage|voltage)\b/i],
  ['torque',/\btorque\b/i],
  ['speed',/\b(?:speed|rpm)\b/i],
  ['dimensions',/\b(?:overall dimensions|dimensions)\b/i],
  ['weight',/\b(?:unit weight|shipping weight|weight)\b/i],
  ['capacity',/\bcapacity\b/i]
];
// The only material mentions promoted are explicit product material statements.
const MATERIALS=/\b(?:stainless steel|carbon fiber|alumin(?:ium|um)|polycarbonate|polypropylene|polyethylene|fiberglass|titanium|concrete|brass|copper|steel|nylon|rubber|plastic|wood|ABS)\b/ig;
const MATERIAL_STATEMENT=/(?:\b(?:made\s+(?:entirely\s+)?(?:out\s+of|from)|constructed\s+(?:from|of|with)|fabricated\s+from|manufactured\s+from|built\s+(?:from|with))\b|\bmaterials?\s*[:\-]\s*)/i;
const COMPONENT_STATEMENT=/\b(?:includes?|contains?|consists?\s+of|equipped\s+with|comes\s+with|features?)\b/i;
const COMPONENTS=/\b(?:mounting brackets?|brackets?|cartridges?|filters?|frames?|trays?|arms?|motors?|compressors?|controllers?|sensors?|batter(?:y|ies)|connectors?|cables?|housings?|valves?|hoses?|fans?|wheels?|casters?|receivers?|transmitters?|displays?|probes?)\b/ig;
const RELATION_REJECT=/\b(?:optional(?:ly)?|sold separately|not included|compatible with|available separately)\b/i;
function norm(s){return String(s||'').replace(/\s+/g,' ').trim();}
function lower(s){return norm(s).toLocaleLowerCase('en-US');}
function digest(s){return createHash('sha256').update(s).digest('hex').slice(0,16);}
/** Reporting-only lexical family grouping: never merges actual SKU identities. */
export function productFamilyKey(name){
 return lower(name).replace(/\s*\(([a-z0-9][a-z0-9._/-]{4,})\)\s*$/i,'').trim();
}
function sameHost(url,host){try{const u=new URL(url);return ['https:','http:'].includes(u.protocol)&&u.hostname.toLowerCase()===host;}catch{return false;}}
export function canonicalPageUrl(raw){
  try{const u=new URL(raw);if(!['http:','https:'].includes(u.protocol)||u.username||u.password)return null;
    u.hash='';for(const k of [...u.searchParams.keys()])if(/^(?:utm_.*|gclid|fbclid|mc_cid|mc_eid)$/i.test(k))u.searchParams.delete(k);
    if(u.pathname.length>1)u.pathname=u.pathname.replace(/\/+$/,'');
    return u.href;
  }catch{return null;}
}
export function classifyIntelligencePage(raw,strategy='S01',content=null){
  let p;try{p=new URL(raw).pathname;}catch{return 'other';}
  if(strategy==='S03'||/\.pdf$/i.test(p))return 'document';
  if(/^(?:\/|\/about(?:-us)?\/?|\/our-story\/?|\/who-we-are\/?)$/i.test(p))return 'company';
  if(BLOCKED_PATH.test(p))return 'other';
  const reference=classifyLeadUrl(raw);
  if(DETAIL_PATH.test(p)||CATALOG_DETAIL.test(p)||reference==='product')return 'product';
  if(CATEGORY_PATH.test(p)||reference==='catalog')return 'category';
  if(/\/(?:manufacturing|capabilities|services)(?:\/|$)/i.test(p))return 'capability';
  // Non-standard product URLs are eligible only with direct technical evidence
  // AND a concrete model-like title. Do not promote generic marketing pages.
  if(content&&p.split('/').filter(Boolean).length>=2){
    const signal=pageSignals({url:raw,content});
    const heading=String(content.headings?.[0]||content.title||'');
    if(signal.specs>=2&&/\b(?:[a-z]{1,6}[- ]?\d{2,6}|\d{4,}|model|sku|part number)\b/i.test(heading))
      return 'product';
    if(signal.role==='catalog'&&signal.catalogLinks>=3)return 'category';
  }
  return 'other';
}
function validName(raw){
  const v=norm(raw).replace(/\s+(?:\||—|–)\s+[^|—–]{2,100}$/,'').trim();
  if(v.length<3||v.length>165||GENERIC.test(v)||/^(?:results?\s+for|skip to content|learn more)/i.test(v))return null;
  if(v.split(/\s+/).length>20)return null;
  return v;
}
function primaryHeading(content){
  for(const x of [...(content.headings||[]),content.title]){
    const v=validName(x);if(v)return v;
  }
  return null;
}
function evidence(sourceUrl,quote,locator,method='visible_text'){
  const q=String(quote||'').trim().slice(0,240);
  return {sourceUrl,quote:q,locator,method,reviewStatus:'requires_human_verification'};
}
function textLines(content){
  const text=String(content.text||'').slice(0,MAX_TEXT);
  return text.split(/\r?\n/).map(x=>x.trim()).filter(x=>x.length>=7&&x.length<=600).slice(0,900);
}
function specSignals(lines,sourceUrl){
  const found=[],seen=new Set();
  const insert=(field,value,line,method='explicit_labeled_value')=>{
    const v=norm(value).slice(0,130);
    if(!v||v.length>130)return;
    const key=field+'|'+lower(v);
    if(seen.has(key))return;seen.add(key);
    const units=/\b(?:lbs?|kg|mm|cm|ft|in|V|VAC|VDC|W|kW|A|amps?|psi|bar|rpm|Hz|kWh|°F|°C|gpm|lpm|oz)\b/i.exec(v);
    found.push({attribute:field,value:v,unit:units?.[0]||null,
      evidence:evidence(sourceUrl,line.slice(0,240),'primary page text',method)});
  };
  for(const line of lines){
    // Deliberately only parse explicit, colon-labeled fields and direct capacity statements.
    const matcher=/(?:^|[,;]\s*)([a-z][a-z /-]{1,44})\s*:\s*([^,;\n]{1,145})/gi;
    for(const m of line.matchAll(matcher)){
      const name=norm(m[1]),value=m[2].trim();
      const match=FIELDS.find(([,re])=>re.test(name));
      if(match&&value.length<=125&&(!/^(?:N\/A|none|unknown)$/i.test(value))&&
        (TECHNICAL_UNIT.test(value)||/^(?:R\d{3,4}|stainless steel|aluminum|electric|gas)\b/i.test(value)))
        insert(match[0],value,line.slice(Math.max(0,m.index-12),Math.min(line.length,m.index+m[0].length+35)));
      if(found.length>=35)break;
    }
    // Labeled product load in prose. Never convert into an engineering rating.
    if(/\b(?:weight capacity|load capacity|load limit|e-bikes? up to)\b/i.test(line)){
      const m=/(?:up to|capacity(?: of)?|limit(?: of)?)\s*(\d+(?:\.\d+)?\s*(?:lbs?|kg))\b/i.exec(line);
      if(m)insert('stated_load_limit',m[1],line.slice(Math.max(0,m.index-110),Math.min(line.length,m.index+m[0].length+65)),'product_copy_capacity');
    }
    if(found.length>=35)break;
  }
  return found;
}
function materialSignals(lines,sourceUrl){
  const found=[],seen=new Set();
  for(const line of lines){
    const materialTrigger=MATERIAL_STATEMENT.exec(line);
    if(!materialTrigger)continue;
    // Negative/product-comparison copy is not proof of physical composition.
    if(/\b(?:not made|isn't made|without|avoid|compared with|instead of)\b/i.test(line))continue;
    MATERIALS.lastIndex=0;
    for(const match of line.matchAll(MATERIALS)){
      const value=norm(match[0]).toLowerCase();
      if(match.index<materialTrigger.index||match.index-materialTrigger.index>150)continue;
      if(seen.has(value))continue;
      seen.add(value);found.push({material:value,
        relationship:'published_product_material_claim',
        evidence:evidence(sourceUrl,line.slice(Math.max(0,materialTrigger.index-35),Math.min(line.length,match.index+match[0].length+55)),'primary page text')});
      if(found.length>=10)break;
    }
    if(found.length>=10)break;
  }
  return found;
}
function componentSignals(lines,sourceUrl){
  const found=[],seen=new Set();
  for(const line of lines){
    const s=COMPONENT_STATEMENT.exec(line);if(!s)continue;
    const clause=line.slice(s.index+s[0].length,s.index+s[0].length+120).split(/[.;]/)[0];
    if(RELATION_REJECT.test(clause))continue;
    COMPONENTS.lastIndex=0;
    for(const match of clause.matchAll(COMPONENTS)){
      const part=norm(match[0]).toLowerCase();
      if(seen.has(part))continue;
      seen.add(part);found.push({component:part,relationship:'published_inclusion_claim',
        evidence:evidence(sourceUrl,line.slice(Math.max(0,s.index-25),Math.min(line.length,s.index+s[0].length+145)),'primary page text')});
      if(found.length>=10)break;
    }
    if(found.length>=10)break;
  }
  return found;
}
function categoryFromPage(page){
  const name=primaryHeading(page.content);if(!name)return null;
  const url=canonicalPageUrl(page.url);
  if(!url)return null;
  return {id:digest('category|'+url),name,sourceUrl:url,
    evidence:evidence(url,(page.content.headings||[]).find(x=>norm(x)===name)||name,'category page heading','page_heading'),
    reviewStatus:'candidate_requires_review'};
}
function linkedCategoryUrls(page,host){
  const map=new Map();
  if(classifyIntelligencePage(page.url,page.strategy)!=='category')return map;
  for(const link of (page.content.links||[]).slice(0,160)){
    if(!sameHost(link.url,host))continue;
    const target=canonicalPageUrl(link.url);if(!target)continue;
    if(classifyIntelligencePage(target)==='product')map.set(target,true);
  }
  return map;
}
export function extractPageIntelligence(page,host){
  const url=canonicalPageUrl(page?.url||page?.sourceUrl),status=page?.status;
  if(!url||!sameHost(url,host)||!['completed','partial'].includes(status))
    return {status:'ignored',url,kind:'other',categories:[],products:[]};
  const content=page?.content||{},kind=classifyIntelligencePage(url,page.strategy,content);
  const categories=kind==='category'?[categoryFromPage({url,content})].filter(Boolean):[];
  // Product-card links from a category page are navigation leads, NOT confirmed
  // products. Only visited detail pages or published Product JSON-LD create IDs.
  const cardLeads=kind==='category'?catalogCardLeads({url,sourceUrl:url,content},host,{max:20}):[];
  const products=[];
  const structured=extractStructuredProducts(content.jsonLd||[],url);
  for(const meta of structured.slice(0,16)){
    const name=validName(meta.name);
    if(!name)continue;
    const sku=meta.sku?norm(meta.sku).slice(0,90):null;
    products.push({id:digest('product|'+url+'|'+lower(name)+'|'+lower(sku)),
      name,sku,sourceUrl:url,extractionMethod:'published_jsonld',
      evidence:[evidence(url,meta.name,'script[type="application/ld+json"]','jsonld_product_name')],
      specifications:[],components:[],materials:[],
      categoryIds:[],reviewStatus:'candidate_requires_review'});
  }
  const proposedName=kind==='product'?primaryHeading(content):null;
  const q=page.acquisitionQuality;
  const name=proposedName&&(!q||q.productIdentities?.some(p=>lower(p.name)===lower(proposedName)))?proposedName:null;
  if(name){
    const match=products.find(p=>lower(p.name)===lower(name));
    if(!match){
      products.push({id:digest('product|'+url+'|'+lower(name)),name,sku:null,sourceUrl:url,
        extractionMethod:'product_page_heading',
        evidence:[evidence(url,(content.headings||[]).find(x=>norm(x)===name)||name,'product page heading','page_heading')],
        specifications:[],components:[],materials:[],categoryIds:[],
        reviewStatus:'candidate_requires_review'});
    }
    // Only assign attributes to a clearly identified primary product. Never
    // transfer specs from a category listing or from a different vendor's item.
    const primary=products.find(p=>lower(p.name)===lower(name)||
      lower(p.name).startsWith(lower(name)+' '));
    if(primary){
      const lines=textLines(content);
      primary.specifications=specSignals(lines,url);
      primary.materials=materialSignals(lines,url);
      primary.components=componentSignals(lines,url);
    }
  }
  return {status:'sampled',url,kind,categories,products,cardLeads,
    categoryToProductLinks:linkedCategoryUrls({url,content,strategy:page.strategy},host),
    sourceEvidenceCount:Array.isArray(page?.evidence)?page.evidence.length:0};
}
export function extractProductIntelligence({companyName,rootUrl,pages=[]}={}){
  if(!companyName||typeof companyName!=='string'||companyName.length>160)throw Error('Company name required');
  const root=canonicalPageUrl(rootUrl),host=root?new URL(root).hostname.toLowerCase():null;
  if(!root||!host)throw Error('Valid company website required');
  if(!Array.isArray(pages)||pages.length>MAX_PAGES)throw Error('Product extraction requires at most '+MAX_PAGES+' source pages');
  const used=new Set(),results=[];
  for(const raw of pages){
    const url=canonicalPageUrl(raw?.url||raw?.sourceUrl);
    if(!url||!sameHost(url,host)||used.has(url))continue;
    used.add(url);
    results.push(extractPageIntelligence({...raw,url},host));
  }
  const categoryMap=new Map(),productMap=new Map(),categoryRelations=new Map(),leadMap=new Map();
  for(const r of results){
    for(const c of r.categories||[])if(!categoryMap.has(c.id))categoryMap.set(c.id,c);
    if(r.categories?.length)for(const u of r.categoryToProductLinks?.keys()||[]){
      if(!categoryRelations.has(u))categoryRelations.set(u,new Set());
      for(const c of r.categories)categoryRelations.get(u).add(c.id);
    }
    for(const lead of r.cardLeads||[]){
      if(!leadMap.has(lead.sourceUrl)&&leadMap.size<150){
        leadMap.set(lead.sourceUrl,{name:lead.name,sourceUrl:lead.sourceUrl,
          sourcePageUrl:lead.sourcePageUrl,
          evidence:evidence(lead.sourcePageUrl,lead.evidenceQuote,
            'source catalog link','unverified_catalog_link'),
          reviewStatus:'link_candidate_requires_detail_evidence'});
      }
    }
    for(const p of r.products||[]){
      if(productMap.size>=MAX_PRODUCTS)break;
      const old=productMap.get(p.id);
      if(!old)productMap.set(p.id,p);
      else for(const e of p.evidence)if(!old.evidence.some(x=>x.quote===e.quote&&x.sourceUrl===e.sourceUrl))old.evidence.push(e);
    }
  }
  const categories=[...categoryMap.values()].slice(0,40);
  const detailUrls=new Set([...productMap.values()].map(x=>canonicalPageUrl(x.sourceUrl)));
  const productLeads=[...leadMap.values()].filter(x=>!detailUrls.has(canonicalPageUrl(x.sourceUrl)))
    .slice(0,80);
  const products=[...productMap.values()].slice(0,MAX_PRODUCTS).map(p=>{
    const categoryIds=[...(categoryRelations.get(p.sourceUrl)||[])].filter(id=>categoryMap.has(id)).slice(0,4);
    return {...p,categoryIds,categoryLinkStatus:categoryIds.length?'linked_from_category_page_unverified':'unresolved',
      companyProductRole:'manufactured_vs_sold_not_determined'};
  });
  const familyIndex=new Map();
  for(const p of products){
    const key=productFamilyKey(p.name);
    if(!familyIndex.has(key))familyIndex.set(key,{name:p.name.replace(/\s*\([A-Z0-9][A-Z0-9._/-]{4,}\)\s*$/i,'').trim(),
      productSkuCandidates:0});
    familyIndex.get(key).productSkuCandidates++;
  }
  const productFamilies=[...familyIndex.values()].slice(0,80)
    .map(p=>({...p,reviewStatus:'unreviewed_name_grouping_not_approved_product_family'}));
  const identityPages=pages.filter(x=>['completed','partial'].includes(x.status)&&sameHost(x.url||x.sourceUrl,host))
    .map(p=>({url:p.url||p.sourceUrl,status:p.status,title:p.content?.title||'',
      aiText:String(p.content?.text||'').slice(0,5500)}));
  const companyRole=identifyCompanyRole(identityPages,root);
  return {schemaVersion:PRODUCT_INTELLIGENCE_SCHEMA,
    company:{name:companyName,website:root,roleCandidate:companyRole},
    status:products.length||categories.length?'candidate_records_requires_review':
      productLeads.length?'catalog_links_need_product_detail_evidence':'insufficient_product_evidence',
    coverage:{pagesSubmitted:pages.length,pagesUnique:results.length,pagesUsable:results.filter(x=>x.status==='sampled').length,
      productPages:results.filter(x=>x.kind==='product'&&x.status==='sampled').length,
      categoryPages:results.filter(x=>x.kind==='category'&&x.status==='sampled').length,
      products:products.length,categories:categories.length,
      distinctProductFamilyLabels:productFamilies.length,
      skuNamedProductCandidates:products.filter(x=>!!x.sku).length,
      productsWithSpecifications:products.filter(x=>x.specifications.length).length,
      productsWithComponents:products.filter(x=>x.components.length).length,
      productsWithMaterials:products.filter(x=>x.materials.length).length,
      specifications:products.reduce((n,p)=>n+p.specifications.length,0),
      components:products.reduce((n,p)=>n+p.components.length,0),
      materials:products.reduce((n,p)=>n+p.materials.length,0),
      catalogLinkCandidates:productLeads.length,
      unlinkedProducts:products.filter(x=>!x.categoryIds.length).length},
    categories,products,productLeads,productFamilies,
    limitations:[
      'Site claims are not independently verified; every product and attribute requires human review.',
      'Product links extracted from catalog cards are separate navigation candidates until their details or Product JSON-LD are retrieved.',
      'Product-category relationships exist only when observed directly in an extracted category page.',
      'Manufactured-versus-sold is not inferred from website product listings, specifications or materials.',
      'Absent components or materials means not evidenced, not that none exist.',
      'No manufacturing process, buyer RFQ, supplier qualification or taxonomy accuracy is inferred.'
    ]};
}
