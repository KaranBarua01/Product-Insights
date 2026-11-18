/* Stage 2 acquisition-side intelligence and Cloudflare Workers AI transport.
 * Offline discoveries are bounded leads, not accepted product records.
 * On the network, only source evidence is sent to the explicitly configured
 * existing Scrappers Worker, not the private taxonomy file or any secrets.
 */
import {createHash} from 'node:crypto';
import {mapProductCandidates,tokens} from './research-planner.mjs';
import {groupProductFamilies,identifyCompanyRole} from './research-intelligence.mjs';

const MAX_PAGES_TO_AI=8;
const dedup=s=>[...new Set(s)];
const norm=s=>String(s||'').replace(/\s+/g,' ').trim().toLowerCase();
const hash=s=>createHash('sha256').update(s).digest('hex');
export function stage2Config(env=process.env){
  const address=env.RESEARCH_LAB_AI_URL||'',token=env.RESEARCH_LAB_AI_TOKEN||'';
  if(!address&&!token)return {configured:false,reason:'Cloudflare AI URL and secret not configured'};
  if(!address||!token)throw Error('Set BOTH RESEARCH_LAB_AI_URL and RESEARCH_LAB_AI_TOKEN');
  const url=new URL(address);
  if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash)throw Error('RESEARCH_LAB_AI_URL must be a plain HTTPS origin or base path');
  return {configured:true,url:url.href.replace(/\/$/,''),token};
}
export async function callStage2(action,payload,{config=stage2Config(),fetcher=fetch,timeoutMs=28000}={}){
  if(!['analyze','plan','propose'].includes(action))throw Error('Unknown Stage 2 action');
  if(!config.configured)return {schemaVersion:'insidejob-stage2/1',status:'not_configured'};
  const input=JSON.stringify(payload);
  if(Buffer.byteLength(input)>94_000)throw Error('AI request would exceed the capped evidence budget');
  const endpoint=config.url.replace(/\/$/,'')+'/api/stage2/'+action;
  const res=await fetcher(endpoint,{method:'POST',headers:{'Authorization':'Bearer '+config.token,'Content-Type':'application/json'},
    body:input,signal:AbortSignal.timeout(timeoutMs),redirect:'error'});
  if(!res.ok)throw Error('Stage 2 Cloudflare endpoint returned HTTP '+res.status);
  const len=Number(res.headers.get('content-length')||0);
  if(len>140_000)throw Error('AI response was too large');
  const body=await res.text();
  if(body.length>140_000)throw Error('AI response was too large');
  const parsed=JSON.parse(body);
  if(!parsed||parsed.schemaVersion!=='insidejob-stage2/1')throw Error('Unexpected Stage 2 API response');
  return parsed;
}
export function offlineProductLeads(pages){
  const leads=[],seen=new Set();
  for(const page of pages||[]){
    if(!['completed','partial'].includes(page.status))continue;
    let path;
    try{path=new URL(page.url).pathname.toLowerCase();}catch{continue;}
    const family=/(?:^|\/)(?:product-category|categories|category|collections)\/[^/]+/.test(path);
    const model=/(?:^|\/)(?:product|products|model|models)\/[^/]+/.test(path)&&!family;
    if(!family&&!model)continue;
    const pageText=String(page.aiText||page.snippet||'');
    const heading=(page.headings||[]).find(x=>typeof x==='string'&&x.trim().length>=5&&x.length<135);
    const title=String(page.title||'').split(/\s+(?:\||—|–)\s+/)[0].trim();
    const name=(heading||title).replace(/\s+/g,' ').trim();
    const siteName=new URL(page.url).hostname.replace(/^www\./,'').split('.')[0].replace(/[^a-z0-9]/gi,'').toLowerCase();
    if(name.length<5||name.length>135||name.toLowerCase().replace(/[^a-z0-9]/g,'')===siteName||
      /^(?:products?|catalog|home|shop|about|category)$/i.test(name))continue;
    const evidence=String(heading||page.title||'').trim();
    const at=pageText.toLowerCase().indexOf(name.toLowerCase());
    const quote=at>=0?pageText.slice(Math.max(0,at-20),at+Math.min(175,name.length+125)).trim():evidence.slice(0,200);
    const key=norm(name)+'|'+page.url;
    if(seen.has(key))continue;seen.add(key);
    leads.push({name,kind:model?'product_model':'product_family',sourceUrl:page.url,
      quote:quote||name,evidenceType:'page_heading_unverified',reviewStatus:'requires_human_verification',sku:null,material:null});
    if(leads.length>=50)break;
  }
  return leads;
}
export function stage2ParentChoices(nodes,products=[]){
  const words=dedup(products.flatMap(p=>tokens(p.name))).slice(0,30);
  const ranked=nodes.map(n=>({n,match:tokens(n.path).filter(t=>words.includes(t)).length}));
  const fixed=ranked.filter(x=>x.n.level<=1).map(x=>x.n);
  const l2=ranked.filter(x=>x.n.level===2).sort((a,b)=>b.match-a.match).slice(0,18).map(x=>x.n);
  const l3=ranked.filter(x=>x.n.level===3).sort((a,b)=>b.match-a.match).slice(0,14).map(x=>x.n);
  return [...fixed,...l2,...l3].slice(0,78).map(n=>({code:n.code,label:n.label,path:n.path,level:n.level}));
}
export function validateAiProducts(items,pages){
  const pageMap=new Map(pages.map(p=>[p.url,String(p.aiText||p.snippet||'')]));
  const result=[],seen=new Set();
  for(const item of Array.isArray(items)?items.slice(0,30):[]){
    if(!item||typeof item!=='object')continue;
    const name=String(item.name||'').trim(),quote=String(item.quote||'').trim();
    const text=pageMap.get(item.sourceUrl);
    if(!text||name.length<4||name.length>140||quote.length<12||quote.length>240||!norm(text).includes(norm(quote))||
      !['product_model','product_family'].includes(item.kind))continue;
    const key=norm(name)+'|'+item.sourceUrl;
    if(seen.has(key))continue;seen.add(key);
    result.push({name,kind:item.kind,sourceUrl:item.sourceUrl,quote,sku:null,material:null,
      evidenceType:'ai_quote_in_sample_unverified',reviewStatus:'requires_human_verification'});
    if(result.length>=12)break;
  }
  return result;
}
export function combineProductLeads(existing,offline,ai){
  const result=[],exactKeys=new Set(),seenNameSources=new Set();
  for(const p of [...(existing||[]),...(ai||[]),...(offline||[])]){
    const name=String(p.name||'').trim();if(!name||!p.sourceUrl)continue;
    const base=norm(name)+'|'+p.sourceUrl,sku=norm(p.sku||'');
    const key=base+'|'+sku;
    // Distinct published SKU variants survive, but a generic AI/heading name
    // on the same page is not a second copy of a structured product.
    if(exactKeys.has(key)||(!sku&&seenNameSources.has(base)))continue;
    exactKeys.add(key);seenNameSources.add(base);
    result.push({...p,kind:p.kind||'product_model',reviewStatus:'requires_human_verification',
      quote:p.quote||p.name,leadId:hash(key).slice(0,16)});
    if(result.length>=100)break;
  }
  return result;
}
export function mapStage2Products(products,nodes,aliases=[]){
  const mapped=mapProductCandidates(products,nodes);
  const byCode=new Map(nodes.map(n=>[n.code,n]));
  return mapped.map(p=>{
    if(p.taxonomy.status!=='gap_or_insufficient_evidence')return p;
    const alias=aliases.find(a=>norm(a.alias)===norm(p.name)&&byCode.has(a.existingCode));
    if(!alias)return p;
    const node=byCode.get(alias.existingCode);
    return {...p,taxonomy:{status:'candidate_requires_review',
      suggestions:[{code:node.code,label:node.label,level:node.level,path:node.path,
        score:1,method:'approved_local_alias_not_independently_verified'}]}};
  });
}
function groupEvidenceIsPresent(group,pages){
  const quote=norm(group.quote);
  if(!quote||quote.length<8)return false;
  return pages.some(page=>page.url===group.sourceUrl&&(
    [page.aiText||page.snippet||'',page.title||'',...(page.headings||[])].some(t=>norm(t).includes(quote))||
    // Product names explicitly embedded in published JSON-LD may not be
    // duplicated in the truncated visible text; retain that provenance.
    (page.structuredProducts||[]).some(p=>norm(p.name)===quote)
  ));
}
export async function stage2Analyze(report,{nodes=[],aliases=[],client=callStage2,onProgress=()=>{}}={}){
  const pages=(report.pages||[]).filter(p=>['completed','partial'].includes(p.status)).slice(0,MAX_PAGES_TO_AI);
  const offline=offlineProductLeads(pages);
  const payload={rootUrl:report.requestedUrl,pages:pages.map(p=>({
    url:p.url,title:p.title,text:String(p.aiText||p.snippet||'').slice(0,4800)}))};
  let analysis={status:'not_configured'},aiError=null;
  try{onProgress({status:'ai_research',reason:'Analyzing source evidence via optional Cloudflare Workers AI'});
    analysis=await client('analyze',payload);}
  catch(e){aiError=String(e.message||e).slice(0,200);analysis={status:'unavailable'};}
  const ai=validateAiProducts(analysis.aiProducts,pages);
  const products=mapStage2Products(combineProductLeads(report.products,offline,ai),nodes,aliases);
  const families=groupProductFamilies(products);
  const companyRole=identifyCompanyRole(pages,report.requestedUrl);
  // Unmapped SKU variations are not separate taxonomy gaps.
  // Every proposal uses one family with evidence on its own sampled page.
  const gaps=families.filter(g=>g.taxonomy.status==='gap_or_insufficient_evidence'&&groupEvidenceIsPresent(g,pages)).slice(0,10);
  let enrichment={status:'not_requested',proposals:[]},proposalError=null;
  if(gaps.length&&nodes.length){
    try{
      onProgress({status:'ai_taxonomy',reason:'Preparing reviewed taxonomy proposals; never editing the master'});
      enrichment=await client('propose',{rootUrl:report.requestedUrl,
        gaps:gaps.map(p=>({name:p.name,quote:p.quote,sourceUrl:p.sourceUrl})),
        parents:stage2ParentChoices(nodes,gaps)});
    }catch(e){proposalError=String(e.message||e).slice(0,200);enrichment={status:'unavailable',proposals:[]};}
  }
  const allowedParents=new Map(nodes.filter(n=>n.level<=2).map(n=>[n.code,n]));
  const allCodes=new Set(nodes.map(n=>n.code)),allLabels=new Set(nodes.map(n=>norm(n.label)));
  const proposals=[];
  for(const p of Array.isArray(enrichment.proposals)?enrichment.proposals:[]){
    if(!p||!['new_node','alias'].includes(p.kind)||typeof p.label!=='string'||typeof p.productName!=='string')continue;
    const gap=gaps.find(g=>g.name===p.productName&&g.sourceUrl===p.sourceUrl&&norm(g.quote)===norm(p.quote));
    if(!gap||p.label.length<4||p.label.length>150||String(p.reason||'').length<15)continue;
    if(p.kind==='new_node'&&(!allowedParents.has(p.parentCode)||allLabels.has(norm(p.label))))continue;
    if(p.kind==='alias'&&(!allCodes.has(p.existingCode)||allLabels.has(norm(p.label))))continue;
    proposals.push({kind:p.kind,label:p.label,parentCode:p.kind==='new_node'?p.parentCode:null,
      existingCode:p.kind==='alias'?p.existingCode:null,reason:p.reason,
      productName:gap.name,sourceUrl:gap.sourceUrl,quote:gap.quote,
      reviewStatus:'pending',source:'cloudflare_ai_proposal_unverified'});
    if(proposals.length>=10)break;
  }
  return {...report,products,families,companyRole,coverage:{...report.coverage,productLeads:products.length,
      productModels:products.filter(p=>p.kind==='product_model').length,
      productFamilies:families.length,
      productFamilyLeads:products.filter(p=>p.kind==='product_family').length,
      taxonomyCandidates:families.filter(g=>g.taxonomy.status==='candidate_requires_review').length,
      taxonomyGaps:families.filter(g=>g.taxonomy.status==='gap_or_insufficient_evidence').length,
      unmappedProductRecords:products.filter(p=>p.taxonomy.status==='gap_or_insufficient_evidence').length,
      taxonomyAssessed:families.length>0&&nodes.length>0},
    stage2:{schemaVersion:'insidejob-local-stage2/1',aiStatus:analysis.status,
      companyProfile:analysis.jsProfile||null,offlineCandidates:offline.length,aiProductCandidates:ai.length,
      taxonomyProposalStatus:enrichment.status,proposals,
      limitations:['Family counts use conservative model/name grouping and are not validated distinct product families.',
        'All candidate products, facts, and classification proposals require review.',
        'No confirmed supplier capabilities, RFQs, manufacturing inference, or final OS classifications are created.'],
      errors:[aiError,proposalError].filter(Boolean)}};
}
