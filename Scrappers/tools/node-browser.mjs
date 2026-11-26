/** Optional Playwright browser adapter. Works on Windows, Linux, macOS, Docker or via CDP. */
import {assertAllowed,robotsAllowed} from '../dist/safety.js';
import {assertPublicDns} from './research-lab-security.mjs';

export function createPlaywrightBrowserCapture(options={}) {
  const cdpUrl=options.cdpUrl || process.env.PLAYWRIGHT_CDP_URL || '';
  const executablePath=options.executablePath || process.env.PLAYWRIGHT_CHROMIUM_PATH || '';
  const headless=options.headless!==false;
  const slowMoMs=Number.isInteger(options.slowMoMs)?Math.max(0,Math.min(500,options.slowMoMs)):0;
  const inspectHoldMs=Number.isInteger(options.inspectHoldMs)?Math.max(0,Math.min(5000,options.inspectHoldMs)):0;
  return async function capture(raw,allowedHosts,robotsRules='') {
    const target=assertAllowed(raw,allowedHosts);
    // Preflight is not a DNS-pinned browser sandbox. This adapter remains for
    // operator-approved local/CI research only, not the universal remote agent.
    await assertPublicDns(target.hostname);
    let chromium;
    try {({chromium}=await import('playwright'));}
    catch {throw new Error('Playwright not installed. Run npm install and npx playwright install chromium (or configure PLAYWRIGHT_CDP_URL).');}
    const browser=cdpUrl
      ? await chromium.connectOverCDP(cdpUrl,{timeout:10_000})
      : await chromium.launch({headless,slowMo:slowMoMs,timeout:10_000,...(executablePath?{executablePath}:{})});
    try {
      const context=await browser.newContext({userAgent:'InsideJobScrappersPrototype/0.2',viewport:{width:1280,height:900},serviceWorkers:'block',acceptDownloads:false});
      try {
        await context.route('**/*',async route=>{
          const req=route.request();let permitted=false;
          try {
            const u=assertAllowed(req.url(),allowedHosts,target.hostname);
            permitted=['GET','HEAD'].includes(req.method())&&!(target.protocol==='https:'&&u.protocol!=='https:')&&robotsAllowed(robotsRules,u.pathname+u.search);
            if(permitted&&/(?:^|\/)(?:login|logout|checkout|cart|subscribe|request-quote|request-demo|forms?)(?:\/|$)/i.test(u.pathname))permitted=false;
            if(permitted)await assertPublicDns(u.hostname);
            // Avoid expensive downloads; block off-host scripts/resources by default.
            if(['image','media','font','websocket'].includes(req.resourceType()))permitted=false;
          }catch{/* deny unapproved URL */}
          try {if(permitted)await route.continue();else await route.abort();}catch{/* navigation may close */}
        });
        const page=await context.newPage();
        try {
          const response=await page.goto(target.href,{waitUntil:'domcontentloaded',timeout:12_000});
          const httpStatus=response?.status();
          // No clicks or form submissions; render the approved public page only.
          if(httpStatus===undefined||httpStatus<400)await page.waitForTimeout(800);
          const finalUrl=page.url();assertAllowed(finalUrl,allowedHosts,target.hostname);
          const html=await page.content();
          if(!headless&&inspectHoldMs)await page.waitForTimeout(inspectHoldMs);
          return {url:finalUrl,html:html.slice(0,1_500_000),truncated:html.length>1_500_000,httpStatus};
        }finally{await page.close();}
      }finally{await context.close();}
    }finally{await browser.close();}
  };
}