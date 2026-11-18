/* Evidence-first, deterministic review helpers for Product Insights.
 * Company role is a candidate only when a sampled page actually contains
 * a matching explicit self-description. A candidate is not verification.
 * Family grouping is deliberately conservative: matching full names, or
 * a distinctive alphanumeric model identifier. No manufacturing inference.
 */
import {createHash} from 'node:crypto';

const norm=s=>String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim().replace(/\s+/g,' ');
const hash=s=>createHash('sha256').update(s).digest('hex').slice(0,16);
const uniq=xs=>[...new Set(xs)];
function pageText(p){return String(p?.aiText||p?.snippet||'');}

export function identifyCompanyRole(pages,rootUrl){
  let brand='';
  try{brand=new URL(rootUrl).hostname.replace(/^www\./,'').split('.')[0].replace(/[-_]+/g,' ').replace(/[^a-z0-9 ]/gi,'').trim();}catch{}
  // On joined domains like aircraftspruce.com, recover company word boundaries
  // only from an independently matching source-page title.
  const compact=brand.replace(/\s+/g,'');
  const titled=(pages||[]).map(p=>String(p.title||'').split(/[|—–]/)[0].trim())
    .find(t=>t.length>=4&&t.length<=85&&
      t.toLowerCase().replace(/[^a-z0-9]/g,'').startsWith(compact));
  if(titled)brand=titled.toLowerCase().replace(/[^a-z0-9 ]/g,'').trim();
  const branded=brand.length>=4?brand.replace(/\s+/g,'[\\s-]+'):null;
  const candidates=[
    ['manufacturer',[
      /\bwe\s+(?:design\s+and\s+)?manufactur(?:e|es)\b/gi,
      /\bwe\s+are\s+(?:(?:an?|the)\s+)?(?:[\w'-]+\s+){0,3}manufacturer\b/gi,
      /\bour\s+company\s+(?:designs?\s+and\s+)?manufactur(?:es|e)\b/gi
    ], 'explicit_manufacturing_statement'],
    ['distributor',[
      /\bwe\s+are\s+(?:(?:an?|the)\s+)?(?:[\w'-]+\s+){0,3}(?:distributor|retailer|reseller)\b/gi,
      /\bwe\s+(?:distribute|resell)\s+(?:products|parts|equipment|supplies)\b/gi,
      /\bour\s+company\s+(?:distributes|resells)\b/gi
    ],'explicit_distribution_statement'],
    ['service_provider',[
      /\bwe\s+(?:provide|offer|specialize\s+in)\s+(?:[\w'-]+\s+){0,3}(?:machining|fabrication|engineering|repair|maintenance)\s+services\b/gi,
      /\bour\s+company\s+(?:provides|offers)\s+(?:[\w'-]+\s+){0,3}(?:machining|fabrication|engineering)\s+services\b/gi
    ],'explicit_service_statement']
  ];
  if(branded){
    // Third-person descriptions require the researched hostname-derived brand;
    // never promote a separately named product manufacturer into site role.
    const near=tail=>new RegExp('\\b'+branded+'\\s+(?:(?:&|and|specialty|co\\.?|company|usa)\\s+){0,4}(?:is|are)\\s+[^.!?\\n]{0,85}?\\b(?:'+tail+')\\b','gi');
    candidates[0][1].push(near('manufacturer'));
    candidates[1][1].push(near('distributor|retailer|reseller'));
    candidates[2][1].push(near('service provider'));
  }
  const evidence=[];
  for(const page of pages||[]){
    if(!['completed','partial'].includes(page.status))continue;
    // First-person statements copied into seller product descriptions can
    // belong to the manufacturer of the product, not the researched host.
    // Only the site's homepage and its own identity/about pages are eligible.
    let path;
    try{const u=new URL(page.url);if(u.hostname!==new URL(rootUrl).hostname)continue;path=u.pathname;}catch{continue;}
    if(!/^\/$|(?:^|\/)(?:about(?:-us)?|company(?:history)?|our-(?:story|company)|who-we-are)(?:\b|\/|\.)/i.test(path))continue;
    const sourceUrl=page.url,text=pageText(page).slice(0,5500);
    if(!text)continue;
    for(const [role,patterns,signal] of candidates){
      if(evidence.some(x=>x.role===role&&x.sourceUrl===sourceUrl))continue;
      for(const re of patterns){
        re.lastIndex=0;const m=re.exec(text);if(!m)continue;
        const quote=text.slice(Math.max(0,m.index-55),Math.min(text.length,m.index+m[0].length+95))
          .replace(/\s+/g,' ').trim();
        evidence.push({role,sourceUrl,quote,signal,reviewStatus:'requires_human_verification'});
        break;
      }
    }
    if(evidence.length>=8)break;
  }
  const roles=uniq(evidence.map(x=>x.role));
  return {status:roles.length?'candidate_requires_review':'unknown',
    primaryRole:roles.length===1?roles[0]:roles.length>1?'mixed_unverified':'unknown',
    roles,evidence:evidence.slice(0,8),
    warning:'Role requires human review. No manufacturing processes or OEM ownership are inferred.'};
}

function familyKey(product){
  const name=String(product.name||'');
  // Normalise acronym-plus-surname model labels such as "RC Allen 2610":
  // RC + Allen -> RCA2610, equivalent to "RC Allen RCA2610" or "RCA 2610".
  // This is a provisional family hint, never a verified entity relationship.
  const acronym=name.match(/^([A-Z]{2})\s+([A-Z][a-z]{2,})\s+(\d{3,6}[a-z]?)\b/);
  if(acronym)return 'model:'+acronym[1].toLowerCase()+acronym[2][0].toLowerCase()+acronym[3].toLowerCase();
  const model=name.match(/\b([a-z]{2,8})[\s-]?(\d{2,6}[a-z]?)\b/i);
  if(model)return 'model:'+model[1].toLowerCase()+model[2].toLowerCase();
  // Small numeric version such as "Zulu 3" requires distinct brand+family pair.
  const family=name.match(/^([a-z][a-z0-9-]{3,})\s+([a-z][a-z0-9-]{2,})\s+(\d{1,3})\b/i);
  if(family)return 'series:'+family[1].toLowerCase()+':'+family[2].toLowerCase()+family[3];
  return 'name:'+norm(name.replace(/\s+[|–—]\s+.+$/,''));
}
function bestRepresentative(items){
  return [...items].sort((a,b)=>
    (a.kind==='product_family'?-3:0)-(b.kind==='product_family'?-3:0)||
    String(a.name).length-String(b.name).length||
    String(a.name).localeCompare(String(b.name)))[0];
}
export function groupProductFamilies(products=[]){
  const groups=new Map();
  for(const product of products){
    if(!product||!product.name||!product.sourceUrl)continue;
    const key=familyKey(product);
    if(!groups.has(key))groups.set(key,[]);
    groups.get(key).push(product);
  }
  const out=[];
  for(const [key,members] of groups){
    const best=bestRepresentative(members);
    const matches=members.flatMap(p=>p.taxonomy?.suggestions||[]).sort((a,b)=>b.score-a.score);
    const uniqueMatches=[];const used=new Set();
    for(const match of matches){if(!used.has(match.code)){used.add(match.code);uniqueMatches.push(match);}}
    const mapped=members.some(x=>x.taxonomy?.status==='candidate_requires_review');
    const uninitialized=members.every(x=>x.taxonomy?.status==='not_loaded');
    const status=mapped?'candidate_requires_review':uninitialized?'not_loaded':'gap_or_insufficient_evidence';
    out.push({familyId:hash(key),leadId:hash('family:'+key),name:best.name,
      sourceUrl:best.sourceUrl,quote:best.quote||best.name,
      evidenceType:best.evidenceType||'bounded_product_lead_unverified',
      reviewStatus:'requires_human_verification',memberCount:members.length,
      uniqueSkus:uniq(members.map(p=>p.sku).filter(Boolean)).length,
      sourceUrls:uniq(members.map(p=>p.sourceUrl)),members,
      taxonomy:{status,suggestions:uniqueMatches.slice(0,3)}});
  }
  return out.sort((a,b)=>b.memberCount-a.memberCount||a.name.localeCompare(b.name));
}
