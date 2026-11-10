/* OPTIONAL Cloudflare adapter. Not part of the Node.js dependency graph.
   To deploy the Cloudflare Worker, install a supported @cloudflare/puppeteer release separately. */
import {assertAllowed,robotsAllowed} from './safety.js';
export function cloudflareBrowserCapture(binding:unknown){
  return async(raw:string,hosts:readonly string[],rules='')=>{
    const validated=assertAllowed(raw,hosts);
    const module=await import('@cloudflare/puppeteer');const browser=await module.default.launch(binding);
    try{
      const page=await browser.newPage();
      try{
        await page.setRequestInterception(true);
        page.on('request',(req:{url:()=>string;continue:()=>Promise<unknown>;abort:()=>Promise<unknown>})=>{
          let allowed=false;
          try{const u=assertAllowed(req.url(),hosts,validated.hostname);allowed=robotsAllowed(rules,u.pathname+u.search)}catch{/* blocked */}
          void (allowed?req.continue():req.abort()).catch(()=>{});
        });
        await page.goto(validated.href,{waitUntil:'domcontentloaded',timeout:12_000});
        const label=await page.evaluate(()=>Array.from(document.querySelectorAll('button,[role="button"]')).findIndex(el=>/^(load more|show more|view more)$/i.test((el.textContent||'').trim())));
        if(label>=0){try{await page.evaluate((i:number)=>{(document.querySelectorAll('button,[role="button"]')[i] as HTMLElement | undefined)?.click()},label);await new Promise(r=>setTimeout(r,600))}catch{/* optional */}}
        const finalUrl=page.url();assertAllowed(finalUrl,hosts,validated.hostname);
        return {url:finalUrl,html:(await page.content()).slice(0,1_250_000)};
      }finally{await page.close()}
    }finally{await browser.close()}
  };
}
