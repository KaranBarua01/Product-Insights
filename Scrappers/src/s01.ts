import type {Dependencies,ExecutionPolicy,ScrapeCore} from './types.js';
import {assertAllowed,documentLooksPdf,fetchBounded} from './safety.js';
import {parseHtml} from './html.js';
export async function scrapeS01(url:string,dependencies:Dependencies,policy:ExecutionPolicy):Promise<ScrapeCore>{
  const safe=assertAllowed(url,policy.allowedHosts);
  const result=await fetchBounded(safe.href,policy.allowedHosts,dependencies.fetcher,{timeoutMs:policy.timeoutMs??7000,maxBytes:policy.maxBytesHtml??520_000,robotsRules:policy.robotsRules});
  if([401,403,429,503].includes(result.status))return {strategy:'S01',status:'blocked',reason:`HTTP ${result.status}; no bypass attempted`,sourceUrl:result.url,content:{},evidence:[],warnings:[]};
  if(result.status>=400)return {strategy:'S01',status:'failed',reason:`HTTP ${result.status}`,sourceUrl:result.url,content:{},evidence:[],warnings:[]};
  if(documentLooksPdf(result.bytes,result.type,result.url))return {strategy:'S01',status:'unsupported',reason:'PDF response; delegate to S03',sourceUrl:result.url,content:{},evidence:[],warnings:[],next:'S03'};
  if(!/html|text\/plain/i.test(result.type) && !/^\s*<(!doctype|html)/i.test(new TextDecoder().decode(result.bytes.slice(0,150))))return {strategy:'S01',status:'unsupported',reason:`Unsupported content type: ${result.type || 'unknown'}`,sourceUrl:result.url,content:{},evidence:[],warnings:[]};
  const parsed=parseHtml(new TextDecoder('utf-8',{fatal:false}).decode(result.bytes),result.url,'S01');
  const textLength=(parsed.content.text||'').length;
  return {strategy:'S01',status:'completed',reason:`Parsed HTML (${textLength} text chars)`,sourceUrl:result.url,content:parsed.content,evidence:parsed.evidence,warnings:parsed.warnings,...(textLength<180?{next:'S02' as const}:{})};
}
