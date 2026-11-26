/* S02 is runtime neutral. Browser implementations are injected by the host platform. */
import type {Dependencies,ExecutionPolicy,ScrapeCore} from './types.js';
import {assertAllowed} from './safety.js';
import {parseHtml} from './html.js';
export async function scrapeS02(url:string,deps:Dependencies,policy:ExecutionPolicy):Promise<ScrapeCore>{
  const safe=assertAllowed(url,policy.allowedHosts);
  if(!deps.browser)return {strategy:'S02',status:'unsupported',reason:'No browser adapter configured; use --browser playwright on Node or an optional Worker binding',sourceUrl:safe.href,content:{},evidence:[],warnings:[]};
  const output=await deps.browser(safe.href,policy.allowedHosts,policy.robotsRules);
  assertAllowed(output.url,policy.allowedHosts,safe.hostname);
  if(output.httpStatus!==undefined&&output.httpStatus>=400)return {strategy:'S02',status:[401,403,429,503].includes(output.httpStatus)?'blocked':'failed',reason:`HTTP ${output.httpStatus} during browser capture; no bypass attempted`,sourceUrl:output.url,content:{},evidence:[],warnings:[]};
  const parsed=parseHtml(output.html,output.url,'S02');
  const challenge=/^(?:just a moment|attention required|access denied|bot verification|security check)/i.test((parsed.content.title??'').trim());
  const challengeBody=(parsed.content.text??'').length<1400&&/checking your browser|verify you are human|enable javascript and cookies to continue|captcha challenge|access denied\s*\(\s*error\s*\d+/i.test(parsed.content.text??'');
  if(challenge||challengeBody)return {strategy:'S02',status:'blocked',reason:'Browser rendered access challenge; no bypass attempted',sourceUrl:output.url,content:{},evidence:[],warnings:[]};
  const length=(parsed.content.text||'').trim().length;
  return {strategy:'S02',status:length?'completed':'partial',reason:`Rendered HTML (${length} text chars)`,sourceUrl:output.url,content:parsed.content,evidence:parsed.evidence,warnings:[...parsed.warnings,...(output.truncated?['Browser HTML truncated at adapter byte limit']:[]),...(length<180?['Browser rendered insufficient primary text']:[])]};
}
