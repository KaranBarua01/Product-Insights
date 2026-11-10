import type {Dependencies,ExecutionPolicy,ScrapeCore} from './types.js';
import {assertAllowed,robotsAllowed} from './safety.js';
import {parseHtml} from './html.js';
export async function scrapeS02(url:string,dependencies:Dependencies,policy:ExecutionPolicy):Promise<ScrapeCore>{
  const safe=assertAllowed(url,policy.allowedHosts);
  if(!dependencies.browser)return {strategy:'S02',status:'unsupported',reason:'Cloudflare Browser Run binding not configured',sourceUrl:safe.href,content:{},evidence:[],warnings:[]};
  const output=await dependencies.browser(safe.href,policy.allowedHosts,policy.robotsRules);
  assertAllowed(output.url,policy.allowedHosts,safe.hostname);
  const parsed=parseHtml(output.html,output.url,'S02');
  const len=(parsed.content.text||'').length;
  return {strategy:'S02',status:len?'completed':'partial',reason:`Rendered HTML (${len} text chars)`,sourceUrl:output.url,content:parsed.content,evidence:parsed.evidence,warnings:[...parsed.warnings,...(!len?['Browser loaded but no visible text was extracted']:[])]};
}
/* Browser implementation is injected only when MYBROWSER exists.
   Request interception blocks third-party resources and redirects to unapproved hosts.
   This is a prototype, not a complete defense against DNS rebinding or browser networking exploits. */
export function cloudflareBrowserCapture(binding:unknown){
  return async (raw:string,hosts:readonly string[],robotsRules='')=>{
    const validated=assertAllowed(raw,hosts);
    const module=await import('@cloudflare/puppeteer');
    const puppeteer=module.default;
    const browser=await puppeteer.launch(binding);
    try{
      const page=await browser.newPage();
      try{
        await page.setRequestInterception(true);
        page.on('request',(req: {url:()=>string;continue:()=>Promise<unknown>;abort:()=>Promise<unknown>})=>{
          let allowed=false;
          try{const u=assertAllowed(req.url(),hosts,validated.hostname);allowed=['http:','https:'].includes(u.protocol) && robotsAllowed(robotsRules,u.pathname+u.search)}catch{allowed=false}
          void (allowed?req.continue():req.abort()).catch(()=>{});
        });
        await page.goto(validated.href,{waitUntil:'domcontentloaded',timeout:10_000});
        // One bounded interaction, never an infinite catalog crawl.
        const label=await page.evaluate(()=>{
          const candidate=Array.from(document.querySelectorAll('button,[role="button"]')).find(el=>/^(load more|show more|view more)$/i.test((el.textContent||'').trim()));
          return candidate ? Array.from(document.querySelectorAll('button,[role="button"]')).indexOf(candidate) : -1;
        });
        if(label>=0){try{await page.evaluate((i:number)=>{(document.querySelectorAll('button,[role="button"]')[i] as HTMLElement | undefined)?.click()},label);await new Promise(r=>setTimeout(r,600));}catch{/* optional interaction */}}
        const finalUrl=page.url();assertAllowed(finalUrl,hosts,validated.hostname);
        const html=(await page.content()).slice(0,260_000);
        return {html,url:finalUrl};
      }finally{await page.close()}
    }finally{await browser.close()}
  };
}
