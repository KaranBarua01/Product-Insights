/**
 * Product Insights: source-grounded part/material/process evidence verifier.
 * D1 is an unverified COMPANY-level research prior and is never propagated to
 * product/part facts. This module does not fetch, write or call AI.
 */
import {createHash} from 'node:crypto';

export const PART_EVIDENCE_SCHEMA='pi-part-evidence/v1';
const clean=(x,max=260)=>String(x??'').replace(/\s+/g,' ').trim().slice(0,max);
const key=x=>clean(x,300).toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const hash=x=>createHash('sha256').update(x).digest('hex').slice(0,16);
function urlKey(raw){
  try {const u=new URL(raw);if(!['https:','http:'].includes(u.protocol)||u.username||u.password)return null;
    u.hash='';for(const p of [...u.searchParams.keys()])if(/^utm_|^(?:ref|fbclid|gclid)$/i.test(p))u.searchParams.delete(p);
    if(u.pathname.length>1)u.pathname=u.pathname.replace(/\/+$/,'');return u.href;
  }catch{return null;}
}
function domain(raw){
  try{let u=raw.includes('://')?new URL(raw):new URL('https://'+raw);return u.hostname.toLowerCase().replace(/^www\./,'');}
  catch{return null;}
}
const categoryPath=/(?:^|\/)(?:product-?categor(?:y|ies)|categories|collections|all-products|search|shop-all)(?:\/|$)/i;
function isProductDetail(raw){
  try{const path=new URL(raw).pathname;return !categoryPath.test(path)&&!/(?:^|\/)(?:blog|news|about|privacy|support)(?:\/|$)/i.test(path);}
  catch{return false;}
}
const PARTS=[
  /\b(?:injection[- ]molded\s+)?inner\s+(?:pieces?|parts?|elements?|components?|structure)\b/gi,
  /\b(?:polyurethane\s+)?(?:outer\s+)?protectors?\b/gi,
  /\b(?:fiber\s+)?(?:tension\s+)?ropes?\b/gi,
  /\b(?:steel\s+)?mounting\s+brackets?\b/gi,
  /\b(?:hitch\s+)?(?:bars?|receivers?)\b/gi,
  /\b(?:rack\s+)?arms?\b/gi,
  /\b(?:loading\s+)?trays?\b/gi,
  /\b(?:locking\s+)?mechanisms?\b/gi,
  /\b(?:impellers?|shafts?|pump\s+heads?|chambers?|housings?|rotors?|stators?|bearings?|bushings?|seals?|o-rings?|gaskets?|motors?|gears?|pulleys?|valves?|sensors?|control\s+boards?|circuit\s+boards?|printed\s+circuit\s+boards?|mounting\s+plates?|fasteners?|cables?|connectors?|chain\s+links?)\b/gi
];
const MAT=/(?:\bstainless\s+steel\b|\bcarbon\s+steel\b|\bcast\s+iron\b|\bpolyurethane\b|\bpolypropylene\b|\bpolycarbonate\b|\bpolyethylene\b|\bengineering\s+plastics?\b|\bengineered\s+polymers?\b|\balumin(?:um|ium)\b|\bsteel\b|\bcopper\b|\bbrass\b|\btitanium\b|\brubber\b|\bnylon\b|\bplastic\b|\bfiber(?:glass)?\b)/gi;
const PROCESSES=[
 {name:'Injection molding',re:/\binjection[- ]mold(?:ed|ing)?\b|\binjection[- ]mould(?:ed|ing)?\b/i},
 {name:'CNC machining',re:/\b(?:CNC[- ]machined?|CNC[- ]machining)\b/i},
 {name:'Machining',re:/\b(?:machined|machining)\b/i},
 {name:'Casting',re:/\b(?:sand[- ]cast(?:ing)?|investment[- ]cast(?:ing)?|die[- ]cast(?:ing)?|cast[- ]metal)\b/i},
 {name:'Extrusion',re:/\bextrud(?:ed|ing|e|sion)\b/i},
 {name:'Laser cutting',re:/\blaser[- ]cut(?:ting)?\b/i},
 {name:'Welding',re:/\bweld(?:ed|ing)\b/i},
 {name:'Stamping',re:/\bstamp(?:ed|ing)\b/i},
 {name:'Forging',re:/\bforg(?:ed|ing)\b/i},
 {name:'Additive manufacturing',re:/\b(?:3D[- ]print(?:ed|ing)?|additive[- ]manufactur(?:ed|ing))\b/i}
];
const HYPOTHETICAL=/(?:\b(?:could|may|might|potentially|typically|normally|often|generally|possibly|probably|hypothetically)\b|\bfor example\b)/i;
const NEGATED=/(?:\b(?:not|without|instead of|no)\s+(?:injection|molded|made|machined|welded|cast|included)\b)/i;
const ACCESSORY=/(?:\b(?:optional|sold separately|compatible with|not included|accessories|spare parts|replacement parts|add-ons?)\b)/i;
const PART_RELATION=/(?:\b(?:includes?|contains?|consists of|features?|equipped with|comprised of|comprises|has|built with|made with|constructed with)\b|\b(?:molded|moulded|machined|welded|cast|extruded)\b)/i;
const words=s=>String(s??'').slice(0,100000).split(/(?<=[.!?])\s+|[\r\n]+/).map(x=>x.trim()).filter(x=>x.length>=16&&x.length<=900);
const unique=(a)=>[...new Set(a)];
const csv=x=>unique(clean(x,8000).split(/[,;]+/).map(x=>clean(x,120)).filter(Boolean)).slice(0,50);
const contains=(text,quote)=>String(text||'').toLowerCase().replace(/\s+/g,' ').includes(String(quote||'').toLowerCase().replace(/\s+/g,' '));
function primaryMatches(p,page){
  const name=key(p.name);const first=key(page?.content?.headings?.[0]||page?.content?.title||'');
  if(!first||!name)return false;
  if(first===name||first.startsWith(name+' ')||name.startsWith(first+' '))return true;
  // Do not attach a SKU's neighboring product text to the wrong model.
  const tokens=name.split(' ').filter(x=>x.length>=4);
  return tokens.length>=2&&tokens.every(x=>first.split(' ').includes(x));
}
function evidence(url,quote,relation){return {sourceUrl:url,quote:clean(quote,400),method:'primary_product_page_text',relation,reviewStatus:'requires_human_verification'};}
function matchParts(sentence){
  const matches=[];
  for(const re of PARTS){re.lastIndex=0;for(const m of sentence.matchAll(re)){let n=clean(m[0],100);
    if(n.length>=4&&!matches.some(x=>key(x.name)===key(n)))matches.push({name:n,index:m.index});
  }}return matches.slice(0,12);
}
function nearestMaterial(sentence,part){
  MAT.lastIndex=0;
  const candidates=[...sentence.matchAll(MAT)].filter(x=>Math.abs(x.index-part.index)<=90)
    .sort((a,b)=>Math.abs(a.index-part.index)-Math.abs(b.index-part.index));
  for(const m of candidates){
    if(key(part.name).startsWith(key(m[0])+' '))return clean(m[0],100);
    const between=m.index<part.index?
      sentence.slice(m.index+m[0].length,part.index):
      sentence.slice(part.index+part.name.length,m.index);
    // Direct adjective/noun phrase, or explicit "part made from material".
    if(m.index<part.index&&/^(?:\s+[a-z-]{1,18}){0,2}\s*$/i.test(between))return clean(m[0],100);
    if(m.index>=part.index&&/^\s*(?:is\s+)?(?:made|manufactured|constructed)\s+(?:of|from)\s*$/i.test(between))
      return clean(m[0],100);
  }
  return null;
}
function observedProcess(sentence,part,allParts=[]){
  if(HYPOTHETICAL.test(sentence)||NEGATED.test(sentence))return [];
  return PROCESSES.filter(x=>x.re.test(sentence)&&PART_RELATION.test(sentence))
    .filter(x=>{
      const m=sentence.match(x.re);if(!m||Math.abs(m.index-part.index)>120)return false;
      // A process in a sentence mentioning multiple parts belongs only to
      // its nearest part. Never assign a shaft's machining to a housing.
      const distance=Math.abs(m.index-part.index);
      return !allParts.some(other=>other!==part&&Math.abs(m.index-other.index)<=distance);
    }).map(x=>x.name).filter(x=>x!=='Machining'||!PROCESSES[1].re.test(sentence));
}
/** Returns company-level D1 priors; NEVER a fact about a particular product/part. */
export function normalizeD1Context(companyUrl,record){
  const host=domain(companyUrl);if(!record||!host||domain(record.website)!==host)return null;
  return {source:'Cloudflare_D1_company_commodity_dictionary',host,
    manufacturingRole:clean(record.manufacturing_role,90)||'unknown',
    buyerSupplierClass:clean(record.buyer_supplier_classification,100)||'unknown',
    preExistingConfidenceLabel:clean(record.evidence_confidence,60)||'unspecified',
    productFamilyHypotheses:csv(record.what_they_make),
    processHypotheses:csv(record.commodity),materialHypotheses:csv(record.materials_required),
    status:'unverified_company_level_priors_not_part_facts'};
}
export function buildPartEvidenceReport({companyName,companyUrl,products=[],pages=[],d1Record=null,maxProducts=50}={}){
  const root=domain(companyUrl);if(!root)throw Error('Company URL is required');
  if(!Array.isArray(products)||!Array.isArray(pages))throw Error('products/pages must be arrays');
  const d1=normalizeD1Context(companyUrl,d1Record);
  const rawPageMap=new Map();
  for(const page of pages.slice(0,80)){
    const url=urlKey(page?.sourceUrl||page?.url);
    if(!url||domain(url)!==root||!['completed','partial'].includes(page.status))continue;
    const raw=String(page?.content?.text||'').slice(0,100000);
    if(raw)rawPageMap.set(url,{...page,sourceUrl:url,text:raw});
  }
  const seenProducts=new Set(),out=[];
  const totals={productsExamined:0,productsWithRawPage:0,partEvidenceCandidates:0,
    partMaterialCandidates:0,partProcessCandidates:0,productMaterialCandidates:0,
    uncorroboratedScraperPartMentions:0};
  for(const p of products.slice(0,Math.max(1,Math.min(60,maxProducts)))){
    const url=urlKey(p?.sourceUrl),name=clean(p?.name,140);
    if(!url||domain(url)!==root||!name||!isProductDetail(url))continue;
    const productId=key(name)+'|'+url;if(seenProducts.has(productId))continue;seenProducts.add(productId);
    const raw=rawPageMap.get(url);
    const usable=!!raw&&primaryMatches(p,raw);
    const parts=[],productMaterials=[],uncorroborated=[];
    const addPart=(name,quote,source,material=null,processes=[])=>{
      const canonicalName=clean(name,100).replace(/^(?:(?:stainless|carbon) steel|steel|polyurethane|polypropylene|aluminum|aluminium|plastic|fiber|injection[- ]molded|injection[- ]moulded)\s+/i,'');
      const k=key(canonicalName);if(!k||ACCESSORY.test(quote)||NEGATED.test(quote)||(!PART_RELATION.test(quote)&&!material&&!processes.length))return;
      let part=parts.find(x=>key(x.name)===k);
      if(!part){part={id:'part:'+hash(url+'|'+k),name:canonicalName,sourceUrl:url,
        relationship:'source_mentioned_part_requires_review',
        isVerifiedBom:false,isCompanyCapability:false,observations:[],materialClaims:[],processClaims:[]};parts.push(part);}
      if(!part.observations.some(x=>key(x.quote)===key(quote)))part.observations.push(evidence(url,quote,source));
      if(material&&!part.materialClaims.some(x=>key(x.name)===key(material)))part.materialClaims.push({name:material,
        evidence:evidence(url,quote,'part_specific_material'),status:'source_supported_candidate_requires_review'});
      for(const process of processes)if(!part.processClaims.some(x=>x.name===process))part.processClaims.push({name:process,
        evidence:evidence(url,quote,'part_specific_manufacturing_process'),
        status:'published_manufacturing_statement_requires_review',inHouseStatus:'unknown'});
    };
    if(usable){
      for(const line of words(raw.text.slice(0,90000)).slice(0,1100)){
        if(ACCESSORY.test(line)||NEGATED.test(line))continue;
        const hits=matchParts(line);
        if(hits.length)for(const part of hits){
          const material=nearestMaterial(line,part);
          const processes=observedProcess(line,part,hits);
          addPart(part.name,line,'part_mention',material,processes);
        }
        if((!hits.length||key(line).startsWith(key(name)))&&/\b(?:made from|made of|constructed from|material\s*:)\b/i.test(line)){
          MAT.lastIndex=0;for(const m of line.matchAll(MAT))if(!productMaterials.some(x=>key(x.name)===key(m[0])))
            productMaterials.push({name:clean(m[0],100),evidence:evidence(url,line,'whole_product_material'),
              status:'product_only_do_not_inherit_to_parts'});
        }
      }
      // Verify the original scraper's named component against verbatim text
      // and the exact product page; do not trust its unvalidated attachment.
      for(const c of (Array.isArray(p.components)?p.components:[]).slice(0,16)){
        const val=clean(c.component||c.value||c.name,100),q=clean(c.evidence?.quote,400);
        const qUrl=urlKey(c.evidence?.sourceUrl||'');
        if(val&&q&&qUrl===url&&contains(raw.text,q)&&contains(q,val))addPart(val,q,'scraper_component_correlated');
        else if(val)uncorroborated.push({name:val,reason:'quote_unchecked_or_wrong_product_page'});
      }
    }else{
      for(const c of (Array.isArray(p.components)?p.components:[]).slice(0,16)){
        const val=clean(c.component||c.value||c.name,100);
        if(val)uncorroborated.push({name:val,reason:'raw_primary_product_page_unavailable_or_title_mismatch'});
      }
    }
    totals.productsExamined++;totals.productsWithRawPage+=Number(usable);
    totals.partEvidenceCandidates+=parts.length;
    totals.partMaterialCandidates+=parts.reduce((n,x)=>n+x.materialClaims.length,0);
    totals.partProcessCandidates+=parts.reduce((n,x)=>n+x.processClaims.length,0);
    totals.productMaterialCandidates+=productMaterials.length;
    totals.uncorroboratedScraperPartMentions+=uncorroborated.length;
    out.push({productId:'product:'+hash(url+'|'+key(name)),name,sourceUrl:url,
      sourceStatus:usable?'primary_product_page_available':'insufficient_primary_product_page_evidence',
      parts,productMaterials,uncorroboratedScraperMentions:uncorroborated,
      missingEvidence:parts.length?'part_material_process_coverage_partial':'no_source_supported_integral_parts',
      status:'all_findings_require_human_review'});
  }
  return {schemaVersion:PART_EVIDENCE_SCHEMA,company:{name:clean(companyName||root,140),host:root,url:companyUrl},
    d1,products:out,counts:totals,source:'real_scraper_page_content_with_optional_private_D1_context',
    limitations:[
      'D1 commodities and materials never become product or part facts.',
      'A source-mentioned part is not a verified bill of materials.',
      'Manufacturing terms in a part sentence are reported as source statements, not proof of actual supplier process or in-house capability.',
      'Only exact product-page evidence is eligible; category and other-product pages are excluded.',
      'Missing evidence is unknown, not false; no taxonomy mutation or InsideJob OS write is performed.'
    ],originalMasterModified:false,osWritePerformed:false};
}