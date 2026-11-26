/**
 * Product Insights V3: evidence-first, host-scoped, bounded research planner.
 * This module never makes a network request. Callers provide the existing
 * safety-checked extractPage callback and enforce public DNS / robots rules.
 */
import {createHash} from 'node:crypto';

export const V3_MAX_PAGES=50;
const EXCLUDE=/(?:^|\/)(?:login|signin|account|cart|checkout|privacy|terms|cookies|jobs|careers|press|blog|news|events|search|contact|request-quote|support|investors)(?:\/|$)|\.(?:png|jpe?g|gif|svg|webp|zip|mp4|css|js)(?:$|\?)/i;
const TECH=/\b(?:datasheet|data[- ]sheet|manual|installation|technical|specification|documentation|pdf|exploded|spare[- ]parts?|replacement[- ]parts?|parts?[- ]list|assembly[- ]instructions?|engineering[- ]drawing|bom|bill[- ]of[- ]materials)\b/i;
const STRONG_TECH=/\b(?:datasheet|data[- ]sheet|manual|exploded|spare[- ]parts?|replacement[- ]parts?|parts?[- ]list|bill[- ]of[- ]materials|engineering[- ]drawing)\b/i;
const PRODUCT=/\b(?:product|products|model|series|sku|item|catalog|pumps?|bearings?|bushings?|enclosures?|racks?|equipment|systems?|components?)\b/i;
const DETAIL=/(?:^|\/)(?:products?|product|item|items|models?|sku|p)\/[^/?#]+\/?$/i;
const CATEGORY=/(?:^|\/)(?:products?|catalog(?:ue)?|categories|collections|product-category|families|shop|portfolio)(?:\/|$)/i;
const IDENTITY=/(?:^|\/)(?:about|about-us|who-we-are|our-story|company)(?:\/|$)/i;
const CLEAN=x=>String(x||'').replace(/\s+/g,' ').trim();
const hash=x=>createHash('sha256').update(String(x)).digest('hex').slice(0,12);
export function v3SafeUrl(raw,host){
  try{
    const u=new URL(raw);
    if(!['http:','https:'].includes(u.protocol)||u.hostname.toLowerCase()!==host||u.username||u.password||
       (u.port&&u.port!=='443'&&u.port!=='80')||u.href.length>1400||EXCLUDE.test(u.pathname))return null;
    if(u.pathname.startsWith('//'))return null;
    u.hash='';if(u.pathname.length>1)u.pathname=u.pathname.replace(/\/+$/,'');
    for(const key of [...u.searchParams.keys()])if(/^(?:utm_.*|fbclid|gclid|ref|mc_cid|mc_eid)$/i.test(key))u.searchParams.delete(key);
    return u.href;
  }catch{return null;}
}
export function v3PageKind(url,{title='',headings=[],text='',jsonLd=[]}={}){
  try{
    const p=new URL(url).pathname;
    if(/\.pdf$/i.test(p))return 'document';
    if(IDENTITY.test(p)||p==='/')return 'company';
    if(/(?:^|\/)(?:product-category|categories|collections|catalog(?:ue)?|families)(?:\/|$)/i.test(p))return 'catalog';
    if(DETAIL.test(p))return 'product';
    if(TECH.test(p))return 'technical';
    if(CATEGORY.test(p))return 'catalog';
    const heading=[title,...headings.slice(0,3)].join(' ');
    const hasProduct=Array.isArray(jsonLd)&&jsonLd.some(x=>/\"@type\"\s*:\s*\"Product(?:Group)?\"/i.test(JSON.stringify(x).slice(0,500)));
    if(hasProduct||(/(?:\bmodel\b|\bsku\b|specification)/i.test(String(text).slice(0,1800))&&
       /\b(?:[a-z]{1,6}[- ]?\d{2,6}|\d{4,}|product)\b/i.test(heading)))return 'product';
    return 'other';
  }catch{return 'other';}
}
export function v3RankLink(link,host,{parentKind='other',productCount=0,companySeen=false}={}){
  const url=v3SafeUrl(link?.url,host);if(!url)return null;
  const path=new URL(url).pathname;
  const label=CLEAN(link?.label).slice(0,150);
  const combined=path.replace(/[-_/]/g,' ')+' '+label;
  const kind=v3PageKind(url,{title:label});
  const partCatalog=kind==='catalog'&&/(?:^|\/)(?:parts|replacement-parts|spare-parts)(?:\/|$)/i.test(path);
  const technical=(TECH.test(combined)||kind==='document'||kind==='technical')&&!partCatalog;
  const strong=STRONG_TECH.test(combined);
  const specificProduct=kind==='product'||DETAIL.test(path);
  if(!technical&&!specificProduct&&kind!=='catalog'&&kind!=='company'&&!PRODUCT.test(combined))return null;
  // Site-home discovery favors products/categories, but one identity page is retained.
  let score=kind==='product'?110:kind==='catalog'?84:kind==='company'?22:kind==='document'?48:kind==='technical'?65:25;
  if(specificProduct)score+=25;
  if(parentKind==='catalog'&&specificProduct)score+=54;
  // The substantive improvement: a document *directly linked by a specific
  // product* outranks every unvisited category and generic sibling product.
  if(parentKind==='product'&&technical)score+=125;
  else if(parentKind==='catalog'&&technical)score+=20;
  else if(technical&&productCount>0)score+=55;
  if(strong)score+=27;
  if(/\.(?:pdf)$/i.test(path))score+=22;
  if(/\b(?:spare|replacement|exploded)\b/i.test(combined)&&!partCatalog)score+=15;
  // Replacement parts are valuable after a finished product is known, but
  // are poor company-level entry points for discovering product assemblies.
  if(partCatalog&&productCount===0)score-=75;
  if(!companySeen&&kind==='company'&&parentKind==='company')score+=75;
  if(label.length>5&&!/^(?:read more|learn more|shop now|details|view all|products?)$/i.test(label))score+=10;
  if(new URL(url).search)score-=18;
  return {url,kind:kind==='other'&&technical?'technical':kind,score,label,
    fromProductPage:parentKind==='product'&&technical,
    reason:parentKind==='product'&&technical?'Technical evidence linked directly from product':
      specificProduct?'Specific product candidate':technical?'Technical document candidate':'Product/catalogue navigation'};
}
function structuralProducts(content,url){
  const out=[],seen=new Set();const stack=[...(Array.isArray(content.jsonLd)?content.jsonLd:[])];let n=0;
  while(stack.length&&n++<100){
    const node=stack.pop();if(!node||typeof node!=='object')continue;
    if(Array.isArray(node)){stack.push(...node.slice(0,50));continue;}
    const types=Array.isArray(node['@type'])?node['@type']:[node['@type']];
    if(types.some(x=>typeof x==='string'&&/^(?:Product|ProductGroup)$/.test(x))){
      const name=CLEAN(node.name),sku=CLEAN(node.sku).slice(0,70);
      if(name.length>=3&&name.length<=140&&!seen.has(name+'|'+sku)){
        out.push({name,sku:sku||null,sourceUrl:url,evidenceType:'published_json_ld_unverified'});seen.add(name+'|'+sku);
      }
    }
    for(const k of ['@graph','mainEntity','hasVariant','itemListElement','item'])if(node[k])stack.push(node[k]);
  }
  return out.slice(0,30);
}
const technicalEvidence=(text,content)=>/\b(?:impeller|shaft|housing|bracket|bearing|seal|molding|moulding|machin|material|steel|aluminum|polyurethane|parts?[- ]list|spare parts)\b/i.test(String(text).slice(0,12000))||
  Array.isArray(content?.tables)&&content.tables.length>0;
/**
 * A true second-stage, evidence-led crawler. 50 is a ceiling, not a target.
 * Uses the existing extract() callback (S01/S02/S03) and never bypasses blocks.
 */
export async function runResearchV3({url,maxPages=30,extractPage,onProgress=()=>{},
  shouldContinue=()=>true,delayMs=250,maxCandidates=250}={}){
  const initial=new URL(url),host=initial.hostname.toLowerCase();
  if(!v3SafeUrl(initial.href,host))throw Error('Public exact-host root URL required');
  if(!Number.isInteger(maxPages)||maxPages<1||maxPages>V3_MAX_PAGES)throw Error('V3 page budget must be 1-50');
  if(typeof extractPage!=='function')throw Error('extractPage callback required');
  const startedAt=new Date().toISOString(),queue=new Map(),seen=new Set(),pages=[];
  const documentLinks=new Map(),warnings=[],seedAccessAttempts=[];
  let companySeen=false,productCount=0,usefulPages=0,productPages=0,categoryPages=0,technicalPages=0;
  let newParts=0,noGain=0,stopReason='frontier_exhausted',discoveredLeads=0,blockedPages=0;
  const initialUrl=v3SafeUrl(initial.href,host);
  // Keep the approved seed's actual path (including its trailing slash); only dedup the key.
  const seedRequest=new URL(initialUrl);seedRequest.pathname=initial.pathname;
  queue.set(initialUrl,{url:initialUrl,requestUrl:seedRequest.href,score:1000,kind:'company',parent:null,reason:'Starting company website',order:0});
  let sequence=1;
  while(queue.size>0&&pages.length<maxPages&&shouldContinue()){
    const options=[...queue.values()].sort((a,b)=>{
      const sat=item=>item.kind==='catalog'&&categoryPages>=3?Math.min(105,(categoryPages-2)*24):0;
      const av=a.score+(a.fromProductPage?20:0)-sat(a),
        bv=b.score+(b.fromProductPage?20:0)-sat(b);
      return bv-av||a.order-b.order;
    });
    const next=options[0];queue.delete(next.url);
    if(seen.has(next.url))continue;
    seen.add(next.url);
    const requested=next.requestUrl||next.url;
    onProgress({step:pages.length+1,maxPages,url:requested,status:'visiting',reason:next.reason});
    let result;
    try{result=await extractPage(requested);}catch(e){
      result={sourceUrl:next.url,status:'failed',strategy:'none',reason:String(e?.message||e),content:{},evidence:[],warnings:[]};
    }
    // Treat out-of-scope redirects as blocked, never let their text into research.
    const received=v3SafeUrl(result?.sourceUrl||next.url,host);
    if(!received){warnings.push('Off-host redirect or invalid source rejected for '+next.url);
      result={sourceUrl:next.url,status:'blocked',strategy:'none',reason:'Off-host redirect rejected',content:{},evidence:[]};}
    const actual=received||next.url;
    const content=result.content||{},kind=v3PageKind(actual,content);
    const good=['completed','partial'].includes(result.status);
    const text=good?String(content.text||''):'';
    const jsonProducts=good?structuralProducts(content,actual):[];
    const isProduct=kind==='product'||jsonProducts.length>0;
    const evidence=good&&technicalEvidence(text,content);
    const page={url:actual,status:result.status||'failed',strategy:result.strategy||'none',
      reason:result.reason||'',title:CLEAN(content.title).slice(0,180),
      textChars:text.length,snippet:text.slice(0,1300),aiText:text.slice(0,4800),
      headings:(content.headings||[]).slice(0,12),evidence:(result.evidence||[]).slice(0,8),
      structuredProducts:jsonProducts,warnings:(result.warnings||[]).slice(0,9),
      lead:next.reason,stage:isProduct?'product_detail':kind==='document'||kind==='technical'?'technical_evidence':
        kind==='catalog'?'category_discovery':kind==='company'?'company_identity':'site_exploration',
      useful:good&&(isProduct||kind==='catalog'||kind==='document'||evidence),
      technicalEvidence:Boolean(evidence),sourcePageUrl:next.parent||null};
    pages.push(page);
    if(pages.length===1||next.seedRecovery)seedAccessAttempts.push({requestedUrl:requested,sourceUrl:actual,status:page.status,reason:page.reason,recovery:!!next.seedRecovery});
    if(!good){
      if(result.status==='blocked')blockedPages++;
      noGain++;
      // Rate limits terminate the site run, rather than exploring another path.
      if(result.status==='blocked'&&/(?:\[rate_limited\]|\bHTTP 429\b)/i.test(page.reason)){stopReason='rate_limited';break;}
      // Recover only from an explicitly missing deep entry path on the approved host.
      // The existing extractPage callback must recheck robots, DNS and all transport limits.
      const root=v3SafeUrl(new URL('/',initial).href,host);
      if(pages.length===1&&pages.length<maxPages&&received&&root&&actual!==root&&next.url!==root&&
         result.status==='failed'&&/\bHTTP (?:404|410)\b/i.test(page.reason)&&!seen.has(root)){
        queue.set(root,{url:root,score:1000,kind:'company',parent:null,reason:'Missing seed path; retry approved same-host root',order:sequence++,seedRecovery:true});
      }
      if(delayMs&&queue.size&&pages.length<maxPages)await new Promise(r=>setTimeout(r,delayMs));
      continue;
    }
    seen.add(actual);
    if(kind==='company')companySeen=true;
    if(isProduct)productPages++;
    if(kind==='catalog')categoryPages++;
    if(kind==='technical'||kind==='document')technicalPages++;
    if(page.useful)usefulPages++;
    const prevProducts=productCount;productCount+=jsonProducts.length+(isProduct&&!jsonProducts.length?1:0);
    if(evidence||productCount>prevProducts)newParts++;else noGain++;
    // Per-product docs are linked by their *direct source-page anchor*, not
    // company-level co-occurrence. Their text is separately checked downstream.
    const urls=new Map();
    for(const link of [...(content.links||[]),...(content.documents||[]).map(url=>({url,label:'PDF technical document'}))]){
      const candidate=v3RankLink(link,host,{parentKind:isProduct?'product':kind,productCount,companySeen});
      if(!candidate||candidate.url===actual)continue;
      const old=urls.get(candidate.url);if(!old||candidate.score>old.score)urls.set(candidate.url,candidate);
    }
    for(const candidate of [...urls.values()].sort((a,b)=>b.score-a.score).slice(0,45)){
      if(isProduct&&candidate.fromProductPage){
        const mapKey=actual+'|'+candidate.url;
        if(!documentLinks.has(mapKey))documentLinks.set(mapKey,{productPageUrl:actual,
          documentUrl:candidate.url,anchorText:candidate.label,
          relationship:'direct_link_from_product_page_unverified'});
      }
      if(seen.has(candidate.url))continue;
      const old=queue.get(candidate.url);
      if(!old){if(queue.size>=maxCandidates)continue;
        queue.set(candidate.url,{...candidate,parent:actual,order:sequence++});discoveredLeads++;
      }else if(candidate.score>old.score){queue.set(candidate.url,{...old,score:candidate.score,
        parent:candidate.fromProductPage?actual:old.parent,
        fromProductPage:old.fromProductPage||candidate.fromProductPage});}
    }
    // Stop only after a substantial sample and no remaining high-value links.
    if(pages.length>=Math.max(12,Math.ceil(maxPages*0.45))&&noGain>=8){
      const hasTechnical=Array.from(queue.values()).some(x=>x.score>=145);
      if(!hasTechnical){stopReason='diminishing_returns';break;}
    }
    if(delayMs&&queue.size&&pages.length<maxPages)await new Promise(r=>setTimeout(r,delayMs));
  }
  if(!shouldContinue())stopReason='cancelled';
  else if(stopReason!=='rate_limited'&&pages.length>=maxPages)stopReason='budget_exhausted';
  const successfulPages=pages.filter(p=>['completed','partial'].includes(p.status)).length;
  return {schemaVersion:'pi-research-v3/1',requestedUrl:initialUrl,startedAt,
    status:successfulPages?'sampled':'no_successful_pages',requestedPages:maxPages,pages,
    products:pages.flatMap(x=>x.structuredProducts).slice(0,120),
    documentLinks:[...documentLinks.values()].slice(0,150),
    coverage:{visitedPages:pages.length,successfulPages,usefulPages,productPages,
      catalogPages:categoryPages,technicalPages,blockedPages,discoveredLeads,
      productEvidenceCandidates:productCount,sourceTechnicalPages:pages.filter(x=>x.technicalEvidence).length,
      directProductDocumentLinks:documentLinks.size,stopReason},
    seedAccessAttempts,
    warnings,limitations:['Limited and bounded same-host sample, not full catalog coverage.',
      'Technical link is not proof the document describes a specific product.',
      'The user-provided extractPage callback must enforce DNS, robots and request security.',
      'Published source claims require human review; no manufacturing process is assumed.']};
}