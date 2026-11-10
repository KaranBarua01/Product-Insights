import type {Dependencies,ExecutionPolicy,ExtractedContent,ExtractionEvidence,ScrapeCore,SourcePage} from './types.js';
import {assertAllowed,documentLooksPdf,fetchBounded} from './safety.js';
import {parseHtml} from './html.js';

const BAD_PATH=/(?:\/login|\/cart|\/checkout|\/account|\/privacy|\/terms|\/careers|\/contact|\/search\?)/i;
const GOOD_PATH=/(?:products?|catalog|categor(?:y|ies)|capabilit|manufactur|process|industr|solutions?|services?|technolog|materials?|about)/i;
function rankLink(link:{url:string;label:string}):number{
  const path=new URL(link.url).pathname;
  if(BAD_PATH.test(link.url)||/\.(?:pdf|png|jpg|jpeg|webp|zip|xls|xlsx|doc|docx)$/i.test(path))return -1;
  const evidence=path+' '+link.label;
  const score=GOOD_PATH.test(evidence)?(/products?|catalog|categor(?:y|ies)/i.test(evidence)?6:3):0;
  const depth=path.split('/').filter(Boolean).length;
  return score+(depth>0&&depth<5?1:0);
}
export async function scrapeS01(url:string,deps:Dependencies,policy:ExecutionPolicy):Promise<ScrapeCore>{
  const safe=assertAllowed(url,policy.allowedHosts),maxPages=Math.min(4,Math.max(1,policy.maxHtmlPages??3));
  const maxBytes=Math.min(2_000_000,Math.max(100_000,policy.maxBytesHtml??1_250_000));
  const queue=[safe.href],visited=new Set<string>();
  const pages:SourcePage[]=[],textParts:string[]=[],links:NonNullable<ExtractedContent['links']>=[],documents:string[]=[],headings:string[]=[],jsonLd:unknown[]=[],appState:unknown[]=[],evidence:ExtractionEvidence[]=[],warnings:string[]=[];
  const linkSeen=new Set<string>(),documentSeen=new Set<string>(),seenText=new Set<string>();
  let firstTitle:string|undefined,firstDescription:string|undefined,firstUrl=safe.href,truncatedCount=0,fetchErrors=0;
  let pdfResponse=false;
  while(queue.length&&pages.length<maxPages){
    const next=queue.shift()!;if(visited.has(next))continue;visited.add(next);
    try{
      const fetched=await fetchBounded(next,policy.allowedHosts,deps.fetcher,{timeoutMs:policy.timeoutMs??7000,maxBytes,robotsRules:policy.robotsRules,truncate:true});
      if(pages.length===0&&[401,403,429,503].includes(fetched.status))return {strategy:'S01',status:'blocked',reason:`HTTP ${fetched.status}; no bypass attempted`,sourceUrl:fetched.url,content:{},evidence:[],warnings};
      if(fetched.status>=400){fetchErrors++;warnings.push(`Skipped ${new URL(next).pathname}: HTTP ${fetched.status}`);continue}
      if(documentLooksPdf(fetched.bytes,fetched.type,fetched.url)){
        if(pages.length===0)pdfResponse=true;
        else warnings.push('PDF encountered during HTML discovery; request S03 for that document');
        continue;
      }
      const start=new TextDecoder('utf-8',{fatal:false}).decode(fetched.bytes.slice(0,160));
      if(!/html|text\/plain/i.test(fetched.type)&&!/\s*<(!doctype|html)/i.test(start)){
        fetchErrors++;warnings.push(`Skipped unsupported content-type at ${next}: ${fetched.type||'unknown'}`);continue;
      }
      const parsed=parseHtml(new TextDecoder('utf-8',{fatal:false}).decode(fetched.bytes),fetched.url,'S01');
      const content=parsed.content;
      if(pages.length===0){firstTitle=content.title;firstDescription=content.description;firstUrl=fetched.url}
      const text=(content.text??'').trim();pages.push({url:fetched.url,title:content.title,textChars:text.length,truncated:fetched.truncated});
      if(text&&!seenText.has(text)){textParts.push(text);seenText.add(text)}
      else if(text)warnings.push(`Duplicate visible text found at ${fetched.url}; not counted twice`);
      if(fetched.truncated){truncatedCount++;warnings.push(`HTML truncated at ${maxBytes} bytes: ${fetched.url}`)}
      warnings.push(...parsed.warnings);evidence.push(...parsed.evidence);
      for(const h of content.headings??[])if(!headings.includes(h)&&headings.length<70)headings.push(h);
      for(const link of content.links??[])if(!linkSeen.has(link.url)&&links.length<160){linkSeen.add(link.url);links.push(link)}
      for(const doc of content.documents??[])if(!documentSeen.has(doc)&&documents.length<35){documentSeen.add(doc);documents.push(doc)}
      jsonLd.push(...(content.jsonLd??[]).slice(0,16-jsonLd.length));appState.push(...(content.appState??[]).slice(0,4-appState.length));
      // Only same-host, already-observed HTML links are candidates. No exhaustive crawling.
      if(pages.length<maxPages&&queue.length<maxPages*2){
        const candidates=(content.links??[]).filter(l=>{
          try{const u=assertAllowed(l.url,policy.allowedHosts,safe.hostname);return !visited.has(u.href)&&!queue.includes(u.href)&&rankLink(l)>=3}catch{return false}
        }).sort((a,b)=>rankLink(b)-rankLink(a));
        for(const link of candidates.slice(0,maxPages*2)){if(queue.length>=maxPages*2)break;queue.push(link.url)}
      }
    }catch(err){fetchErrors++;warnings.push(`Page ${next} failed: ${String(err instanceof Error?err.message:err)}`)}
  }
  if(pdfResponse)return {strategy:'S01',status:'unsupported',reason:'PDF response; delegate to S03',sourceUrl:firstUrl,content:{},evidence:[],warnings,next:'S03'};
  const text=textParts.join('\n\n').slice(0,65_000);
  if(!pages.length)return {strategy:'S01',status:'failed',reason:warnings[0]||'No HTML pages could be retrieved',sourceUrl:firstUrl,content:{},evidence:[],warnings};
  const allTruncated=truncatedCount===pages.length;
  const sparse=text.trim().length<180;
  const status:ScrapeCore['status']=allTruncated||text.trim().length<40?'partial':'completed';
  const reason=`Inspected ${pages.length} HTML page(s), ${text.length} text chars, ${truncatedCount} truncated, ${fetchErrors} failed`;
  const content:ExtractedContent={title:firstTitle,description:firstDescription,text,headings,links,documents,jsonLd,appState,sampledPages:pages};
  return {strategy:'S01',status,reason,sourceUrl:firstUrl,content,evidence,warnings,...(sparse||allTruncated?{next:'S02' as const}:{})};
}
