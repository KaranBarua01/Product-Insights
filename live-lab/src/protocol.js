/* Shared, strict Cloudflare/laptop Live Lab contract. No site inference. */
export const LIVE_SCHEMA='pi-cloud-laptop-live-lab/v1';
export const ORIGINAL_TAXONOMY_SCHEMA='pi-original-taxonomy-snapshot/v1';
/** Transfer only the checked, read-only taxonomy node catalog; never the original file or local path. */
export function sanitizeOriginalTaxonomy(snapshot){
  if(!snapshot||snapshot.status==='not_loaded')return {
    schemaVersion:ORIGINAL_TAXONOMY_SCHEMA,status:'not_loaded',totalNodes:0,
    nodeHash:null,sourceName:null,nodes:[],masterModified:false};
  if(snapshot.status!=='installed'||!Array.isArray(snapshot.nodes)||
    snapshot.nodes.length<1||snapshot.nodes.length>12000||
    snapshot.totalNodes!==snapshot.nodes.length||
    !/^[a-f0-9]{64}$/i.test(snapshot.nodeHash||''))
    throw Error('Invalid complete original taxonomy snapshot');
  const used=new Set(),nodes=[];
  for(const node of snapshot.nodes){
    const code=String(node?.code||'').trim(),label=String(node?.label||'').trim(),
      path=String(node?.path||'').trim(),level=node?.level;
    if(!code||code.length>180||!label||label.length>240||!path||path.length>1200||
      !Number.isInteger(level)||level<0||level>4||used.has(code))
      throw Error('Invalid or duplicate original taxonomy node');
    used.add(code);nodes.push({code,label,path,level});
  }
  return {schemaVersion:ORIGINAL_TAXONOMY_SCHEMA,status:'installed',
    totalNodes:nodes.length,nodeHash:snapshot.nodeHash.toLowerCase(),
    sourceName:String(snapshot.sourceName||'Installed OEM taxonomy').split(/[\\/]/).pop().slice(0,100),
    nodes,masterModified:false};
}

const s=(value,max=250)=>String(value??'').replace(/\s+/g,' ').trim().slice(0,max);

export const PROCESS_SNAPSHOT_SCHEMA='pi-oem-process-snapshot/v1';
/** Authenticated bridge view cache only; original process JSON remains laptop-local code. */
export function sanitizeProcessReference(snapshot){
 if(!snapshot||snapshot.status==='not_loaded')return {schemaVersion:PROCESS_SNAPSHOT_SCHEMA,
   status:'not_loaded',sourceHash:null,counts:null,processNames:[],roles:[],
   prevalences:[],edgeRows:[],originalMasterModified:false};
 const p=snapshot.processNames,e=snapshot.edgeRows,roles=snapshot.roles,
   prev=snapshot.prevalences,counts=snapshot.counts;
 if(snapshot.schemaVersion!==PROCESS_SNAPSHOT_SCHEMA||snapshot.status!=='loaded'||
   snapshot.sourceHash!=='23e6b05bedf44a02206903ddd6126128abe1c31a131e6bc812b60c3084d89aa8'||
   !Array.isArray(p)||p.length!==220||!Array.isArray(e)||e.length!==1004||
   !Array.isArray(roles)||roles.length!==5||!Array.isArray(prev)||prev.length!==3||
   counts?.nodes!==1213||counts?.leaves!==1004||counts?.processes!==220||counts?.links!==10388)
   throw Error('Process reference must match the pinned uploaded code taxonomy');
 const unique=new Set(),edgeRows=[];let total=0;
 for(const item of p)if(typeof item!=='string'||!item.trim()||item.length>130)
   throw Error('Invalid process name');
 for(const item of [...roles,...prev])if(typeof item!=='string'||item.length>55)
   throw Error('Invalid process metadata');
 for(const item of e){
   const code=item?.[0],list=item?.[1];
   if(typeof code!=='string'||!/^[a-z0-9_]{3,180}$/.test(code)||
     unique.has(code)||!Array.isArray(list)||list.length>80)
     throw Error('Invalid or repeated process category');
   unique.add(code);
   for(const value of list){
     if(!Array.isArray(value)||value.length!==4||
       !Number.isInteger(value[0])||value[0]<0||value[0]>=220||
       !Number.isInteger(value[1])||value[1]<0||value[1]>=5||
       !Number.isInteger(value[2])||value[2]<0||value[2]>=3||
       !(value[3]===null||typeof value[3]==='string'&&value[3].length<=160))
       throw Error('Invalid coded process edge');
     total++;
   }
   edgeRows.push([code,list]);
 }
 if(total!==10388)throw Error('Process edge count mismatch');
 return {schemaVersion:PROCESS_SNAPSHOT_SCHEMA,status:'loaded',sourceHash:snapshot.sourceHash,
   counts:{nodes:1213,leaves:1004,processes:220,links:10388},
   processNames:p,roles,prevalences:prev,edgeRows,originalMasterModified:false};
}
export const RESEARCH_GRAPH_SCHEMA='pi-research-relationship-graph/v1';
export function sanitizeResearchGraph(graph,expectedHost){
 if(!graph||graph.schemaVersion!==RESEARCH_GRAPH_SCHEMA||
   graph.originalMasterModified!==false||graph.osWritePerformed!==false||
   graph.company?.host!==expectedHost||!Array.isArray(graph.nodes)||
   !Array.isArray(graph.links))return null;
 const nodes=[],ids=new Set();
 for(const n of graph.nodes.slice(0,180)){
   if(!n||typeof n.id!=='string'||!/^(company|product|part|material|process):[a-f0-9]{18}$/.test(n.id)||
     !['company','product','part','material','process'].includes(n.kind)||ids.has(n.id))continue;
   const url=n.sourceUrl?webUrl(n.sourceUrl,expectedHost):null;
   if(n.sourceUrl&&!url)continue;
   ids.add(n.id);nodes.push({id:n.id,kind:n.kind,label:s(n.label,145),
     sourceUrl:url,evidenceQuote:s(n.evidenceQuote,230),
     status:s(n.status,80),modelInferred:!!n.modelInferred});
 }
 const links=[];
 for(const e of graph.links.slice(0,500)){
   if(!ids.has(e?.from)||!(ids.has(e?.to)||typeof e?.to==='string'&&
     /^original:[a-z0-9_]{2,180}$/.test(e.to)))continue;
   const sourceQuote=s(e.sourceQuote,230);
   links.push({from:e.from,to:e.to,relation:s(e.relation,95),
     status:s(e.status,90),basis:s(e.basis,85),
     referenceCode:s(e.referenceCode,180)||null,
     role:s(e.role,50)||null,prevalence:s(e.prevalence,50)||null,
     sourceQuote,method:s(e.method,80),confidence:s(e.confidence,70)});
 }
 const mappings=(Array.isArray(graph.mappings)?graph.mappings:[]).slice(0,48)
   .filter(x=>typeof x.targetCode==='string'&&
     /^[a-z0-9_]{2,180}$/.test(x.targetCode))
   .map(x=>({product:s(x.product||x.item,135),item:s(x.item,135),
     kind:s(x.kind,20),targetCode:s(x.targetCode,180),
     targetLabel:s(x.targetLabel,140),method:s(x.method,85),
     sourceUrl:webUrl(x.sourceUrl,expectedHost),status:'needs_review'}));
 const gaps=(Array.isArray(graph.gaps)?graph.gaps:[]).slice(0,45)
   .map(x=>({item:s(x.item,120),kind:s(x.kind,25),reason:s(x.reason,80),
     sourceUrl:webUrl(x.sourceUrl,expectedHost)}));
 const counts={products:nodes.filter(x=>x.kind==='product').length,
   parts:nodes.filter(x=>x.kind==='part').length,
   materials:nodes.filter(x=>x.kind==='material').length,
   processCandidates:links.filter(x=>x.relation==='possible_manufacturing_process').length,
   mappings:mappings.length,gaps:gaps.length};
 return {schemaVersion:RESEARCH_GRAPH_SCHEMA,source:'local_laptop_research',
   status:'candidate_graph',mode:'read_only_original_plus_per_run_working_overlay',
   nodes,links,mappings,gaps,counts,
   originalMasterModified:false,osWritePerformed:false,
   note:'Source candidates, optional AI hypotheses, and unreviewed OEM industry process priors; not manufacturer capability proof.'};
}
export function sanitizeEditionSummary(edition){
 if(!edition||edition.schemaVersion!=='pi-ai-working-edition-json/v1')return null;
 const c=edition.totals||{},counts={};
 for(const key of ['companies','products','parts','materials','processHypotheses','taxonomyMappings','gaps','candidateNodes','candidateRelations'])
   counts[key]=Number.isInteger(c[key])&&c[key]>=0&&c[key]<=999999?c[key]:0;
 return {schemaVersion:'pi-ai-working-edition-json/v1',version:Number.isInteger(edition.version)?
   Math.max(0,Math.min(250,edition.version)):0,updatedAt:s(edition.updatedAt,35)||null,
   totals:counts,
   candidateSamples:(Array.isArray(edition.candidateSamples)?edition.candidateSamples:[]).slice(-8)
     .map(x=>({kind:s(x.kind,25),label:s(x.label,140),
       status:s(x.status,80),companyCount:Number(x.companyCount||0),
       occurrences:Number(x.occurrences||0)})),
   recentCompanies:(Array.isArray(edition.recentCompanies)?edition.recentCompanies:[])
     .slice(-8).map(x=>({companyName:s(x.companyName,100),companyHost:s(x.companyHost,120),
       counts:x.counts||{}})),originalMasterModified:false,osWritePerformed:false};
}

export function hostOf(raw){
  try{return new URL(raw).hostname.toLowerCase().replace(/^www\./,'');}catch{return null;}
}
export function allowedHosts(value){
  return new Set(String(value||'').split(',').map(x=>x.trim().toLowerCase().replace(/^www\./,''))
    .filter(x=>/^[a-z0-9.-]+$/.test(x)&&x.includes('.')&&!x.startsWith('.')&&!x.endsWith('.')));
}
/** HTTPS-only public company URL syntax. DNS/public-address checks run on the laptop.
 * Cloudflare never authorizes a new domain itself: only the local operator can do so.
 */
export function validatePublicCompanyUrl(input){
  if(typeof input!=='string'||input.length<8||input.length>500)
    throw Error('Use a short HTTPS company website URL');
  let u;try{u=new URL(input);}catch{throw Error('Invalid company website URL');}
  if(u.protocol!=='https:'||u.username||u.password||u.port||u.hash)
    throw Error('Use HTTPS without credentials, fragments or custom ports');
  const hostname=u.hostname.toLowerCase(),host=hostOf(u.href);
  if(!host||!hostname||hostname.length>253||
    !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(hostname)||
    host.split('.').some(x=>x.length>63)||/(^|\.)(localhost|internal|local|onion|lan)$/.test(host)||
    /\.(?:test|invalid|example|localdomain)$/.test(host)||
    /^\d+(?:\.\d+){3}$/.test(host)||/^\d+$/.test(host.split('.').at(-1)))
    throw Error('Only public DNS company hostnames are allowed, not IPs or reserved names');
  u.hash='';u.search='';
  return {url:u.href,host};
}
/** Strictly bounded set of LOCAL-OPERATOR approved exact hosts. No arbitrary
 * wildcard, subdomain pattern, IP address or port can be added from a cloud request.
 */
export function normalizeApprovedCompanyHosts(hosts,{max=45}={}){
  if(!Array.isArray(hosts)||hosts.length>max)throw Error('Too many locally approved company hosts');
  const result=new Set();
  for(const value of hosts){
    if(typeof value!=='string'||value.length<4||value.length>250||
       /[:/\\*?#@\s]/.test(value))
      throw Error('Approval must be an exact public DNS hostname');
    const {host}=validatePublicCompanyUrl('https://'+value);
    result.add(host);
  }
  return [...result].sort();
}
export function validateTarget(input,allowed){
  const v=validatePublicCompanyUrl(input);
  if(!allowed.has(v.host))throw Error('Website not approved (not yet approved by laptop operator). Add it on the laptop using APPROVE-NEW-COMPANY.cmd and retry.');
  return v;
}
export function validateStart(data,allowlist){
  if(!data||typeof data!=='object'||Array.isArray(data))throw Error('Invalid investigation request');
  const {url,host}=validateTarget(data.url,allowedHosts(allowlist));
  const maxPages=Number(data.maxPages||7);
  if(![3,5,7,12,15,30].includes(maxPages))throw Error('Page budget must be Quick 5, Standard 15, Deep 30, or legacy 3/7/12');
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
      taxonomy:{status:s(p.taxonomy?.status||'not_mapped',48),suggestions:(Array.isArray(p.taxonomy?.suggestions)?p.taxonomy.suggestions:[]).slice(0,2).map(x=>({code:s(x.code,110),label:s(x.label,135),path:s(x.path,350),method:s(x.method||'unverified',90)})).filter(x=>x.code&&x.label)},
      specs:claimList(p.specifications,expectedHost,'attribute','value',12),
      components:claimList(p.components,expectedHost,'component','component',9),
      materials:claimList(p.materials,expectedHost,'material','material',9),
      parts:[],manufacturingProcesses:[]};
  }).filter(Boolean);
  const categories=(Array.isArray(pi.categories)?pi.categories:[]).slice(0,40)
    .map(x=>({id:s(x.id,80),name:s(x.name,140),sourceUrl:webUrl(x.sourceUrl,expectedHost)}))
    .filter(x=>x.name&&x.sourceUrl);
  const catalogLeads=(Array.isArray(pi.productLeads)?pi.productLeads:[]).slice(0,20)
    .map(p=>({name:s(p.name,140),
      sourceUrl:webUrl(p.sourceUrl,expectedHost),
      sourcePageUrl:webUrl(p.sourcePageUrl,expectedHost),
      status:'unverified_catalog_link_needs_detail'}))
    .filter(p=>p.name&&p.sourceUrl&&p.sourcePageUrl);
  const pages=(Array.isArray(report.pages)?report.pages:[]).slice(0,30).map(p=>({
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
      requestedPages:Number(report.requestedPages||data?.maxPages||0),
      researchProfile:s(report.researchProfile||'legacy',20),
      usefulPages:Number(report.coverage?.usefulPages||0),
      productDetailPages:Number(report.coverage?.productPages||0),
      catalogPages:Number(report.coverage?.catalogPages||0),
      stopReason:s(report.coverage?.stopReason||'unreported',40),
      pages},
    taxonomyReference:safeReference(data.taxonomyReference),
    researchGraph:sanitizeResearchGraph(report.researchGraph,expectedHost),
    localEdition:sanitizeEditionSummary(report.editionSummary),
    relationshipAi:{status:s(report.relationshipAi?.status||'not_run',60),
      attemptedProducts:Number(report.relationshipAi?.attemptedProducts||0),
      hypotheses:Number(report.relationshipAi?.hypotheses||0)},
    productIntelligence:{categories,products:resultProducts,
      unverifiedCatalogLeads:catalogLeads,
      publishedCounts:{products:Number(coverage.products||resultProducts.length),
        categories:Number(coverage.categories||categories.length),
        specifications:Number(coverage.specifications||0),
        components:Number(coverage.components||0),materials:Number(coverage.materials||0),
        distinctFamilyLabels:Number(coverage.distinctProductFamilyLabels||0),
        skuCandidates:Number(coverage.skuNamedProductCandidates||0),
        catalogLeads:Number(coverage.catalogLinkCandidates||0)},
      note:'Source-supported product records and catalog-card links remain separate and require review; SKU variants are not distinct product families.'},
    manufacturing:{status:processClaims.length?'unverified_claims':'not_established',
      claims:processClaims,
      productPartsStatus:'not_established',
      productManufacturingProcessStatus:'not_established'},
    os:{status:'not_connected',
      note:'No OS API or JSON export is available. Do not claim an OS baseline.'},
    technical:{strategy:s(report.lab?.strategy,30),browser:s(report.lab?.browser,30),
      patternStatus:s(report.lab?.patternStatus,60),
      stage2Status:s(report.stage2?.aiStatus||report.stage2?.companyProfile?.status,60),
      localOllama:{status:s(report.lab?.ollama?.status||'not_run',48),
        model:s(report.lab?.ollama?.model||'',90),
        pagesAnalyzed:Number(report.lab?.ollama?.pagesAnalyzed||0),
        productsReviewed:Number(report.lab?.ollama?.productsReviewed||0),
        acceptedClaims:Number(report.lab?.ollama?.acceptedClaims||0),
        rejectedClaims:Number(report.lab?.ollama?.rejectedClaims||0),
        candidatesAccepted:Number(report.lab?.ollama?.candidatesAccepted||0)},
      errors:(Array.isArray(report.stage2?.errors)?report.stage2.errors:[]).slice(0,5).map(x=>s(x,180))},
    limitations:[
      'This is a real bounded website investigation, not a complete catalog.',
      'Website quotes are not independent factual verification.',
      'A product component mention is not a confirmed BOM part.',
      'A product or material does not establish a manufacturing process or OEM ownership.',
      'No confirmed OS integration or existing OS record comparison is implemented.'
    ]};
  // Preserve the primary source extraction if an unusually large research graph
  // would exceed the existing 165 KB Cloudflare result budget. Local JSON retains
  // the FULL graph; Cloudflare receives a bounded view or safely falls back.
  let serialized=JSON.stringify(facts);
  if(serialized.length>158000&&facts.researchGraph){
    const full=facts.researchGraph;
    for(const [nodeLimit,linkLimit] of [[120,190],[75,120],[35,45],[0,0]]){
      if(nodeLimit===0){facts.researchGraph=null;serialized=JSON.stringify(facts);break;}
      const nodes=full.nodes.slice(0,nodeLimit),ids=new Set(nodes.map(n=>n.id));
      const links=full.links.filter(x=>ids.has(x.from)&&
        (ids.has(x.to)||String(x.to).startsWith('original:'))).slice(0,linkLimit);
      facts.researchGraph={...full,nodes,links,
        mappings:full.mappings.slice(0,24),gaps:full.gaps.slice(0,18),
        counts:{products:nodes.filter(x=>x.kind==='product').length,
          parts:nodes.filter(x=>x.kind==='part').length,
          materials:nodes.filter(x=>x.kind==='material').length,
          processCandidates:links.filter(x=>x.relation==='possible_manufacturing_process').length,
          mappings:Math.min(24,full.mappings.length),gaps:Math.min(18,full.gaps.length)},
        truncatedForCloudflare:true};
      serialized=JSON.stringify(facts);
      if(serialized.length<=158000)break;
    }
  }
  if(serialized.length>165000)throw Error('Result exceeds the bounded remote evidence payload');
  return facts;
}
