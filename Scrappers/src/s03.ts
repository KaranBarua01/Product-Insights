import type {Dependencies,ExecutionPolicy,PdfParserOutput,ScrapeCore} from './types.js';
import {assertAllowed,documentLooksPdf,fetchBounded} from './safety.js';
export async function unpdfParser(bytes:Uint8Array,maxPages:number):Promise<PdfParserOutput>{
  const {getDocumentProxy}=await import('unpdf');
  const doc=await getDocumentProxy(new Uint8Array(bytes),{maxImageSize:16_777_216});
  try{
    if(doc.numPages<1)throw Error('PDF declares no pages');
    const count=Math.min(Math.max(1,Math.floor(maxPages)),doc.numPages);
    const pages:PdfParserOutput['pages']=[];
    for(let n=1;n<=count;n++){
      const page=await doc.getPage(n);
      const textContent=await page.getTextContent();
      const text=textContent.items.map(item=>'str' in item?item.str:'').filter(Boolean).join(' ').trim();
      pages.push({page:n,text:text.slice(0,12_000)});
    }
    return {pageCount:count,totalPages:doc.numPages,truncated:doc.numPages>count,pages};
  }finally{await (doc as unknown as {destroy?:()=>Promise<unknown>|unknown}).destroy?.();}
}
export async function scrapeS03(url:string,dependencies:Dependencies,policy:ExecutionPolicy,maxPages=8):Promise<ScrapeCore>{
  const safe=assertAllowed(url,policy.allowedHosts);
  const response=await fetchBounded(safe.href,policy.allowedHosts,dependencies.fetcher,{timeoutMs:policy.timeoutMs??7000,maxBytes:policy.maxBytesPdf??3_000_000,robotsRules:policy.robotsRules},'application/pdf');
  if(response.status>=400)return {strategy:'S03',status:response.status===403||response.status===429?'blocked':'failed',reason:`HTTP ${response.status}`,sourceUrl:response.url,content:{},evidence:[],warnings:[]};
  if(!documentLooksPdf(response.bytes,response.type,response.url))return {strategy:'S03',status:'unsupported',reason:'Not a PDF response',sourceUrl:response.url,content:{},evidence:[],warnings:[]};
  if(response.bytes.length<5 || String.fromCharCode(...response.bytes.slice(0,5))!=='%PDF-')return {strategy:'S03',status:'failed',reason:'Invalid PDF signature',sourceUrl:response.url,content:{},evidence:[],warnings:[]};
  const parser=dependencies.pdfParser??unpdfParser;
  const parsed=await parser(response.bytes,Math.max(1,Math.min(15,Math.floor(maxPages))));
  const allText=parsed.pages.map(p=>p.text).join('\n\n');
  const needsOcr=allText.replace(/\s/g,'').length<30;
  const truncated=parsed.truncated===true||((parsed.totalPages??parsed.pageCount)>parsed.pageCount);
  const status:ScrapeCore['status']=truncated?'partial':needsOcr?'needs_ocr':'completed';
  const reason=truncated
    ? 'Read first '+parsed.pageCount+' of '+(parsed.totalPages??'?')+' PDF pages; remaining pages not assessed'
    : needsOcr?'PDF has little extractable text; OCR may be required'
    : 'Extracted '+parsed.pageCount+' text page(s)';
  return {strategy:'S03',status,reason,sourceUrl:response.url,content:{text:allText.slice(0,30_000),pdfPages:parsed.pages},evidence:parsed.pages.filter(p=>p.text.trim()).slice(0,12).map(p=>({sourceUrl:response.url,locator:`PDF page ${p.page}`,excerpt:p.text.trim().slice(0,210),method:'S03' as const})),warnings:[...(truncated?['Document page limit reached; remaining pages not inspected']:[]),...(needsOcr?['No useful text in sampled pages; OCR not configured, no text was invented']:[])]};
}
