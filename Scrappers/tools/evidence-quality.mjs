/** Acquisition relevance only. No semantic verification or manufacturing inference.
 * Every observed signal has a literal source excerpt or published structured name.
 * Scores are coverage of observed signal types, NOT probabilities or accuracy.
 */
import {createHash} from 'node:crypto';
const clean=x=>String(x??'').replace(/\s+/g,' ').trim();
const norm=x=>clean(x).normalize('NFKC').toLowerCase();
const digest=x=>createHash('sha256').update(x).digest('hex').slice(0,24);
export const QUALITY_WEIGHTS=Object.freeze({identity:15,product:30,specifications:20,components:10,materials:10,processes:10,applications:5});
const DIMENSIONS=Object.keys(QUALITY_WEIGHTS);
const RULES={
 identity:/\b(?:we\s+(?:(?:are|design|engineer|manufacture|produce|build|supply|distribute|specialize|provide)\b)|(?:manufacturer|supplier|distributor|provider)\s+of\b|(?:founded|established)\s+in\b|headquartered\s+in\b)/i,
 specifications:/(?:\b\d+(?:[.,]\d+)?\s*(?:mm|cm|µm|μm|m\b|kg|lb|kN|N·m|Nm|MPa|bar|psi|rpm|kW|W\b|V\b|A\b|Hz|°[CF]|Ω)\b|±\s*\d+(?:[.,]\d+)?)/i,
 components:/\b(?:impellers?|shafts?|housings?|brackets?|bearings?|bushings?|seals?|gaskets?|rotors?|stators?|gears?|fasteners?|connectors?|circuit boards?|mounting plates?|parts list|bill of materials)\b/i,
 materials:/\b(?:stainless steel|carbon steel|cast iron|steel|alumin(?:um|ium)|titanium|copper|brass|bronze|nylon|rubber|polyurethane|polypropylene|polycarbonate|carbon fi(?:ber|bre)|PTFE|PEEK|ABS plastic)\b/i,
 processes:/\b(?:CNC machining|machined|injection mold(?:ed|ing)|injection mould(?:ed|ing)|die cast(?:ing)?|sand cast(?:ing)?|investment casting|extrud(?:ed|ing)|extrusion|weld(?:ed|ing)|laser cut(?:ting)?|forg(?:ed|ing)|stamp(?:ed|ing)|3D print(?:ed|ing)|additive manufacturing|heat treat(?:ed|ment))\b/i,
 applications:/\b(?:designed for|used in|applications include|industries served|suitable for|intended for)\s+\S/i
};
const GENERIC=/^(?:home|welcome|products?|our products|all products|product information|product details|catalog(?:ue)?|industrial(?: company)?|company|about(?: us)?|overview|description|technical (?:data|information)|specifications?|loading(?: products)?|read more|learn more|shop|model|series|untitled|not found|error|access denied)$/i;
const SOFT_ERROR=/^(?:404(?:\s*[-:]?\s*(?:error|page not found|not found)|$)|page not found|file not found|this page (?:does not exist|is not available)|(?:sorry[, ]+)?(?:we (?:could not|couldn't|can't) find|the requested page (?:was not found|does not exist))|access denied|forbidden|service unavailable|just a moment(?:\.\.\.)?)(?:$|[\s:|–—-])/i;
const BOILERPLATE=/\b(?:accept all cookies|cookie preferences|manage cookies|enable javascript|javascript is required|loading products|please wait while|verify you are human|checking your browser)\b/i;
const hasText=x=>clean(x).replace(/\s/g,'').length;
const sourceTexts=content=>Array.isArray(content.pdfPages)&&content.pdfPages.length?
 content.pdfPages.slice(0,15).map(p=>({locator:'PDF page '+p.page,text:String(p.text||'').slice(0,18000)})):
 [{locator:'HTML primary text',text:String(content.text||'').slice(0,90000)}];
function validName(name){
 const s=clean(name);
 return s.length>=3&&s.length<=140&&!GENERIC.test(s)&&!SOFT_ERROR.test(s)&&/[\p{L}\p{N}]{2}/u.test(s)&&!BOILERPLATE.test(s);
}
function locateSignals(content,sourceUrl){
 const sources=sourceTexts(content);
 // Physical cells are kept separate. Never interpret adjacent cells or merged
 // geometry as a relation. OCR-only text is deliberately not included.
 for(const [i,t] of (content.tables||[]).slice(0,16).entries()){
   if(t.hasMergedCells||t.truncated||(t.sourceUrl&&t.sourceUrl!==sourceUrl))continue;
   for(const [r,row] of (t.rows||[]).slice(0,70).entries())
     for(const [c,cell] of (Array.isArray(row)?row:[]).slice(0,12).entries())
       if(typeof cell==='string'&&cell.trim())sources.push({locator:'HTML table '+(t.tableIndex||i+1)+', row '+(r+1)+', cell '+(c+1),text:cell});
 }
 const signals={};
 for(const [dimension,re] of Object.entries(RULES)){
   const found=[],seen=new Set();
   for(const s of sources){
     const match=re.exec(s.text);
     if(!match)continue;
     const start=Math.max(0,match.index-65),end=Math.min(s.text.length,match.index+match[0].length+100);
     const quote=s.text.slice(start,end).trim(),key=norm(quote);
     if(!quote||seen.has(key))continue;
     seen.add(key);found.push({locator:s.locator,quote,signal:match[0]});
     if(found.length>=3)break;
   }
   if(found.length)signals[dimension]=found;
 }
 return signals;
}
export function assessPageEvidence(result,kind,structuredProducts=[]){
 const content=result.content||{},retrieved=['completed','partial'].includes(result.status);
 const empty={retrieved,accepted:false,discoveryAllowed:false,classification:'not_retrieved',score:0,signals:{},productIdentities:[],flags:[]};
 if(!retrieved)return {...empty,flags:[result.status==='needs_ocr'?'ocr_review_required':'retrieval_not_successful']};
 const title=clean(content.title),heading=clean(content.headings?.[0]),body=clean(content.text);
 const softError=[title,heading].some(s=>s&&SOFT_ERROR.test(s))||
   (body.length<700&&SOFT_ERROR.test(body));
 if(softError)return {...empty,classification:'soft_error',flags:['soft_error_response']};
 if(kind==='form')return {...empty,classification:'irrelevant',flags:['form_or_action_page']};
 const signals=locateSignals(content,result.sourceUrl),productIdentities=[],seen=new Set();
 function add(name,sku,locator,quote){
   name=clean(name);sku=clean(sku);
   if(!validName(name))return;
   const key=norm(name)+'|'+norm(sku);
   if(seen.has(key))return;
   seen.add(key);productIdentities.push({name,sku:sku||null,locator,quote,key});
 }
 for(const p of structuredProducts.slice(0,30))add(p.name,p.sku,'published JSON-LD product name',String(p.name||''));
 // A URL is a navigation hint, not a product identity. Require a real heading
 // visible in the body plus substantive context for unstructured candidates.
 const h=heading||title.split(/\s+(?:\||—|–)\s+/)[0];
 const engineering=Object.keys(signals).some(k=>['specifications','components','materials','processes'].includes(k));
 const productContext=/\b(?:model|series|product|designed|assembly|equipment|pump|valve|bearing|actuator|sensor|motor|component)\b/i.test(body);
 if(!productIdentities.length&&kind==='product'&&validName(h)&&norm(body).includes(norm(h))&&(engineering||productContext)&&hasText(body)>=30)
   add(h,null,heading?'primary HTML heading':'HTML title',h);
 if(productIdentities.length)signals.product=productIdentities.slice(0,3).map(p=>({locator:p.locator,quote:p.quote,signal:p.name}));
 const nativeChars=sourceTexts(content).reduce((n,s)=>n+hasText(s.text),0);
 const structured=productIdentities.length>0;
 const actualCells=(content.tables||[]).some(t=>(!t.sourceUrl||t.sourceUrl===result.sourceUrl)&&!t.hasMergedCells&&!t.truncated&&(t.rows||[]).some(r=>Array.isArray(r)&&r.filter(c=>clean(c)).length>=2));
 const sparse=nativeChars<25&&!structured&&!actualCells;
 const shell=!structured&&!actualCells&&Object.keys(signals).length===0&&BOILERPLATE.test(body)&&body.length<1400;
 if(sparse||shell)return {...empty,discoveryAllowed:true,classification:'insufficient',flags:[shell?'navigation_or_cookie_shell':'insufficient_native_content']};
 const score=Object.keys(signals).reduce((n,k)=>n+QUALITY_WEIGHTS[k],0);
 const flags=[];
 if(result.status==='partial')flags.push('partial_source');
 if((result.warnings||[]).some(w=>/truncat|limit reached|extraction limits/i.test(String(w))))flags.push('source_truncated');
 if(content.pdfCoverage?.ocrRequiredPages?.length)flags.push('ocr_review_required');
 if(kind==='product'&&!productIdentities.length)flags.push('product_url_without_source_identity');
 if((content.tables||[]).some(t=>t.hasMergedCells||t.truncated))flags.push('ambiguous_or_truncated_table');
 return {retrieved:true,accepted:true,discoveryAllowed:true,classification:score>0?'relevant_candidate':'context_only',score,signals,productIdentities,flags};
}
export function createQualityTracker(){
 const observed=new Map(DIMENSIONS.map(k=>[k,new Map()])),products=new Map(),branches=new Set();
 function add(page){
   const q=page.quality;if(!q?.accepted)return false;
   let novelty=false;
   for(const p of q.productIdentities||[]){
     if(!products.has(p.key)){products.set(p.key,{name:p.name,sku:p.sku,sourceUrl:page.url,locator:p.locator});novelty=true;}
   }
   for(const k of DIMENSIONS){
     const entries=observed.get(k);
     for(const sample of q.signals[k]||[]){
       const key=digest(k+'|'+norm(sample.quote));
       if(!entries.has(key)){entries.set(key,{sourceUrl:page.url,locator:sample.locator,quote:sample.quote});novelty=true;}
     }
   }
   if(q.score>0&&page.branch&&!branches.has(page.branch)){branches.add(page.branch);novelty=true;}
   return novelty;
 }
 const missing=()=>DIMENSIONS.filter(k=>!observed.get(k).size);
 function summary(pages,frontier,stopReason,{frontierDropped=0,maxPages=50}={}){
   const accepted=pages.filter(p=>p.quality?.accepted&&['completed','partial'].includes(p.status));
   const retrieved=pages.filter(p=>p.quality?.retrieved);
   const relevant=accepted.filter(p=>p.quality.score>0);
   const unassessed=pages.filter(p=>['failed','blocked','needs_ocr','unsupported','insufficient','soft_error'].includes(p.status)).map(p=>({sourceUrl:p.url,status:p.status,reason:p.reason,flags:p.quality?.flags||[]}));
   const remainingByKind={};
   for(const l of frontier)remainingByKind[l.kind]=(remainingByKind[l.kind]||0)+1;
   const missingDimensions=missing(),productCount=products.size;
   return {schemaVersion:'pi-acquisition-quality/1',
     verdict:!accepted.length?'no_usable_evidence':!productCount?'retrieved_without_product_evidence':
       missingDimensions.length?'product_evidence_with_gaps':'product_and_technical_signal_sample',
     falseSuccessRisk:retrieved.length>0&&productCount===0,
     score:100-missingDimensions.reduce((n,k)=>n+QUALITY_WEIGHTS[k],0),
     scoreMeaning:'observed signal-type coverage only; not accuracy, confidence or catalog completeness',
     independentValidation:'not_performed',verifiedAccuracy:null,catalogCompleteness:null,
     dimensions:Object.fromEntries(DIMENSIONS.map(k=>[k,{status:observed.get(k).size?'observed_candidate':'not_observed_in_sample',distinctExcerpts:observed.get(k).size,examples:[...observed.get(k).values()].slice(0,3)}])),
     missingDimensions,distinctProductCandidates:productCount,productExamples:[...products.values()].slice(0,25),
     counts:{attempted:pages.length,retrieved:retrieved.length,accepted:accepted.length,relevant:relevant.length,contextOnly:accepted.length-relevant.length,
       insufficient:pages.filter(p=>p.status==='insufficient').length,softErrors:pages.filter(p=>p.status==='soft_error').length,duplicate:pages.filter(p=>p.status==='duplicate').length},
     relevantYield:pages.length?relevant.length/pages.length:0,
     remainingByKind,remainingLeads:frontier.length,frontierDropped,stopReason,maxPages,
     unresolvedProductLeads:frontier.filter(l=>['product','catalog'].includes(l.kind)||String(l.reason||'').startsWith('Unfamiliar catalog')).length,
     unresolvedTechnicalLeads:frontier.filter(l=>l.fromProductPage||['technical','document'].includes(l.kind)).length,
     productSourcesWithoutEngineeringSignals:accepted.filter(p=>p.quality.productIdentities.length&&!['specifications','components','materials','processes'].some(k=>p.quality.signals[k]?.length)).map(p=>({sourceUrl:p.url,products:p.quality.productIdentities.map(x=>x.name)})),
     unassessedSources:unassessed.slice(0,50),
     partialSources:accepted.filter(p=>p.quality.flags.some(f=>['partial_source','source_truncated','ocr_review_required','ambiguous_or_truncated_table'].includes(f))).map(p=>({sourceUrl:p.url,flags:p.quality.flags})),
     limitations:['Not observed does not mean absent.','Observed signals are source mentions, not verified product-component relationships or manufacturing ownership.','Unvisited or inaccessible pages are not negative evidence.']};
 }
 return {add,missing,summary,productCount:()=>products.size};
}
export function gapPriority(lead,missing){
 const gaps=new Set(missing);
 if(lead.fromProductPage)return 0; // existing direct-document priority is retained
 if(gaps.has('product')&&(['product','catalog'].includes(lead.kind)||String(lead.reason||'').startsWith('Unfamiliar catalog')))return 18;
 if(gaps.has('identity')&&lead.kind==='company')return 18;
 if(['technical','document'].includes(lead.kind)&&['specifications','components','materials','processes'].some(k=>gaps.has(k)))return 12;
 return 0;
}
export function adaptiveStop({visited,maxPages,noGain,frontier,missing,branchStats}){
 // No false completion: a still-unexplored product, technical or new branch
 // candidate remains eligible even when many weak pages have been visited.
 if(visited<Math.min(maxPages,Math.max(12,Math.ceil(maxPages*.45)))||noGain<8||!frontier.length)return false;
 if(frontier.some(l=>l.fromProductPage||['product','catalog','technical','document'].includes(l.kind)||String(l.reason||'').startsWith('Unfamiliar catalog')||
   !branchStats.has(l.branch)||(l.kind==='company'&&missing.includes('identity'))))return false;
 return true;
}
