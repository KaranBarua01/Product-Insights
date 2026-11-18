/** Bounded research orchestration over the existing Scrappers extract() implementation.
 * This module does not fetch pages or infer manufacturing processes itself.
 */
const BAD=/(?:\/(?:cart|checkout|login|register|account|privacy|terms|cookies|careers|jobs|job-application|recruit(?:ment|ing)?|blog\/tag|wp-admin|feed)(?:\/|$)|\.(?:jpg|jpeg|png|gif|webp|svg|zip|docx?|xlsx?|mp4)(?:$|\?))/i;
const GOOD=/(?:products?|categories|collections|catalog|specification|datasheet|downloads?|manuals?|documentation|capabilities|manufactur|applications?|industries|about|technology|services)/i;
const BUY=/(?:products?|categories|collections|catalog|specification|datasheet)/i;
const STOP=new Set('a an the and or for with from into of by on to in is are product products series model models system systems assembly assemblies kit kits genuine new company solutions equipment industrial usa inc ltd'.split(' '));
export const MAX_PAGES=12;
export function safeCandidate(raw,rootHost){
  try{
    const u=new URL(raw);u.hash='';
    if(!['https:','http:'].includes(u.protocol)||u.hostname!==rootHost||u.username||u.password||u.port&&!['80','443'].includes(u.port)||u.href.length>1400||BAD.test(u.pathname))return null;
    // Marketing tracking parameters are not distinct research pages.
    for(const key of [...u.searchParams.keys()])if(/^utm_|^(?:fbclid|gclid|mc_cid|mc_eid)$/i.test(key))u.searchParams.delete(key);
    return u.href;
  }catch{return null;}
}
export function rankResearchLink(link,rootHost){
  const url=safeCandidate(link?.url,rootHost);if(!url)return null;
  const u=new URL(url),path=u.pathname.toLowerCase(),text=path+' '+String(link?.label||'').toLowerCase();
  const depth=path.split('/').filter(Boolean).length;
  if(depth>8)return null;
  if(/\.pdf$/i.test(path))return {url,score:6,reason:'PDF technical document',label:String(link?.label||'Technical document').slice(0,120)};
  const strong=BUY.test(text),relevant=GOOD.test(text);
  if(!relevant)return null;
  let score=strong?12:6;
  if(/specification|datasheet|manual|technical|documentation/i.test(text))score+=3;
  if(/capabilit|manufactur|about/i.test(text))score+=1;
  if(depth>=1&&depth<=4)score+=2;
  if(u.search)score-=2;
  return {url,score,reason:strong?'Product or catalog lead':'Company or technical evidence lead',label:String(link?.label||'').slice(0,120)};
}
export function extractStructuredProducts(data,sourceUrl){
  const out=[],seen=new Set(),stack=[...(Array.isArray(data)?data:[data])];let examined=0;
  while(stack.length&&examined++<120){
    const obj=stack.pop();
    if(Array.isArray(obj)){stack.push(...obj.slice(0,40));continue;}
    if(!obj||typeof obj!=='object')continue;
    const types=Array.isArray(obj['@type'])?obj['@type']:[obj['@type']];
    if(types.some(x=>typeof x==='string'&&/^(?:Product|ProductGroup)$/i.test(x))){
      const name=typeof obj.name==='string'?obj.name.trim():'';
      if(name.length>=3&&name.length<=180){
        const sku=typeof obj.sku==='string'?obj.sku.slice(0,100):null;
        const key=(name+'|'+(sku||'')).toLowerCase();
        if(!seen.has(key)){
          seen.add(key);
          out.push({name,sku,sourceUrl,evidenceType:'published_json_ld_unverified',material:typeof obj.material==='string'?obj.material.slice(0,120):null});
          if(out.length>=35)break;
        }
      }
    }
    for(const key of ['@graph','itemListElement','mainEntity','hasVariant','isVariantOf'])if(obj[key])stack.push(obj[key]);
    if(obj.item&&typeof obj.item==='object')stack.push(obj.item);
  }
  return out;
}
export function tokens(s){
  return [...new Set(String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').split(/\s+/)
    .filter(x=>x.length>2&&!STOP.has(x))
    .map(x=>x.endsWith('ies')?x.slice(0,-3)+'y':x.endsWith('s')&&x.length>4?x.slice(0,-1):x))];
}
export function parseTaxonomy(raw){
  if(typeof raw!=='string'||raw.length>7_000_000)throw Error('Taxonomy file must be text and at most 7 MB');
  let data;
  const trimmed=raw.trim();
  if(trimmed.startsWith('[')||trimmed.startsWith('{'))data=JSON.parse(trimmed);
  else{
    const matched=/\bconst\s+DATA\s*=\s*(\[|\{)/.exec(raw);
    if(!matched)throw Error('Expected JSON taxonomy or an HTML explorer containing const DATA = [...].');
    const start=(matched.index||0)+matched[0].length-1;
    let depth=0,quoted=false,escaped=false,end=-1;
    for(let i=start;i<raw.length;i++){
      const c=raw[i];
      if(quoted){if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c==='"')quoted=false;continue;}
      if(c==='"'){quoted=true;continue;}
      if(c==='['||c==='{')depth++;
      if(c===']'||c==='}'){depth--;if(!depth){end=i+1;break;}}
    }
    if(end<0)throw Error('Taxonomy JSON was not closed.');
    data=JSON.parse(raw.slice(start,end));
  }
  const roots=Array.isArray(data)?data:Array.isArray(data.DATA)?data.DATA:Array.isArray(data.children)?data.children:[];
  const nodes=[],codes=new Set();
  const walk=(list,depth,parents=[])=>{
    if(depth>4||!Array.isArray(list))return;
    for(const node of list){
      if(!node||typeof node.code!=='string'||typeof node.label!=='string')continue;
      if(codes.has(node.code))throw Error('Duplicate taxonomy code: '+node.code);
      codes.add(node.code);
      const trail=[...parents,{code:node.code,label:node.label}];
      nodes.push({code:node.code,label:node.label,level:depth,path:trail.map(x=>x.label).join(' > ')});
      if(nodes.length>12000)throw Error('Taxonomy exceeds 12000 entries');
      walk(node.children,depth+1,trail);
    }
  };
  walk(roots,0);
  if(!nodes.length)throw Error('No taxonomy nodes found.');
  return nodes;
}
export function mapProductCandidates(products,nodes){
  if(!nodes?.length)return products.map(x=>({...x,taxonomy:{status:'not_loaded',suggestions:[]}}));
  const indexed=nodes.filter(n=>n.level>=2).map(n=>({...n,words:tokens(n.label)}));
  return products.map(product=>{
    const p=tokens(product.name);const scored=[];
    if(p.length){for(const node of indexed){
      const overlap=node.words.filter(x=>p.includes(x)).length;
      // Require at least two matching significant tokens for multiword products.
      // A bike rack must not be suggested as a dishwasher 'Racks' category.
      if(overlap<Math.min(2,p.length))continue;
      const precision=overlap/node.words.length,recall=overlap/p.length;
      const score=Math.round((0.72*precision+0.28*recall)*100)/100;
      if(precision>=0.58&&recall>=0.35&&score>=0.55)scored.push({code:node.code,label:node.label,level:node.level,path:node.path,score});
    }}
    scored.sort((a,b)=>b.score-a.score||b.level-a.level||a.code.localeCompare(b.code));
    // A lexical hit is NEVER automatically a verified engineering mapping.
    return {...product,taxonomy:{status:scored.length?'candidate_requires_review':'gap_or_insufficient_evidence',suggestions:scored.slice(0,3)}};
  });
}
export async function runResearch({url,maxPages=7,extractPage,onProgress=()=>{},delayMs=0,shouldContinue=()=>true,taxonomyNodes=[],prioritizeLinks=null}){
  if(!Number.isInteger(maxPages)||maxPages<1||maxPages>MAX_PAGES)throw Error(`maxPages must be 1-${MAX_PAGES}`);
  if(typeof extractPage!=='function')throw Error('extractPage callback required');
  const root=new URL(url).hostname,start=new Date().toISOString();
  const queued=[{url,score:100,reason:'Starting website'}],seen=new Set(),pages=[],productIndex=new Map(),warnings=[];
  let discovered=0;
  while(queued.length&&pages.length<maxPages&&shouldContinue()){
    queued.sort((a,b)=>b.score-a.score);
    const next=queued.shift();if(seen.has(next.url))continue;
    seen.add(next.url);onProgress({step:pages.length+1,maxPages,url:next.url,status:'visiting',reason:next.reason});
    let result;
    try{result=await extractPage(next.url)}
    catch(e){result={status:'failed',strategy:'none',reason:String(e?.message||e),content:{},warnings:[],evidence:[]};}
    const content=result.content||{},sourceUrl=result.sourceUrl||next.url;
    const structured=extractStructuredProducts(content.jsonLd||[],sourceUrl);
    for(const p of structured)productIndex.set((p.name+'|'+(p.sku||'')).toLowerCase(),p);
    const page={url:sourceUrl,status:result.status||'failed',strategy:result.strategy||'none',title:content.title||'',reason:result.reason||'',textChars:(content.text||'').length,
      snippet:(content.text||'').slice(0,1300),aiText:(content.text||'').slice(0,4800),headings:(content.headings||[]).slice(0,12),
      evidence:(result.evidence||[]).slice(0,7),structuredProducts:structured,
      warnings:(result.warnings||[]).slice(0,10),lead:next.reason};
    pages.push(page);
    if(page.status==='blocked')warnings.push(`Access blocked on ${sourceUrl}; no bypass attempted`);
    if(page.status==='failed')warnings.push(`Failed: ${sourceUrl} — ${page.reason}`);
    if(['completed','partial'].includes(page.status)){
      const candidates=[...(content.links||[]),...(content.documents||[]).map(x=>({url:x,label:'Technical document PDF'}))]
        .map(x=>rankResearchLink(x,root)).filter(Boolean);
      if(pages.length===1&&typeof prioritizeLinks==='function'){
        try{
          const preferred=await prioritizeLinks({rootUrl:url,page,links:candidates.slice(0,35)});
          const picks=new Set(Array.isArray(preferred)?preferred.slice(0,8):[]);
          for(const c of candidates)if(picks.has(c.url))c.score+=18;
        }catch(e){warnings.push('Stage 2 link planning was unavailable; deterministic ranking retained: '+String(e?.message||e).slice(0,120));}
      }
      for(const c of candidates){if(!seen.has(c.url)&&!queued.some(x=>x.url===c.url)){queued.push(c);discovered++;}}
      queued.sort((a,b)=>b.score-a.score);if(queued.length>70)queued.length=70;
    }
    onProgress({step:pages.length,maxPages,url:sourceUrl,status:page.status,chars:page.textChars,products:structured.length});
    if(delayMs&&queued.length&&pages.length<maxPages)await new Promise(r=>setTimeout(r,delayMs));
  }
  const products=mapProductCandidates([...productIndex.values()].slice(0,120),taxonomyNodes);
  return {schemaVersion:'local-research-lab/0.1',startedAt:start,finishedAt:new Date().toISOString(),requestedUrl:url,rootHost:root,
    status:!shouldContinue()?'cancelled':pages.some(p=>p.status==='completed')?'sampled':'no_successful_pages',
    coverage:{visitedPages:pages.length,discoveredLeads:discovered,remainingLeads:queued.length,structuredProducts:products.length,taxonomyCandidates:products.filter(x=>x.taxonomy.status==='candidate_requires_review').length,taxonomyGaps:products.filter(x=>x.taxonomy.status==='gap_or_insufficient_evidence').length},
    pages,products,warnings,limitations:[
      'A bounded sample is not a complete product catalog or a verified company profile.',
      'JSON-LD product records are unverified website assertions, not approved engineering facts.',
      'Taxonomy suggestions use lexical similarity only and require human review.',
      'No manufacturing-process inference, supplier qualification, or automatic RFQ detection is performed.'
    ]};
}