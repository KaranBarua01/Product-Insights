/* S02 is runtime neutral. Browser implementations are injected by the host platform. */
import type {Dependencies,ExecutionPolicy,ScrapeCore} from './types.js';
import {assertAllowed} from './safety.js';
import {parseHtml} from './html.js';
export async function scrapeS02(url:string,deps:Dependencies,policy:ExecutionPolicy):Promise<ScrapeCore>{
  const safe=assertAllowed(url,policy.allowedHosts);
  if(!deps.browser)return {strategy:'S02',status:'unsupported',reason:'No browser adapter configured; use --browser playwright on Node or an optional Worker binding',sourceUrl:safe.href,content:{},evidence:[],warnings:[]};
  const output=await deps.browser(safe.href,policy.allowedHosts,policy.robotsRules);
  assertAllowed(output.url,policy.allowedHosts,safe.hostname);
  const parsed=parseHtml(output.html,output.url,'S02');
  const length=(parsed.content.text||'').trim().length;
  return {strategy:'S02',status:length?'completed':'partial',reason:`Rendered HTML (${length} text chars)`,sourceUrl:output.url,content:parsed.content,evidence:parsed.evidence,warnings:[...parsed.warnings,...(output.truncated?['Browser HTML truncated at adapter byte limit']:[]),...(length<180?['Browser rendered insufficient primary text']:[])]};
}
