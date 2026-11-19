/**
 * Read-only information-coverage metrics. These are discovery and source signals,
 * not verified product families, component specifications or accuracy scores.
 */
import {extractStructuredProducts} from './research-planner.mjs';

const TECHNICAL_TERM=/\b(?:voltage|current|amp(?:erage|s)?|power|watt(?:age|s)?|pressure|flow(?:\s+rate)?|temperature|capacity|weight|load(?:\s+rating)?|dimension(?:s)?|diameter|thickness|length|width|height|torque|speed|rpm|tolerance|frequency|material(?:s)?|stainless\s+steel|alumin(?:ium|um)|polycarbonate|polymer|rated|specification(?:s)?)\b/i;
const MEASURE=/\b\d+(?:[.,]\d+)?\s?(?:mm|cm|m|in(?:ch(?:es)?)?|ft|lb|lbs|kg|g|kW|W|V|A|amp|amps|psi|bar|kPa|MPa|°C|°F|rpm|Hz|gpm|lpm|mAh|Ah|N(?:m)?|%)\b/i;
const CATEGORY=/\/(?:products?|categories?|collections?|catalog|product-families?)(?:\/|$)/i;
const TECHDOC=/\.(?:pdf)(?:$|\?)/i;
const DETAIL=/\/(?:products?|product|items?|shop|catalog)\/[^/?]+(?:\/|$)/i;
const CAPABILITY=/\/(?:capabilit|manufactur|facilit|process|services)(?:[a-z-]*)(?:\/|$)/i;
const GENERIC_LABEL=/^(?:products?|shop|catalog|learn more|read more|view all|more|categories?|collections?|click here)$/i;

function norm(s){return String(s||'').replace(/\s+/g,' ').trim();}
function key(s){return norm(s).toLocaleLowerCase('en-US');}
function sourceHost(url){try{return new URL(url).hostname.toLowerCase();}catch{return null;}}
export function pageHint(url,strategy='S01'){
  let path='';try{path=new URL(url).pathname.toLowerCase();}catch{return 'other';}
  if(strategy==='S03'||/\.pdf$/.test(path))return 'pdf';
  if(/\/(?:about|about-us|our-company|who-we-are|our-story)(?:\/|$)/.test(path))return 'identity';
  if(CAPABILITY.test(path))return 'capability';
  if(DETAIL.test(path))return 'product_detail_lead';
  if(CATEGORY.test(path))return 'category_lead';
  return path==='/'?'homepage':'other';
}
export function technicalSnippets(text,max=6){
  const lines=String(text||'').split(/\r?\n/);
  const found=[],seen=new Set();
  for(const raw of lines){
    const line=norm(raw);
    if(line.length<8||line.length>420||!TECHNICAL_TERM.test(line)||!MEASURE.test(line))continue;
    const quote=line.slice(0,210),k=key(quote);
    if(seen.has(k))continue;
    seen.add(k);found.push(quote);
    if(found.length>=max)break;
  }
  return found;
}
function leadLinks(links,siteHost){
  const categories=new Map(),documents=new Set(),products=new Set();
  for(const link of (Array.isArray(links)?links:[]).slice(0,200)){
    let u;try{u=new URL(link.url);}catch{continue;}
    if(!['https:','http:'].includes(u.protocol)||u.hostname.toLowerCase()!==siteHost)continue;
    if(TECHDOC.test(u.pathname+u.search)){documents.add(u.href);continue;}
    const label=norm(link.label).slice(0,110);
    if(DETAIL.test(u.pathname)&&!GENERIC_LABEL.test(label)){products.add(u.href);}
    else if(CATEGORY.test(u.pathname)&&label.length>=4&&!GENERIC_LABEL.test(label)){categories.set(u.href,label);}
  }
  return {
    categoryLinks:[...categories].slice(0,35).map(([url,label])=>({url,label})),
    productLinks:[...products].slice(0,35),
    documentLinks:[...documents].slice(0,35)
  };
}
export function sampleExtraction(requestedUrl,result,siteHost){
  const content=result?.content||{},url=String(result?.sourceUrl||requestedUrl);
  const status=String(result?.status||'failed');
  const strategy=String(result?.strategy||'none');
  const published=extractStructuredProducts(content.jsonLd||[],url)
    .map(x=>({name:norm(x.name).slice(0,150),sku:norm(x.sku).slice(0,90),sourceUrl:url})).slice(0,35);
  const links=leadLinks(content.links,siteHost||sourceHost(url));
  const pdfList=Array.isArray(content.documents)?content.documents.filter(u=>sourceHost(u)===siteHost&&TECHDOC.test(u)).slice(0,35):[];
  const text=String(content.text||'');
  const excerpts=technicalSnippets(text);
  const evidence=Array.isArray(result?.evidence)?result.evidence:[];
  const attempts=Array.isArray(result?.attempts)?result.attempts:[];
  return {
    url,requestedUrl,status,strategy,kind:pageHint(url,strategy),textChars:text.length,
    heading:norm((content.headings||[])[0]||content.title||'').slice(0,130),
    sourceEvidenceRecords:evidence.length,
    pdfLinks:[...new Set([...links.documentLinks,...pdfList])].slice(0,35),
    pdfPagesRead:Array.isArray(content.pdfPages)?content.pdfPages.length:0,
    technicalSnippets:excerpts,structuredProducts:published,
    categoryLinks:links.categoryLinks,productLinks:links.productLinks,
    browserAttempted:attempts.some(a=>a.strategy==='S02'),
    browserSucceeded:attempts.some(a=>a.strategy==='S02'&&a.status==='completed'),
    warnings:(result?.warnings||[]).slice(0,4).map(w=>norm(w).slice(0,160)),
    reason:norm(result?.reason).slice(0,220)
  };
}
function addUnique(set,rows,k){for(const r of rows||[])if(k(r))set.add(k(r));}
export function coverageMetrics(samples,budget){
  if(!Number.isInteger(budget)||budget<1||budget>12)throw Error('Invalid page budget');
  const rows=(Array.isArray(samples)?samples:[]).slice(0,budget);
  const sources=new Set(),categoryLinks=new Set(),categoryNames=new Map(),productLinks=new Set(),pdfLinks=new Set(),structuredProducts=new Set();
  let successful=0,blocked=0,failed=0,chars=0,evidence=0,pdfRead=0,pdfPages=0,techPages=0,techExcerpts=0,capabilities=0,productPages=0,categoryPages=0,browserAttempts=0,browserSuccesses=0;
  const specimen=[],productSamples=[],technicalExamples=[];
  for(const x of rows){
    if(x.status==='completed'||x.status==='partial'){
      successful++;sources.add(x.url);
      chars+=x.textChars||0;evidence+=x.sourceEvidenceRecords||0;
      if(x.kind==='pdf'&&x.pdfPagesRead){pdfRead++;pdfPages+=x.pdfPagesRead;}
      if(x.kind==='capability')capabilities++;
      if(x.kind==='category_lead')categoryPages++;
      if(x.kind==='product_detail_lead')productPages++;
      if(x.technicalSnippets?.length){techPages++;techExcerpts+=x.technicalSnippets.length;}
      addUnique(categoryLinks,x.categoryLinks,r=>r.url);
      for(const c of x.categoryLinks||[])if(!categoryNames.has(c.url))categoryNames.set(c.url,c.label);
      addUnique(productLinks,x.productLinks,r=>r);
      addUnique(pdfLinks,x.pdfLinks,r=>r);
      addUnique(structuredProducts,x.structuredProducts,r=>key(r.name+'|'+r.sku));
      for(const product of x.structuredProducts||[]){
        if(productSamples.length<8&&!productSamples.some(y=>key(y.name+'|'+y.sku)===key(product.name+'|'+product.sku)))productSamples.push(product);
      }
      if(technicalExamples.length<5)for(const quote of x.technicalSnippets||[]){
        if(technicalExamples.length>=5)break;
        technicalExamples.push({sourceUrl:x.url,quote});
      }
    }else if(x.status==='blocked')blocked++;else failed++;
    if(x.browserAttempted)browserAttempts++;
    if(x.browserSucceeded)browserSuccesses++;
    if(specimen.length<12)specimen.push({url:x.url,kind:x.kind,status:x.status,textChars:x.textChars,strategy:x.strategy,
      reason:x.reason,heading:x.heading});
  }
  return {budget,attemptedPages:rows.length,usablePages:successful,blockedPages:blocked,otherFailedPages:failed,
    uniqueSuccessfulSourceUrls:sources.size,textChars:chars,evidenceRecords:evidence,
    categoryPageLeads:categoryPages,productDetailPageLeads:productPages,capabilityPages:capabilities,
    categoryLinkLeads:categoryLinks.size,productLinkLeads:productLinks.size,
    jsonLdProductRecords:structuredProducts.size,
    pdfLinksDiscovered:pdfLinks.size,pdfDocumentsRead:pdfRead,pdfPagesRead:pdfPages,
    technicalEvidencePages:techPages,technicalLineSignals:techExcerpts,
    browserAttempts,browserSuccesses,
    productSamples,technicalExamples,categorySamples:[...categoryNames].slice(0,12).map(([url,label])=>({url,label})),
    sourcePages:specimen};
}
const DELTAS=['attemptedPages','usablePages','uniqueSuccessfulSourceUrls','textChars','evidenceRecords',
  'categoryPageLeads','productDetailPageLeads','capabilityPages',
  'categoryLinkLeads','productLinkLeads','jsonLdProductRecords',
  'pdfLinksDiscovered','pdfDocumentsRead','pdfPagesRead','technicalEvidencePages','technicalLineSignals'];
export function compareDepth(samples){
  const baseline3=coverageMetrics(samples,3),depth12=coverageMetrics(samples,12);
  const gain=Object.fromEntries(DELTAS.map(k=>[k,depth12[k]-baseline3[k]]));
  return {baseline3,depth12,gain};
}
export const DEPTH_METRICS=DELTAS;
