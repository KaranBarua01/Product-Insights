import type {Dependencies,ExecutionPolicy,PdfParserOutput,ScrapeCore,PdfPageEvidence,PdfLayoutRow} from './types.js';
import {assertAllowed,documentLooksPdf,fetchBounded,ResponseLimitError} from './safety.js';
const PAGE_LIMIT=15, TEXT_LIMIT=18000, OCR_LIMIT=3;
const safeInt=(n:number,lo:number,hi:number)=>Number.isFinite(n)?Math.max(lo,Math.min(hi,Math.floor(n))):lo;
export function samplePdfPages(total:number,budget:number):number[]{
  const count=safeInt(budget,1,Math.min(PAGE_LIMIT,total));
  if(total<=count)return Array.from({length:total},(_,i)=>i+1);
  if(count===1)return [1];
  const prefix=Math.ceil(count/2),rest=count-prefix;
  return [...Array.from({length:prefix},(_,i)=>i+1),...Array.from({length:rest},(_,i)=>prefix+Math.ceil((total-prefix)*(i+1)/rest))];
}
interface TextItem {str:string;hasEOL?:boolean;transform?:number[];width?:number;height?:number}
function asTextItem(x:unknown):x is TextItem{return !!x&&typeof x==='object'&&typeof (x as TextItem).str==='string'}
function position(item:TextItem){
  const t=item.transform;if(!Array.isArray(t)||t.length!==6||t.some(n=>!Number.isFinite(n)))return null;
  // Only horizontal writing: do not pretend rotated text is an aligned table.
  if(Math.abs(t[1]??0)>0.2||Math.abs(t[2]??0)>0.2)return null;
  return {x:t[4]!,y:t[5]!,width:Math.max(0,Number.isFinite(item.width)?item.width!:0),h:Math.max(1,Math.abs(t[3]??0),Math.abs(t[0]??0))};
}
export function extractPdfLayout(items:readonly unknown[]):{text:string;layoutRows:PdfLayoutRow[];textTruncated:boolean}{
  const native:string[]=[],geometry:{x:number;y:number;width:number;h:number;text:string}[]=[];
  let previous:ReturnType<typeof position>=null,chars=0,textTruncated=false,endedLine=false;
  // Preserve PDF text-item order. Use baseline changes and explicit line endings,
  // not inferred column relationships, for native text evidence.
  for(const item of items){
    if(!asTextItem(item))continue;
    if(chars>=TEXT_LIMIT||native.length>=12000){textTruncated=true;break;}
    const p=position(item),str=item.str;
    const gap=previous&&p?p.x-(previous.x+previous.width):0;
    const newLine=!!(previous&&p&&(Math.abs(previous.y-p.y)>Math.max(2,Math.min(p.h,previous.h)*0.35)||gap < -Math.max(3,p.h)||gap>Math.max(12,p.h*2.5)));
    const separator=native.length&&!endedLine?(newLine?'\n':gap>1.2?' ':previous&&p?'':' '):'';
    native.push(separator+str+(item.hasEOL?'\n':''));
    chars+=separator.length+str.length+(item.hasEOL?1:0);endedLine=!!item.hasEOL;
    if(p&&str.trim()&&geometry.length<5000)geometry.push({...p,text:str.trim()});
    previous=p;
  }
  const text=native.join('').trim();
  // Conservative visual row candidates; not an authoritative table parser.
  const bands:{y:number;h:number;items:typeof geometry}[]=[];
  for(const item of geometry.sort((a,b)=>b.y-a.y||a.x-b.x)){
    const band=bands[bands.length-1];
    if(band&&Math.abs(band.y-item.y)<=Math.max(1.5,Math.min(band.h,item.h)*0.25))band.items.push(item);
    else bands.push({y:item.y,h:item.h,items:[item]});
  }
  const candidates:PdfLayoutRow[]=[];
  for(const band of bands){
    const cells:PdfLayoutRow['cells']=[];
    for(const item of band.items.sort((a,b)=>a.x-b.x)){
      const last=cells[cells.length-1];
      const gap=last?item.x-(last.x+last.width):Infinity;
      if(last&&gap<=Math.max(10,item.h*1.5)){
        last.text=(last.text+(gap>1.2?' ':'')+item.text).slice(0,220);
        last.width=Math.max(last.width,item.x+item.width-last.x);
      }else if(cells.length<12)cells.push({x:item.x,width:item.width,text:item.text.slice(0,220)});
    }
    if(cells.length>=2)candidates.push({y:band.y,cells,reviewStatus:'geometry_candidate_requires_review'});
  }
  // Require at least two nearby rows with the same aligned cell starts.
  const aligned=(a:PdfLayoutRow,b:PdfLayoutRow)=>a.cells.length===b.cells.length&&Math.abs(a.y-b.y)<=70&&a.cells.every((cell,i)=>Math.abs(cell.x-b.cells[i]!.x)<=6);
  const layoutRows=candidates.filter((r,i)=>(i>0&&aligned(r,candidates[i-1]!))||(i+1<candidates.length&&aligned(r,candidates[i+1]!))).slice(0,70);
  return {text:text.slice(0,TEXT_LIMIT),layoutRows,textTruncated:textTruncated||text.length>TEXT_LIMIT};
}
export async function unpdfParser(bytes:Uint8Array,maxPages:number):Promise<PdfParserOutput>{
  const {getDocumentProxy}=await import('unpdf');
  const doc=await getDocumentProxy(new Uint8Array(bytes),{maxImageSize:16_777_216,disableFontFace:true,isEvalSupported:false});
  try{
    if(doc.numPages<1)throw Error('PDF declares no pages');
    const selected=samplePdfPages(doc.numPages,maxPages),pages:PdfPageEvidence[]=[];
    for(const n of selected){
      try{
        const page=await doc.getPage(n);
        try{const textContent=await page.getTextContent();pages.push({page:n,...extractPdfLayout(textContent.items)});}
        finally{try{page.cleanup();}catch{/* preserve successfully extracted text */}}
      }catch{pages.push({page:n,text:'',extractionFailed:true});}
    }
    return {pageCount:pages.length,totalPages:doc.numPages,truncated:doc.numPages>pages.length,pages};
  }finally{await (doc as unknown as {destroy?:()=>Promise<unknown>|unknown}).destroy?.();}
}
function nativeTextPresent(text:string){return text.replace(/\s/g,'').length>=30}
export async function scrapeS03(url:string,dependencies:Dependencies,policy:ExecutionPolicy,maxPages=8):Promise<ScrapeCore>{
  const safe=assertAllowed(url,policy.allowedHosts),byteLimit=safeInt(policy.maxBytesPdf??3_000_000,1,policy.allowLargePdf===true?12_000_000:3_000_000);
  let response;
  try{response=await fetchBounded(safe.href,policy.allowedHosts,dependencies.fetcher,{timeoutMs:policy.timeoutMs??7000,maxBytes:byteLimit,robotsRules:policy.robotsRules,largePdf:policy.allowLargePdf===true},'application/pdf');}
  catch(error){
    if(!(error instanceof ResponseLimitError))throw error;
    return {strategy:'S03',status:'failed',reason:'PDF exceeds '+byteLimit+'-byte permitted transfer limit; full document not assessed',sourceUrl:safe.href,content:{},evidence:[],warnings:['Oversized document; no partial bytes parsed. Larger local transfer requires explicit approval.']};
  }
  if(response.status>=400)return {strategy:'S03',status:[401,403,429,503].includes(response.status)?'blocked':'failed',reason:'HTTP '+response.status,sourceUrl:response.url,content:{},evidence:[],warnings:[]};
  if(response.status!==200||response.truncated)return {strategy:'S03',status:'failed',reason:'Incomplete PDF response; full document required',sourceUrl:response.url,content:{},evidence:[],warnings:[]};
  if(!documentLooksPdf(response.bytes,response.type,response.url))return {strategy:'S03',status:'unsupported',reason:'Not a PDF response',sourceUrl:response.url,content:{},evidence:[],warnings:[]};
  if(response.bytes.length<5 || String.fromCharCode(...response.bytes.slice(0,5))!=='%PDF-')return {strategy:'S03',status:'failed',reason:'Invalid PDF signature',sourceUrl:response.url,content:{},evidence:[],warnings:[]};
  const parser=dependencies.pdfParser??unpdfParser;
  const parsed=await parser(response.bytes,safeInt(maxPages,1,PAGE_LIMIT));
  const unique=new Set<number>(),pages:PdfPageEvidence[]=[];
  for(const p of parsed.pages.slice(0,safeInt(maxPages,1,PAGE_LIMIT))){
    if(!Number.isInteger(p.page)||p.page<1||unique.has(p.page)||(parsed.totalPages!==undefined&&p.page>parsed.totalPages))continue;
    unique.add(p.page);
    const raw=String(p.text??'');
    pages.push({page:p.page,text:raw.slice(0,TEXT_LIMIT),layoutRows:p.layoutRows?.slice(0,70),textTruncated:p.textTruncated||raw.length>TEXT_LIMIT,extractionFailed:p.extractionFailed,ocrStatus:nativeTextPresent(raw)?'not_needed':'required'});
  }
  const needs=pages.filter(p=>p.ocrStatus==='required');
  if(dependencies.pdfOcr&&needs.length){
    const selected=needs.slice(0,OCR_LIMIT);
    for(const p of needs.slice(OCR_LIMIT))p.ocrStatus='not_attempted_budget';
    try{
      const recognized=await dependencies.pdfOcr(response.bytes,selected.map(p=>p.page));
      for(const p of selected){
        const match=recognized.find(r=>r.page===p.page&&typeof r.text==='string');
        const text=match?.text.trim().slice(0,6000)||'';
        p.ocrStatus=nativeTextPresent(text)?'review_ready':'failed';
        if(p.ocrStatus==='review_ready')p.ocrText=text;
      }
    }catch{for(const p of selected)p.ocrStatus='failed';}
  }
  const total=Number.isInteger(parsed.totalPages)&&parsed.totalPages!>=pages.length?parsed.totalPages!:null;
  const textPages=pages.filter(p=>nativeTextPresent(p.text));
  const sampled=parsed.truncated===true||(total!==null&&total>pages.length);
  const truncatedPages=pages.filter(p=>p.textTruncated).map(p=>p.page);
  const coverage={totalPages:total,selectedPages:pages.map(p=>p.page),textPages:textPages.map(p=>p.page),
    unassessedPages:total===null?null:Math.max(0,total-pages.length),ocrRequiredPages:needs.map(p=>p.page),
    ocrReviewPages:pages.filter(p=>p.ocrStatus==='review_ready').map(p=>p.page),textTruncatedPages:truncatedPages,
    byteLength:response.bytes.byteLength,byteLimit,sampling:'all_or_bounded_sample' as const};
  const allText=pages.map(p=>p.text).join('\n\n');
  // Keep OCR strictly separate: no machine-recognized text in digital text claims.
  const status:ScrapeCore['status']=!pages.length?'failed':!textPages.length?'needs_ocr':sampled||needs.length||truncatedPages.length||allText.length>90000?'partial':'completed';
  const warnings:string[]=[];
  if(sampled)warnings.push('Document page limit reached; remaining pages not inspected');
  if(needs.length)warnings.push('Pages with little native text require OCR review: '+needs.map(p=>p.page).join(', '));
  if(coverage.ocrReviewPages.length)warnings.push('OCR candidates are review-only and excluded from native evidence');
  if(truncatedPages.length||allText.length>90000)warnings.push('PDF text reached extraction limits');
  const reason=status==='needs_ocr'?'PDF has little extractable native text; OCR review required':
    'Extracted native text on '+textPages.length+' of '+pages.length+' sampled PDF pages'+(total===null?'':' ('+total+' total)');
  return {strategy:'S03',status,reason,sourceUrl:response.url,content:{text:allText.slice(0,90000),pdfPages:pages,pdfCoverage:coverage},evidence:textPages.slice(0,15).map(p=>({sourceUrl:response.url,locator:'PDF page '+p.page,excerpt:p.text.trim().slice(0,210),method:'S03' as const})),warnings};
}
