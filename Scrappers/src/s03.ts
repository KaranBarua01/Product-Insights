import type {Dependencies,ExecutionPolicy,PdfParserOutput,ScrapeCore} from './types.js';
import {assertAllowed,documentLooksPdf,fetchBounded} from './safety.js';
export async function unpdfParser(bytes:Uint8Array,maxPages:number):Promise<PdfParserOutput>{
  const {getDocumentProxy,extractText}=await import('unpdf');
  const doc=await getDocumentProxy(new Uint8Array(bytes),{maxImageSize:16_777_216});
  try{
    if(doc.numPages>maxPages)throw new Error(`PDF page budget exceeded: ${doc.numPages} > ${maxPages}`);
    const result=await extractText(doc,{mergePages:false});
    const pages=Array.isArray(result.text)?result.text:[result.text];
    return {pageCount:doc.numPages,pages:pages.map((text:string,i:number)=>({page:i+1,text:String(text||'').slice(0,12_000)}))};
  }finally{await (doc as unknown as {destroy?:()=>Promise<unknown>|unknown}).destroy?.()}
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
  return {strategy:'S03',status:needsOcr?'needs_ocr':'completed',reason:needsOcr?'PDF has little extractable text; OCR required':`Extracted ${parsed.pageCount} text page(s)`,sourceUrl:response.url,content:{text:allText.slice(0,30_000),pdfPages:parsed.pages},evidence:parsed.pages.filter(p=>p.text.trim()).slice(0,12).map(p=>({sourceUrl:response.url,locator:`PDF page ${p.page}`,excerpt:p.text.trim().slice(0,210),method:'S03' as const})),warnings:needsOcr?['OCR not configured in this prototype; no text was invented']:[]};
}
