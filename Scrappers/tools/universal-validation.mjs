/**
 * Independent Product Insights evaluation. This module intentionally does not
 * alter site selection, extraction, routing, products or manufacturing roles.
 * Frozen holdout eligibility, provenance diagnostics, and human-review scoring.
 */
import {createHash} from 'node:crypto';
import {parseCsv,prepareSites,csvEncode} from './benchmark-lib.mjs';
import {canonicalPageUrl} from './product-intelligence.mjs';

const BATCHES=['A','B','C','D','E'];
const S=30;
const norm=s=>String(s??'').replace(/\s+/g,' ').trim();
const host=s=>{
  try{return new URL(s).hostname.toLowerCase().replace(/^www\./,'');}
  catch{return null;}
};
const pageKey=url=>canonicalPageUrl(url);
export const UNIVERSAL_SCHEMA='pi-universal-holdout/v1';
export function gitBlobSha(contents){
  const data=Buffer.from(String(contents),'utf8');
  return createHash('sha1').update(Buffer.from('blob '+data.length+'\0')).update(data).digest('hex');
}
export function validateLockedCohort({cohortCsv,hostsText,lock,extractorSource,plannerSource,priorCsvs=[]}={}){
  if(lock?.schemaVersion!=='pi-independent-cohort/v1'||lock.siteCount!==30||
    lock.industryCount!==10||lock.sitesPerBatch!==6||lock.pagesPerSiteMax!==12)
    throw Error('Unknown or modified U30 cohort lock');
  const pins=[
    ['cohort.csv',cohortCsv,lock.cohortGitBlobSha],
    ['hosts.txt',hostsText,lock.hostsGitBlobSha],
    ['product-intelligence.mjs',extractorSource,lock.productExtractorGitBlobSha],
    ['research-planner.mjs',plannerSource,lock.plannerGitBlobSha]
  ];
  for(const [name,text,expected] of pins)
    if(!text||typeof expected!=='string'||!(/^[0-9a-f]{40}$/i.test(expected))||
      gitBlobSha(text)!==expected)throw Error('Frozen cohort or extractor SHA mismatch: '+name);
  const entries=parseCsv(cohortCsv);
  if(entries.length!==S)throw Error('U30 must contain exactly thirty sites');
  const rawHosts=hostsText.split(/\r?\n/).map(x=>x.replace(/#.*/,'').trim()).filter(Boolean);
  const sites=prepareSites(cohortCsv,rawHosts,30);
  const hostNames=new Set(),idNames=new Set(),industry=new Map(),batch=new Map();
  const known=new Set(priorCsvs.flatMap(t=>parseCsv(t).map(r=>host(r.url)).filter(Boolean)));
  const normalizedHosts=rawHosts.map(x=>x.toLowerCase().replace(/^www\./,''));
  if(new Set(normalizedHosts).size!==S)throw Error('Host allowlist must contain thirty unique hosts');
  for(const [i,row] of entries.entries()){
    const site=sites[i],h=host(site.url);
    if(!/^U30-\d{3}$/.test(row.site_id)||row.site_id!==site.siteId||
      !h||idNames.has(row.site_id)||hostNames.has(h))throw Error('U30 duplicate/invalid site ID or host');
    if(known.has(h))throw Error('Independent U30 site overlaps a development/regression site: '+h);
    if(!BATCHES.includes(row.batch)||!/^[a-z]+(?:_[a-z]+)*$/.test(row.industry)||
      !/^[a-z]+(?:_[a-z]+)*_candidate$/.test(row.role_stratum))
      throw Error('Invalid stratification metadata in cohort');
    if(site.companyName!==row.company_name||row.note!=='candidate_role_only_not_ground_truth')
      throw Error('Misleading or changed U30 cohort row');
    idNames.add(row.site_id);hostNames.add(h);
    industry.set(row.industry,(industry.get(row.industry)||0)+1);
    batch.set(row.batch,(batch.get(row.batch)||0)+1);
  }
  if(industry.size!==10||[...industry.values()].some(n=>n!==3)||
    BATCHES.some(b=>(batch.get(b)||0)!==6))throw Error('U30 must have 10 sectors x 3 and 5 batches x 6');
  if(hostNames.size!==normalizedHosts.length||
    normalizedHosts.some(h=>!hostNames.has(h)))throw Error('Allowlist does not exactly match frozen URLs');
  return {
    schemaVersion:UNIVERSAL_SCHEMA,
    siteCount:S,sectorCount:industry.size,batches:Object.fromEntries(batch),
    sites:entries.map((r,i)=>({...sites[i],industry:r.industry,
      roleStratum:r.role_stratum,batch:r.batch,host:host(sites[i].url)})),
    lockPins:Object.fromEntries(pins.map(([name,,sha])=>[name,sha]))
  };
}
export function traceabilityChecks(intelligence,rawPages){
  const pages=new Map();
  for(const p of rawPages){
    if(!['completed','partial'].includes(p.status))continue;
    const url=pageKey(p.url||p.sourceUrl);
    if(url&&!pages.has(url))pages.set(url,p);
  }
  const claims=[],add=(kind,source,evidence,subject,value)=>{
    claims.push({kind,sourceUrl:source||evidence?.sourceUrl||null,
      quote:norm(evidence?.quote),method:String(evidence?.method||''),
      subject:norm(subject).slice(0,110),value:norm(value).slice(0,120)});
  };
  for(const cat of intelligence?.categories||[])
    add('category_identity',cat.sourceUrl,cat.evidence,cat.name,cat.name);
  for(const p of intelligence?.products||[]){
    for(const e of p.evidence||[])add('product_identity',p.sourceUrl,e,p.name,p.name);
    for(const x of p.specifications||[])add('specification',p.sourceUrl,x.evidence,p.name,x.value);
    for(const x of p.components||[])add('component',p.sourceUrl,x.evidence,p.name,x.component);
    for(const x of p.materials||[])add('material',p.sourceUrl,x.evidence,p.name,x.material);
  }
  const identity=intelligence?.company?.roleCandidate||{};
  for(const x of identity.evidence||[])
    add('company_role',x.sourceUrl,{quote:x.quote,method:'company_role_evidence'},x.role,x.role);
  const failures=[];
  let matched=0,missingSource=0,missingQuote=0,offHost=0,metadataMatches=0;
  const expectedHost=host(intelligence?.company?.website);
  for(const claim of claims){
    const k=pageKey(claim.sourceUrl),page=k?pages.get(k):null;
    if(!k||!page){
      missingSource++;if(failures.length<12)failures.push({...claim,reason:'source_page_not_in_successful_trace'});continue;
    }
    if(host(k)!==expectedHost){
      offHost++;if(failures.length<12)failures.push({...claim,reason:'source_domain_mismatch'});continue;
    }
    if(!claim.quote){
      missingQuote++;if(failures.length<12)failures.push({...claim,reason:'no_quote'});continue;
    }
    const content=page.content||{};
    const text=[
      String(content.text||''),String(content.title||''),
      ...(content.headings||[]).map(String)
    ].join('\n');
    if(text.includes(claim.quote)){matched++;continue;}
    if(claim.method==='jsonld_product_name'&&
      JSON.stringify(content.jsonLd||[]).includes(claim.quote)){matched++;metadataMatches++;continue;}
    // Many source quotations are line slices after whitespace normalization.
    if(norm(text).includes(norm(claim.quote))){matched++;continue;}
    if(failures.length<12)failures.push({...claim,reason:'quote_not_observed_in_original_page'});
  }
  const unmatched=claims.length-matched;
  return {claimCount:claims.length,matched,unmatched,
    matchRatePct:claims.length?Number((100*matched/claims.length).toFixed(1)):null,
    missingSource,missingQuote,offHost,metadataMatches,examples:failures.slice(0,8),
    caveat:'Quote traceability checks source inclusion, not whether the claim is true or refers to the right product.'};
}
function nameKey(p){return norm(p.name).toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();}
export function productDuplicateSignals(intelligence){
  const groups=new Map();
  for(const p of intelligence?.products||[]){
    const key=(pageKey(p.sourceUrl)||p.sourceUrl)+'|'+nameKey(p);
    if(!groups.has(key))groups.set(key,[]);
    groups.get(key).push(p);
  }
  const duplicates=[...groups.values()].filter(g=>g.length>1);
  return {recordCount:(intelligence?.products||[]).length,
    samePageNormalizedNameGroups:duplicates.length,
    recordsInSuspectGroups:duplicates.reduce((sum,g)=>sum+g.length,0),
    examples:duplicates.slice(0,5).map(g=>({sourceUrl:g[0].sourceUrl,names:g.map(x=>x.name).slice(0,5)})),
    caveat:'Near-duplicate signals; distinct SKUs and variants must be reviewed before merging.'};
}
const HEADERS=['row_id','site_id','industry','role_stratum','claim_type','subject','attribute','value',
  'source_url','source_quote','review_decision','reviewer','review_note'];
export function createHumanReviewTemplate(rows,{maxProductsPerSite=5,maxAttributesPerProduct=3}={}){
  const out=[HEADERS];let index=0;
  const write=(siteId,industry,role,kind,subject,attribute,value,url,quote)=>{
    if(!url||!quote)return;
    out.push(['REV-'+String(++index).padStart(5,'0'),siteId,industry,role,kind,
      String(subject||'').slice(0,150),String(attribute||'').slice(0,80),
      String(value||'').slice(0,160),String(url||'').slice(0,280),
      String(quote||'').slice(0,230),'','','']);
  };
  for(const row of rows){
    const data=row.depth12,role=row.roleStratum,site=row.siteId,ind=row.industry;
    const roleEvidence=data?.company?.roleCandidate?.evidence||[];
    for(const e of roleEvidence.slice(0,1))
      write(site,ind,role,'company_role',row.company,'business_role',e.role,e.sourceUrl,e.quote);
    for(const c of (data?.categories||[]).slice(0,3))
      write(site,ind,role,'category',c.name,'category_name',c.name,c.sourceUrl,c.evidence?.quote);
    const seen=new Set();
    for(const p of data?.products||[]){
      const key=(pageKey(p.sourceUrl)||p.sourceUrl)+'|'+nameKey(p);
      if(seen.has(key))continue;seen.add(key);
      if(seen.size>maxProductsPerSite)break;
      write(site,ind,role,'product',p.name,'product_name',p.name,p.sourceUrl,p.evidence?.[0]?.quote);
      let count=0;
      for(const [kind,values,attr,field] of [
        ['specification',p.specifications,'attribute','value'],
        ['component',p.components,null,'component'],
        ['material',p.materials,null,'material']
      ]){
        for(const v of values||[]){
          if(count++>=maxAttributesPerProduct)break;
          write(site,ind,role,kind,p.name,attr?String(v[attr]):kind,
            String(v[field]),p.sourceUrl,v.evidence?.quote);
        }
        if(count>=maxAttributesPerProduct)break;
      }
    }
  }
  return {csv:csvEncode(out),rows:out.length-1,columns:HEADERS};
}
const DECISIONS=new Set(['correct','incorrect','uncertain']);
export function scoreHumanReviews(csv){
  const rows=parseCsv(csv);
  const perType=new Map();
  let unreviewed=0,uncertain=0,correct=0,incorrect=0;
  for(const row of rows){
    const dec=row.review_decision||'';
    if(!dec){unreviewed++;continue;}
    if(!DECISIONS.has(dec)||!row.reviewer?.trim())throw Error('Reviewed decision requires correct/incorrect/uncertain and named reviewer');
    const item=perType.get(row.claim_type)||{correct:0,incorrect:0,uncertain:0};
    if(dec==='uncertain'){uncertain++;item.uncertain++;}
    else if(dec==='correct'){correct++;item.correct++;}
    else{incorrect++;item.incorrect++;}
    perType.set(row.claim_type,item);
  }
  const total=correct+incorrect;
  const result={status:total?'human_labeled_sample':'no_adjudicated_labels',
    correct,incorrect,uncertain,unreviewed,
    reviewedPrecisionPct:total?Number((correct/total*100).toFixed(1)):null,
    byClaimType:Object.fromEntries([...perType].map(([name,x])=>[name,{
      ...x,reviewedPrecisionPct:x.correct+x.incorrect?
        Number((x.correct/(x.correct+x.incorrect)*100).toFixed(1)):null
    }])),
    caveat:'Precision on a selected, reviewed sample; NOT recall, full catalog coverage, or universal performance.'};
  return result;
}
