/**
 * Product Insights V2 — deterministic, bounded discovery signals.
 * It never fetches. The caller is responsible for exact-host and public DNS
 * enforcement. Leads/card mentions are hypotheses until detail evidence exists.
 */
export const RESEARCH_PROFILES=Object.freeze({quick:5,standard:15,deep:30});
export const MAX_ADAPTIVE_PAGES=50;
const clean=(s,max=180)=>String(s||'').replace(/\s+/g,' ').trim().slice(0,max);
const generic=/^(?:home|read more|learn more|view all|shop now|shop|products?|all products|see more|details|explore|about|company|support|contact|solutions|catalogue?|new|featured|view product|discover more)$/i;
const reject=/(?:^|\/)(?:contact|support|login|account|cart|checkout|careers|jobs|privacy|terms|cookies|faq|faqs|search|news|blog|events|webinar|demo|book|request-quote|quote|dealer|locator|press|investors)(?:\/|$)|\.(?:jpe?g|png|gif|webp|svg|zip|docx?|xlsx?|mp4|css|js)(?:\?|$)/i;
const category=/(?:^|\/)(?:products?|catalog(?:ue)?|categories|collections|shop|store|portfolio|product-families|components|solutions)(?:\/|$)/i;
const detail=/(?:^|\/)(?:products?|product|items?|models?|shop|store|p|pd|sku|catalog)(?:\/[^/]+){1,5}\/?$/i;
const technical=/(?:^|\/)(?:download|downloads|datasheet|manual|specification|technical|documentation|specs)(?:\/|$)|\.pdf$/i;
const company=/(?:^|\/)(?:about|about-us|who-we-are|company|our-story|manufacturing|capabilities)(?:\/|$)/i;
const token=s=>clean(s,200).toLowerCase().split(/[^a-z0-9]+/).filter(x=>x.length>2);
const slug=s=>clean(s,200).replace(/([a-z])([A-Z])/g,'$1 $2');
const strong=/\b(?:model|series|sku|part no|part number|item no|specification|technical details|voltage|watts?|capacity|rpm|dimensions?|product overview)\b/i;
export function getResearchBudget({profile,maxPages}={}){
 if(profile!=null&&profile!=='auto'&&!Object.hasOwn(RESEARCH_PROFILES,profile))
   throw Error('Research profile must be quick, standard or deep');
 if(maxPages!=null){
   if(!Number.isInteger(maxPages)||maxPages<1||maxPages>MAX_ADAPTIVE_PAGES)
     throw Error('Research page budget must be 1-'+MAX_ADAPTIVE_PAGES);
   return {profile:profile&&profile!=='auto'?profile:'custom',maxPages};
 }
 const chosen=profile&&profile!=='auto'?profile:'standard';
 return {profile:chosen,maxPages:RESEARCH_PROFILES[chosen]};
}
export function classifyLeadUrl(raw){
 let url;try{url=new URL(raw);}catch{return 'other';}
 const p=url.pathname.toLowerCase();
 if(reject.test(p))return 'reject';
 if(technical.test(p))return 'technical';
 if(detail.test(p)&&p.split('/').filter(Boolean).length>=2)return 'product';
 if(category.test(p))return 'catalog';
 if(company.test(p))return 'company';
 return 'other';
}
export function normalizeCandidateUrl(raw,rootHost){
 let u;try{u=new URL(raw);}catch{return null;}
 if(!['https:','http:'].includes(u.protocol)||u.hostname!==rootHost||u.username||
    u.password||(u.port&&u.port!=='443'&&u.port!=='80')||u.href.length>1400)return null;
 if(classifyLeadUrl(u.href)==='reject')return null;
 if(u.pathname.toLowerCase().startsWith('//'))return null;
 u.hash='';for(const k of [...u.searchParams.keys()])
   if(/^utm_|^(?:fbclid|gclid|mc_cid|mc_eid|ref)$/i.test(k))u.searchParams.delete(k);
 return u.href;
}
export function pageSignals(page){
 const content=page?.content||page||{},url=page?.sourceUrl||page?.url||'',head=clean(content.title,175);
 const text=String(content.text||'');
 const roles=(Array.isArray(content.jsonLd)?content.jsonLd:[]);
 const productJson=roles.some(x=>/Product|ProductGroup/i.test(JSON.stringify(x||{}).slice(0,280)));
 const catalogLinks=(content.links||[]).filter(x=>['product','catalog'].includes(classifyLeadUrl(x?.url))).length;
 const h=(content.headings||[]).slice(0,14).map(x=>clean(x,160)).join(' ');
 const kind=classifyLeadUrl(url);
 const labels=[head,h].join(' ');
 const labelIsCatalog=/\b(?:products|collections|catalog(?:ue)?|product families|all items|shop|browse|range)\b/i.test(labels);
 const specs=(text.match(/\b(?:dimensions|specifications|material|capacity|voltage|weight|sku|part number|dimensions)\b/gi)||[]).length;
 const hasProducts=productJson||kind==='product'&&specs>=1;
 const role=kind==='product'?'product':kind==='catalog'||(catalogLinks>=3&&labelIsCatalog)?
   'catalog':kind==='company'?'company':kind==='technical'?'technical':
   hasProducts?'product':'other';
 const useful=role==='product'||role==='catalog'||productJson||specs>=2;
 return {role,hasProducts,productJson,catalogLinks,specs:Math.min(40,specs),
   useful,characterCount:text.length,technicalSignals:specs,
   expectedProductLeadCount:catalogLinks};
}
export function rankPageLinks(links,rootHost,{parentRole='other',seenKinds={},limit=70}={}){
 const output=[],seen=new Set();
 for(const l of (Array.isArray(links)?links:[]).slice(0,320)){
   const url=normalizeCandidateUrl(l?.url,rootHost);
   if(!url||seen.has(url))continue;
   seen.add(url);
   const label=clean(l?.label,150),kind=classifyLeadUrl(url);
   const path=new URL(url).pathname.toLowerCase();
   const depth=path.split('/').filter(Boolean).length;
   const codeOrModel=/\b(?:[a-z]{1,6}[- ]?\d{2,6}|\d{4,}|[a-z0-9]+-[a-z0-9]{3,})\b/i.test(label+' '+path);
   const nameSpecific=label.length>=5&&label.length<=110&&!generic.test(label)&&
      token(label).length>=2;
   const guide=/\b(?:product|model|family|series|shop|catalog|browse|automation|equipment|components|bearing|sensor|pump|enclosure|printer|development|board)\b/i.test(label+' '+path);
   if(kind==='other'&&!guide&&!nameSpecific)continue;
   if(kind==='other'&&!guide&&parentRole!=='catalog')continue;
   let score=kind==='product'?88:kind==='catalog'?70:kind==='technical'?47:
     kind==='company'?16:parentRole==='catalog'?42:12;
   if(nameSpecific)score+=12;
   if(codeOrModel)score+=8;
   if(parentRole==='catalog'&&kind==='product')score+=22;
   if(parentRole==='product'&&kind==='technical')score+=26;
   if(/(?:^|\/)products?(?:\/|$)/i.test(path))score+=7;
   if(/\/(?:booking|book-demo|product-demo|request-demo|request-a-demo)\b/i.test(path))score-=70;
   if(/(?:^|\/)(?:solutions|markets|industries)(?:\/|$)/i.test(path)&&kind!=='product')
     score-=14;
   if(depth>=6)score-=9;
   if(new URL(url).search)score-=10;
   score-=Math.min(18,Number(seenKinds[kind]||0)*3);
   if(score<21)continue;
   output.push({url,kind,score,reason:kind==='product'?
     'High-intent individual product lead':kind==='catalog'?
     'Product category/catalog lead':kind==='technical'?
     'Technical source evidence lead':'Bounded exploratory site lead',
     label});
 }
 return output.sort((a,b)=>b.score-a.score||a.url.localeCompare(b.url)).slice(0,limit);
}
export function catalogCardLeads(page,rootHost,{max=12}={}){
 const signals=pageSignals(page);
 if(signals.role!=='catalog')return[];
 const links=rankPageLinks(page.content?.links||[],rootHost,{parentRole:'catalog',limit:160});
 const cards=[],seen=new Set();
 for(const lead of links){
   if(lead.kind!=='product'||!lead.label||generic.test(lead.label))continue;
   const name=slug(lead.label);
   if(name.length<6||name.length>140||token(name).length<2||seen.has(lead.url))continue;
   const paths=new URL(lead.url).pathname.split('/').filter(Boolean);
   if(paths.length<2||/\b(?:filter|sort|view all|related|more|available|category)\b/i.test(name))continue;
   seen.add(lead.url);
   cards.push({name,sourceUrl:lead.url,sourcePageUrl:page.sourceUrl||page.url,
     evidenceQuote:clean(lead.label,130),method:'source_catalog_link',
     status:'product_link_candidate_not_verified_detail'});
   if(cards.length>=Math.min(max,20))break;
 }
 return cards;
}
export function shouldStopAdaptiveResearch({pages=[],newProductsSince=0,newUsefulSince=0,
 maxPages=15,queued=0}={}){
 if(queued===0)return {stop:true,reason:'frontier_exhausted'};
 const minPages=maxPages<=5?3:maxPages<=15?8:13;
 if(pages.length<minPages)return {stop:false};
 if(newProductsSince>=5&&newUsefulSince>=5&&pages.length>=minPages)return {
   stop:true,reason:'diminishing_returns'};
 if(pages.length>=maxPages)return {stop:true,reason:'budget_exhausted'};
 return {stop:false};
}
