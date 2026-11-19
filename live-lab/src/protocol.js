/* Shared, strict Cloudflare/laptop Live Lab contract. No site inference. */
export const LIVE_SCHEMA='pi-cloud-laptop-live-lab/v1';
const s=(value,max=250)=>String(value??'').replace(/\s+/g,' ').trim().slice(0,max);
export function hostOf(raw){
  try{return new URL(raw).hostname.toLowerCase().replace(/^www\./,'');}catch{return null;}
}
export function allowedHosts(value){
  return new Set(String(value||'').split(',').map(x=>x.trim().toLowerCase().replace(/^www\./,''))
    .filter(x=>/^[a-z0-9.-]+$/.test(x)&&x.includes('.')&&!x.startsWith('.')&&!x.endsWith('.')));
}
export function validateTarget(input,allowed){
  if(typeof input!=='string'||input.length<8||input.length>500)throw Error('Use a short HTTPS company website URL');
  let u;
  try{u=new URL(input);}catch{throw Error('Invalid company website URL');}
  if(u.protocol!=='https:'||u.username||u.password||u.port||u.hash)throw Error('HTTPS website without credentials or custom port required');
  const host=hostOf(u.href);
  if(!host||!/^[a-z0-9.-]+$/.test(host)||!host.includes('.')||/^\d+(?:\.\d+){3}$/.test(host)||
    host==='localhost'||host.endsWith('.local')||host.endsWith('.internal'))
    throw Error('Only public DNS company hosts can be investigated');
  if(!allowed.has(host))throw Error('This company host is not approved for the shared live Lab');
  u.hash='';u.search='';
  return {url:u.href,host};
}
export function validateStart(data,allowlist){
  if(!data||typeof data!=='object'||Array.isArray(data))throw Error('Invalid investigation request');
  const {url,host}=validateTarget(data.url,allowedHosts(allowlist));
  const maxPages=Number(data.maxPages||7);
  if(![3,7,12].includes(maxPages))throw Error('Page budget must be 3, 7 or 12');
  return {url,host,maxPages,mode:'auto',browser:'headless'};
}
function webUrl(raw,host){
  try{const u=new URL(raw);return u.protocol==='https:'&&hostOf(u.href)===host&&!u.username&&!u.password?u.href:null;}
  catch{return null;}
}
function ev(e,host){
  if(!e||typeof e!=='object')return null;
  return {time:s(e.time,35),status:s(e.status||e.phase,60),
    strategy:s(e.strategy,18),url:webUrl(e.url,host),
    reason:s(e.reason,180),chars:Number.isFinite(Number(e.chars))?
      Math.max(0,Math.min(1000000,Number(e.chars))):null};
}
export function sanitizeEvents(events,host){
  return (Array.isArray(events)?events:[]).slice(-60).map(x=>ev(x,host)).filter(Boolean);
}
function evidence(e,host){
  if(!e||typeof e!=='object')return null;
  const url=webUrl(e.sourceUrl,host);
  if(!url)return null;
  return {sourceUrl:url,quote:s(e.quote,230),status:'published_quote_not_verified'};
}
function claimList(entries,host,nameKey,valueKey,limit=12){
  return (Array.isArray(entries)?entries:[]).slice(0,limit).map(x=>{
    if(!x||typeof x!=='object')return null;
    const e=evidence(x.evidence,host);
    const value=s(x[valueKey],125);
    if(!e||!value)return null;
    return {name:s(x[nameKey]||nameKey,90),value,evidence:e};
  }).filter(Boolean);
}
function safeReference(ref){
  if(!ref||ref.status!=='installed')return {status:'not_loaded',totalNodes:0,nodeHash:null,anchors:[]};
  const unique=new Set(),anchors=[];
  for(const n of Array.isArray(ref.anchors)?ref.anchors.slice(0,100):[]){
    if(!n||typeof n!=='object')continue;
    const code=s(n.code,160),label=s(n.label,160),path=s(n.path,700),level=Number(n.level);
    if(!code||!label||!path||!Number.isInteger(level)||level<0||level>4||unique.has(code))continue;
    unique.add(code);anchors.push({code,label,path,level});
    if(anchors.length>=80)break;
  }
  return {status:'installed',source:'installed_local_original_taxonomy_read_only',
    totalNodes:Number.isInteger(ref.totalNodes)&&ref.totalNodes>0&&ref.totalNodes<=12000?ref.totalNodes:0,
    nodeHash:/^[a-f0-9]{64}$/i.test(ref.nodeHash||'')?ref.nodeHash:null,
    anchors,selectedNodesOnly:true,originalMasterNotModified:true};
}

export function sanitizeCompleted(data,expectedHost){
  if(!data||typeof data!=='object')throw Error('No local research results to publish');
  const report=data.report||{},business=data.business||{};
  const actualHost=hostOf(report.requestedUrl||business.company?.website||'');
  if(actualHost!==expectedHost)throw Error('Research result hostname does not match the approved job');
  const pi=report.productIntelligence||{},coverage=pi.coverage||{};
  const resultProducts=(Array.isArray(pi.products)?pi.products:[]).slice(0,65).map(p=>{
    if(!p||typeof p!=='object')return null;
    const sourceUrl=webUrl(p.sourceUrl,expectedHost),name=s(p.name,145);
    if(!sourceUrl||!name)return null;
    return {name,sku:s(p.sku,65)||null,sourceUrl,
      reviewStatus:'unreviewed_source_candidate',
      ownership:'made_or_sold_not_verified',
      categories:(Array.isArray(p.categoryIds)?p.categoryIds:[]).slice(0,6).map(x=>s(x,80)),
      specs:claimList(p.specifications,expectedHost,'attribute','value',12),
      components:claimList(p.components,expectedHost,'component','component',9),
      materials:claimList(p.materials,expectedHost,'material','material',9),
      parts:[],manufacturingProcesses:[]};
  }).filter(Boolean);
  const categories=(Array.isArray(pi.categories)?pi.categories:[]).slice(0,40)
    .map(x=>({id:s(x.id,80),name:s(x.name,140),sourceUrl:webUrl(x.sourceUrl,expectedHost)}))
    .filter(x=>x.name&&x.sourceUrl);
  const pages=(Array.isArray(report.pages)?report.pages:[]).slice(0,12).map(p=>({
    url:webUrl(p.url,expectedHost),status:s(p.status,40),strategy:s(p.strategy,16),
    title:s(p.title,120),textChars:Number(p.textChars||0),
    warning:(Array.isArray(p.warnings)?p.warnings:[]).slice(0,2).map(x=>s(x,180))
  })).filter(x=>x.url);
  const processClaims=(Array.isArray(business.processEvidence?.claims)?business.processEvidence.claims:[])
    .slice(0,10).map(x=>({section:s(x.section,10),claim:s(x.claim,235),
      source:evidence(x.evidence,expectedHost),
      status:'unverified_unlinked_process_claim'})).filter(x=>x.source?.sourceUrl&&['JS5','JS6'].includes(x.section));
  const facts={
    schemaVersion:LIVE_SCHEMA,company:{
      name:s(business.company?.name||pi.company?.name||expectedHost,140),
      url:report.requestedUrl,
      roleCandidate:s(business.company?.roleCandidate||pi.company?.roleCandidate?.primaryRole||'unknown',60),
      roleStatus:'unverified'},
    acquisition:{status:s(report.status,50),pagesVisited:Number(report.coverage?.visitedPages||pages.length),
      pagesUsable:pages.filter(p=>['completed','partial'].includes(p.status)).length,
      pages},
    taxonomyReference:safeReference(data.taxonomyReference),
    productIntelligence:{categories,products:resultProducts,
      publishedCounts:{products:Number(coverage.products||resultProducts.length),
        categories:Number(coverage.categories||categories.length),
        specifications:Number(coverage.specifications||0),
        components:Number(coverage.components||0),materials:Number(coverage.materials||0)},
      note:'Source-supported candidates are not verified OS products, parts or manufacturing capabilities.'},
    manufacturing:{status:processClaims.length?'unverified_claims':'not_established',
      claims:processClaims,
      productPartsStatus:'not_established',
      productManufacturingProcessStatus:'not_established'},
    os:{status:'not_connected',
      note:'No OS API or JSON export is available. Do not claim an OS baseline.'},
    technical:{strategy:s(report.lab?.strategy,30),browser:s(report.lab?.browser,30),
      patternStatus:s(report.lab?.patternStatus,60),
      stage2Status:s(report.stage2?.aiStatus||report.stage2?.companyProfile?.status,60),
      errors:(Array.isArray(report.stage2?.errors)?report.stage2.errors:[]).slice(0,5).map(x=>s(x,180))},
    limitations:[
      'This is a real bounded website investigation, not a complete catalog.',
      'Website quotes are not independent factual verification.',
      'A product component mention is not a confirmed BOM part.',
      'A product or material does not establish a manufacturing process or OEM ownership.',
      'No confirmed OS integration or existing OS record comparison is implemented.'
    ]};
  const serialized=JSON.stringify(facts);
  if(serialized.length>165000)throw Error('Result exceeds the bounded remote evidence payload');
  return facts;
}
