/** Optional Playwright browser adapter. Works on Windows, Linux, macOS, Docker or via CDP. */
import {assertAllowed,robotsAllowed} from '../dist/safety.js';

export function createPlaywrightBrowserCapture(options={}) {
  const cdpUrl=options.cdpUrl || process.env.PLAYWRIGHT_CDP_URL || '';
  const executablePath=options.executablePath || process.env.PLAYWRIGHT_CHROMIUM_PATH || '';
  return async function capture(raw,allowedHosts,robotsRules='') {
    const target=assertAllowed(raw,allowedHosts);
    let chromium;
    try {({chromium}=await import('playwright'));}
    catch {throw new Error('Playwright not installed. Run npm install and npx playwright install chromium (or configure PLAYWRIGHT_CDP_URL).');}
    const browser=cdpUrl
      ? await chromium.connectOverCDP(cdpUrl,{timeout:10_000})
      : await chromium.launch({headless:true,timeout:10_000,...(executablePath?{executablePath}:{})});
    try {
      const context=await browser.newContext({userAgent:'InsideJobScrappersPrototype/0.2',viewport:{width:1280,height:900},serviceWorkers:'block',acceptDownloads:false});
      try {
        await context.route('**/*',async route=>{
          const req=route.request();let permitted=false;
          try {
            const u=assertAllowed(req.url(),allowedHosts,target.hostname);
            permitted=robotsAllowed(robotsRules,u.pathname+u.search);
            // Avoid expensive downloads; block off-host scripts/resources by default.
            if(['image','media','font','websocket'].includes(req.resourceType()))permitted=false;
          }catch{/* deny unapproved URL */}
          try {if(permitted)await route.continue();else await route.abort();}catch{/* navigation may close */}
        });
        const page=await context.newPage();
        try {
          await page.goto(target.href,{waitUntil:'domcontentloaded',timeout:12_000});
          await page.waitForTimeout(800);
          const more=page.getByRole('button',{name:/^(load more|show more|view more)$/i}).first();
          if(await more.count()){try{await more.click({timeout:1000});await page.waitForTimeout(700)}catch{/* optional single interaction */}}
          const finalUrl=page.url();assertAllowed(finalUrl,allowedHosts,target.hostname);
          const html=await page.content();
          return {url:finalUrl,html:html.slice(0,1_500_000),truncated:html.length>1_500_000};
        }finally{await page.close();}
      }finally{await context.close();}
    }finally{await browser.close();}
  };
}
