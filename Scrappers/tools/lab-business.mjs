/**
 * Business-facing projection of existing, evidence-first Local Research Lab
 * results. Pure presenter/contract layer: NO extraction inference, JS5/JS6
 * relabeling, manufacturing attribution, taxonomy acceptance or OS writes.
 */
export const LAB_BUSINESS_SCHEMA='pi-lab-business-view/v1';
export const LAB_OS_SNAPSHOT_SCHEMA='pi-os-snapshot/v1';
export const LAB_HANDOFF_SCHEMA='pi-os-handoff-candidate/v1';
const limit=(v,n=220)=>String(v??'').replace(/\s+/g,' ').trim().slice(0,n);
const arr=(v,n=150)=>Array.isArray(v)?v.slice(0,n):[];
function hostname(v){
  try{const u=new URL(v);return ['https:','http:'].includes(u.protocol)?u.hostname.toLowerCase().replace(/^www\./,''):null;}
  catch{return null;}
}
function safeUrl(v){
  try{const u=new URL(v);return ['https:','http:'].includes(u.protocol)&&!u.username&&!u.password?u.href:null;}
  catch{return null;}
}
function source(e,fallback){
  return {sourceUrl:safeUrl(e?.sourceUrl||fallback),quote:limit(e?.quote,240),
    locator:limit(e?.locator||e?.method,80),status:'website_published_requires_review'};
}
const normalizeName=name=>limit(name,170).toLocaleLowerCase('en-US')
  .replace(/[^\p{L}\p{N}]+/gu,' ').trim();
function convertProduct(p,categoryNames,groupMap){
  const name=limit(p.name,170),link=safeUrl(p.sourceUrl);
  if(!name||!link)return null;
  const specs=arr(p.specifications,30).map(x=>({
    name:limit(x.attribute,90),value:limit(x.value,135),unit:x.unit?limit(x.unit,24):null,
    evidence:source(x.evidence,link)})).filter(x=>x.name&&x.value&&x.evidence.sourceUrl);
  const components=arr(p.components,30).map(x=>({
    name:limit(x.component,135),relationship:'published_mention_not_confirmed_BOM',
    evidence:source(x.evidence,link)})).filter(x=>x.name&&x.evidence.sourceUrl);
  const materials=arr(p.materials,25).map(x=>({
    name:limit(x.material,135),relationship:'published_composition_claim',
    evidence:source(x.evidence,link)})).filter(x=>x.name&&x.evidence.sourceUrl);
  const categories=arr(p.categoryIds,6).map(x=>categoryNames.get(x)).filter(Boolean);
  const families=(groupMap.get(normalizeName(name))||[]).slice(0,3);
  return {
    id:limit(p.id,55)||null,name,sku:p.sku?limit(p.sku,90):null,
    sourceUrl:link,sourceMethod:limit(p.extractionMethod,70),
    reviewStatus:'candidate_requires_human_review',ownership:'manufactured_or_sold_unknown',
    categories,categoryLinkStatus:categories.length?'observed_unverified':'unresolved',
    identityEvidence:arr(p.evidence,4).map(e=>source(e,link)),
    specifications:specs,components,materials,
    parts:[],partsStatus:'not_verified_components_are_not_BOM_parts',
    manufacturingProcesses:[],manufacturingProcessesStatus:'not_established',
    taxonomySuggestions:families
  };
}
function taxonomyGroups(report){
  const map=new Map(),all=[];
  for(const g of arr(report?.families,130)){
    const name=limit(g?.name,170),tax=g?.taxonomy||{};
    const suggestions=arr(tax.suggestions,3).map(x=>({label:limit(x.label||x.path,130),
      code:limit(x.code,100),path:limit(x.path,230),score:typeof x.score==='number'?x.score:null,
      status:'unverified_candidate_not_os_mapping'})).filter(x=>x.label&&x.code);
    const record={family:name,sourceUrl:safeUrl(g.sourceUrl),status:tax.status||'not_loaded',
      suggestions,reviewStatus:'requires_human_review'};
    if(name){all.push(record);
      const keys=[name,...arr(g.members,65).map(m=>m.name)];
      for(const label of keys){const k=normalizeName(label);if(!k)continue;
        if(!map.has(k))map.set(k,[]);if(suggestions.length)map.get(k).push(...suggestions);}}
  }
  return {map,all:all.slice(0,75)};
}
function processEvidence(report){
  const sections=arr(report?.stage2?.companyProfile?.sections,12),items=[];
  for(const section of sections){
    if(!['JS5','JS6'].includes(section.code))continue;
    for(const c of arr(section.claims,12)){
      const url=safeUrl(c.sourceUrl),quote=limit(c.quote,240);
      if(!url||!quote)continue;
      items.push({kind:section.code==='JS5'?'product_relevant_process':'claimed_company_capability',
        section:section.code,claim:limit(c.claim,280),evidence:source(c,c.sourceUrl),
        linkedProductId:null,reviewStatus:'website_quote_only_requires_review'});
    }
  }
  return {status:items.length?'unverified_js5_js6_claims':'not_analyzed_or_not_found',
    claims:items.slice(0,20),
    guardrail:'JS5 product processes are not JS6 company capabilities. Neither can be assigned to a product or owned factory without explicit relationship evidence.'};
}
export function buildBusinessView(report,osSnapshot=null){
  if(!report||typeof report!=='object')throw Error('Research result required');
  const pi=report.productIntelligence||{},root=safeUrl(report.requestedUrl||pi.company?.website);
  if(!root)throw Error('Research report has no valid public website URL');
  const company={name:limit(pi.company?.name||new URL(root).hostname,170),
    website:root,roleCandidate:limit(pi.company?.roleCandidate?.primaryRole||report.companyRole?.primaryRole||'unknown',80),
    roleStatus:'candidate_not_independently_verified'};
  const cats=arr(pi.categories,45).map(x=>({
    id:limit(x.id,70),name:limit(x.name,160),sourceUrl:safeUrl(x.sourceUrl),
    reviewStatus:'candidate_requires_human_review'})).filter(x=>x.name&&x.sourceUrl&&hostname(x.sourceUrl)===hostname(root));
  const categoryNames=new Map(cats.map(x=>[x.id,x.name]));
  const mapped=taxonomyGroups(report);
  const products=arr(pi.products,120).map(p=>convertProduct(p,categoryNames,mapped.map))
    .filter(p=>p&&hostname(p.sourceUrl)===hostname(root));
  const processes=processEvidence(report);
  const coverage={pagesVisited:Number(report?.coverage?.visitedPages||0),
    pagesUsable:Number(report?.coverage?.usablePages??0),
    categories:cats.length,products:products.length,
    productsWithAttributes:products.filter(p=>p.specifications.length||p.components.length||p.materials.length).length,
    specifications:products.reduce((n,p)=>n+p.specifications.length,0),
    componentMentions:products.reduce((n,p)=>n+p.components.length,0),
    materialClaims:products.reduce((n,p)=>n+p.materials.length,0),
    verifiedProductParts:0,verifiedProductManufacturingProcesses:0};
  // Explicitly draft; no OS API connected, no field mapping or write.
  const handoff={
    schemaVersion:LAB_HANDOFF_SCHEMA,exportStatus:'draft_candidate_not_integrated',
    osWritePerformed:false,sourceKind:'website_research_candidate',
    company:{name:company.name,website:company.website,
      roleCandidate:company.roleCandidate,roleReviewStatus:company.roleStatus},
    categories:cats,
    products:products.map(p=>({
      name:p.name,sku:p.sku,sourceUrl:p.sourceUrl,
      sourceMethod:p.sourceMethod,reviewStatus:p.reviewStatus,
      ownedManufacturingNotEstablished:true,
      candidateCategories:p.categories,categoryLinkStatus:p.categoryLinkStatus,
      specifications:p.specifications,
      componentMentions:p.components,materialClaims:p.materials,
      parts:[],manufacturingProcesses:[],
      partsStatus:p.partsStatus,manufacturingProcessesStatus:p.manufacturingProcessesStatus,
      taxonomySuggestions:p.taxonomySuggestions
    })),
    separateProcessEvidence:processes.claims,
    limitations:[
      'Draft handoff shape, not an InsideJob OS production schema or API call.',
      'Component mentions are not verified bill-of-materials parts.',
      'A product or material does not imply manufacturing process or in-house production.',
      'JS5 product-process relevance is distinct from JS6 actual company capabilities.',
      'All source claims and taxonomy suggestions require review before OS use.'
    ]
  };
  const output={
    schemaVersion:LAB_BUSINESS_SCHEMA,mode:'real_website_research',
    company,coverage,categories:cats,products,
    processEvidence:processes,taxonomy:mapped.all,
    acquisition:{
      status:report.status||'unknown',pageStatus:arr(report.pages,12).map(p=>({
        url:safeUrl(p.url),status:limit(p.status,50),strategy:limit(p.strategy,20)}))
    },
    handoff,limitations:handoff.limitations
  };
  return {...output,osComparison:compareWithOs(osSnapshot,output)};
}
export function normalizeOsSnapshot(data){
  if(!data||typeof data!=='object'||Array.isArray(data)||
    data.schemaVersion!==LAB_OS_SNAPSHOT_SCHEMA)
    throw Error('Expected pi-os-snapshot/v1. Use the downloadable template and map a real OS export.');
  const c=data.company;
  if(!c||typeof c!=='object'||Array.isArray(c))throw Error('OS snapshot requires company object');
  const website=safeUrl(c.website);
  if(!website||!hostname(website)||!new URL(website).hostname.includes('.')||
    /(?:^localhost$|\.local$|\.internal$|^127\.|^10\.|^192\.168\.|^172\.(?:1[6-9]|2[0-9]|3[01])\.)/i.test(new URL(website).hostname))
    throw Error('OS snapshot requires an explicit public company.website');
  if(!c.name||typeof c.name!=='string')throw Error('OS snapshot requires a company.name');
  for(const [key,max] of [['products',500],['categories',300],['parts',300],['manufacturingProcesses',200]]){
    if(data[key]!==undefined&&!Array.isArray(data[key]))throw Error('OS snapshot '+key+' must be an array');
    if(data[key]?.length>max)throw Error('OS snapshot '+key+' exceeds local comparison limit; no partial baseline permitted');
  }
  for(const p of data.products||[]){
    if(!p||typeof p!=='object'||Array.isArray(p))throw Error('OS snapshot products must be objects');
    if((p.parts?.length||0)>50||(p.manufacturingProcesses?.length||0)>30)
      throw Error('OS snapshot product part/process relationships exceed local comparison limit');
  }
  const products=arr(data.products,500).map(p=>{
    if(!p||typeof p!=='object'||Array.isArray(p)||typeof p.name!=='string')return null;
    const name=limit(p.name,170);if(!name)return null;
    return {id:limit(p.id,80)||null,name,sku:limit(p.sku,90)||null,
      category:limit(p.category,150)||null,
      parts:arr(p.parts,50).map(x=>typeof x==='string'?limit(x,130):limit(x?.name,130)).filter(Boolean),
      manufacturingProcesses:arr(p.manufacturingProcesses,30)
        .map(x=>typeof x==='string'?limit(x,130):limit(x?.name,130)).filter(Boolean)};
  }).filter(Boolean);
  const categories=arr(data.categories,300)
    .map(x=>typeof x==='string'?limit(x,150):limit(x?.name,150)).filter(Boolean);
  const parts=arr(data.parts,300).map(x=>typeof x==='string'?limit(x,150):limit(x?.name,150)).filter(Boolean);
  const processes=arr(data.manufacturingProcesses,200)
    .map(x=>typeof x==='string'?limit(x,150):limit(x?.name,150)).filter(Boolean);
  return {schemaVersion:LAB_OS_SNAPSHOT_SCHEMA,source:'user_imported_file_not_live_api',
    company:{name:limit(c.name,160),website,id:limit(c.id,100)||null},
    exportedAt:typeof data.exportedAt==='string'?limit(data.exportedAt,45):null,
    products,categories,parts,manufacturingProcesses:processes,
    note:'Imported OS export is not independently verified or synchronized with OS.'};
}
export function compareWithOs(os,business){
  if(!os)return{status:'os_not_connected',osSource:'none',message:
    'No current OS data connected. Import a real OS export to compare. The application does not invent the OS baseline.',
    productMatches:[],researchOnlyCandidates:[],osOnlyRecords:[],osCounts:null};
  const a=hostname(os.company?.website),b=hostname(business.company?.website);
  const osCounts={products:os.products.length,categories:os.categories.length,
    parts:os.parts.length,manufacturingProcesses:os.manufacturingProcesses.length,
    productLinkedParts:os.products.reduce((n,p)=>n+p.parts.length,0),
    productLinkedProcesses:os.products.reduce((n,p)=>n+p.manufacturingProcesses.length,0)};
  if(!a||a!==b)return{status:'company_mismatch',osSource:os.source,
    message:'Imported OS company website does not match researched website. No comparison was performed.',
    osCompany:os.company,osCounts,productMatches:[],researchOnlyCandidates:[],osOnlyRecords:[]};
  const osNames=new Map(os.products.map(p=>[normalizeName(p.name),p]));
  const findings=new Map(business.products.map(p=>[normalizeName(p.name),p]));
  const matches=[],researchOnly=[];
  for(const p of business.products){
    const key=normalizeName(p.name),old=osNames.get(key);
    if(old)matches.push({researchProduct:p.name,osProduct:old.name,
      matchKind:'same_normalized_name_candidate_requires_review'});
    else researchOnly.push(p.name);
  }
  return{status:'comparable_imported_snapshot',osSource:os.source,
    message:'Compared names against an imported OS snapshot. Differences are candidate leads, not confirmed missing OS records.',
    osCompany:os.company,osCounts,productMatches:matches.slice(0,60),
    researchOnlyCandidates:researchOnly.slice(0,60),
    osOnlyRecords:os.products.filter(p=>!findings.has(normalizeName(p.name)))
      .slice(0,60).map(p=>p.name)};
}
export function osSnapshotTemplate(){
  return {schemaVersion:LAB_OS_SNAPSHOT_SCHEMA,
    exportedAt:null,
    company:{id:null,name:'REPLACE_WITH_ACTUAL_OS_COMPANY_NAME',website:'https://example.com/'},
    categories:[],products:[],parts:[],manufacturingProcesses:[],
    _instructions:'Template only. Populate with an actual approved OS export. No OS API connection exists in this prototype.'};
}
