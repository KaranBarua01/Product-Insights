import type {Dependencies,ExecutionPolicy,ExtractRequest,PatternAnalysis,ScrapeCore,ScrapeResult,Strategy} from './types.js';
import {assertAllowed,assertRobots,describeAccessFailure,isAccessPolicyStop} from './safety.js';
import {chooseStrategy} from './router.js';
import {scrapeS01} from './s01.js';
import {scrapeS02} from './s02.js';
import {scrapeS03} from './s03.js';
function catalogNavigationScore(result:ScrapeCore):number{
  const links=result.content.links??[];
  const useful=new Set(links.filter(l=>/\b(?:products?|catalog(?:ue)?|collections|categories|models?|series|datasheets?|manuals?)\b/i.test(l.url+' '+l.label)&&!/\b(?:login|checkout|contact|request-quote|request-demo|preview|cart)\b/i.test(l.url)).map(l=>l.url));
  const structured=(result.content.jsonLd??[]).some(x=>/"@type"\s*:\s*"Product(?:Group)?"/i.test(JSON.stringify(x)));
  return Math.min(30,useful.size)+(structured?10:0);
}
export async function extract(request:ExtractRequest,deps:Dependencies,policy:ExecutionPolicy,provenance:'supplied'|'remote'|'local'|'none'='none'):Promise<ScrapeResult>{
  const url=assertAllowed(request.url,policy.allowedHosts);
  const route=chooseStrategy(request,request.patternAnalysis?provenance:'none');
  const output:ScrapeResult={schemaVersion:'0.1',requestedUrl:url.href,sourceUrl:url.href,strategy:route.strategy,status:'failed',reason:'Not attempted',content:{},evidence:[],warnings:[],attempts:[],routing:route};
  let robotsRules='';try{robotsRules=await assertRobots(url,policy.allowedHosts,deps.fetcher,policy.timeoutMs??6500)}
  catch(e){output.status='blocked';output.reason=`Access policy: ${describeAccessFailure(e)}`;return output}
  const now=deps.now??Date.now,boundedPolicy={...policy,robotsRules};
  const perform=async(s:Strategy):Promise<ScrapeCore>=>{
    const start=now();let result:ScrapeCore;
    try{
      if(s==='S01')result=await scrapeS01(url.href,deps,boundedPolicy);
      else if(s==='S02')result=await scrapeS02(url.href,deps,boundedPolicy);
      else result=await scrapeS03(url.href,deps,boundedPolicy,request.maxPdfPages??8);
    }catch(e){result={strategy:s,status:isAccessPolicyStop(e)?'blocked':'failed',reason:describeAccessFailure(e),sourceUrl:url.href,content:{},evidence:[],warnings:[]}}
    output.attempts.push({strategy:s,status:result.status,reason:result.reason,durationMs:Math.max(0,now()-start)});
    return result;
  };
  let result=await perform(route.strategy);
  const auto=!request.mode||request.mode==='auto';
  if(auto){
    if(result.next==='S03'&&route.strategy!=='S03')result=await perform('S03');
    else if(route.strategy==='S02'&&['unsupported','failed'].includes(result.status)){
      output.warnings.push('Browser unavailable/failed; trying bounded HTTP fallback');result=await perform('S01');
    }else if(route.strategy==='S01'&&result.next==='S02'&&deps.browser){
      const browser=await perform('S02');
      if(browser.status==='blocked')result=browser;
      else if(['completed','partial'].includes(browser.status)&&((browser.content.text?.length??0)>(result.content.text?.length??0)||
        catalogNavigationScore(browser)>catalogNavigationScore(result)))result=browser;
      else output.warnings.push('Browser produced no richer content or catalog navigation; kept HTTP response');
    }
  }
  return {...output,sourceUrl:result.sourceUrl,strategy:result.strategy,status:result.status,reason:result.reason,content:result.content,evidence:result.evidence,warnings:[...output.warnings,...result.warnings]};
}
export function limitedPatternAnalysis(value:unknown):PatternAnalysis|undefined{
  if(!value||typeof value!=='object'||!('assessments' in value))return undefined;
  const entries=(value as {assessments?:unknown}).assessments;
  if(!Array.isArray(entries)||entries.length>60)return undefined;
  const assessments=entries.filter((a):a is {patternId:string;status:PatternAnalysis['assessments'][number]['status']}=>a!==null&&typeof a==='object'&&typeof a.patternId==='string'&&/^[A-Z][0-9]{2}$/.test(a.patternId)&&['observed','lead','not_observed','not_assessed'].includes(a.status));
  return {assessments};
}
