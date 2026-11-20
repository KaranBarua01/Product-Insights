/* Review-only product-name seeds from REAL previously visited product-detail page titles.
 * This does not verify manufacturer ownership, product catalogs, specs or BOM parts.
 */
const norm=v=>String(v??'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const clean=(v,n)=>String(v??'').replace(/[<>{}]/g,'').replace(/\s+/g,' ').trim().slice(0,n);
const detailSegment=/(?:^|\/)(?:products?|p|items?|shop|catalog|collections|details|parts|sku)(?:\/|$)/i;
const excludedSegment=/(?:^|\/)(?:about(?:-us)?|contact|privacy|terms|news|blog|stories|careers|support|help|faq|resources|search)(?:\/|$)/i;
/** @returns {Array<{name:string,sourceUrl:string,sourceTitle:string,kind:string,reason:string}>} */
export function pageTitleCandidates(facts){
  let host;try{host=new URL(facts?.company?.url).hostname.toLowerCase().replace(/^www\./,'');}catch{return [];}
  const out=[],seen=new Set();
  for(const page of (Array.isArray(facts?.acquisition?.pages)?facts.acquisition.pages:[]).slice(0,12)){
    if(!page||!['completed','partial'].includes(page.status))continue;
    let url;try{url=new URL(page.url);}catch{continue;}
    if(url.protocol!=='https:'||url.hostname.toLowerCase().replace(/^www\./,'')!==host||url.username||url.password)continue;
    if(url.pathname==='/'||excludedSegment.test(url.pathname))continue;
    const parts=url.pathname.split('/').filter(Boolean),last=parts.at(-1)||'';
    const detail=detailSegment.test(url.pathname)||
      (last.length>=12&&last.includes('-')&&!/^(?:products?|categories|collections|shop|catalog|parts)$/i.test(last));
    if(!detail||/^(?:products?|categories|collections|shop|catalog|parts)$/i.test(last))continue;
    const sourceTitle=clean(page.title,155);
    const name=clean(sourceTitle.split(/\s[|–—]\s/)[0],125);
    if(name.length<9||name.split(/\s+/).length<2||
      /^(?:products?|shop|catalog|home|about us|contact us|all products|new arrivals|top sellers|services|collections)$/i.test(name))continue;
    const key=norm(name);if(seen.has(key))continue;
    seen.add(key);
    out.push({name,sourceUrl:url.origin+url.pathname,sourceTitle,
      kind:'page_title_candidate_needs_review',
      reason:'Name from an actual visited product-like page title; existence and company role require review'});
    if(out.length>=6)break;
  }
  return out;
}
