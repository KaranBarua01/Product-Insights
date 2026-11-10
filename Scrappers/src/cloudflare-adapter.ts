/** Cloudflare-only S02 adapter. The portable scraper core has no Cloudflare dependencies.
 * Browser Run Quick Actions are optional and require an explicit MYBROWSER binding.
 * Quick Actions do not expose the final navigation URL or support session guardrails;
 * use Node Playwright or a guarded browser session when strict provenance is required.
 */
import {assertAllowed, robotsAllowed} from './safety.js';

interface QuickActionBrowser {
  quickAction: (action:'content', options:Record<string,unknown>) => Promise<Response>;
}
const MAX_BROWSER_HTML_BYTES=1_250_000;

function asBinding(value:unknown):QuickActionBrowser {
  if(!value || typeof value!=='object' || !('quickAction' in value) || typeof value.quickAction!=='function') {
    throw new Error('Cloudflare Browser Run binding unavailable (configure MYBROWSER)');
  }
  return value as QuickActionBrowser;
}

function exactHostRegex(host:string):string {
  const escaped=host.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  return `/^https?:\\/\\/${escaped}(?::(?:80|443))?(?:[\\/?#]|$)/i`;
}

async function readHtmlPrefix(response:Response):Promise<{html:string;truncated:boolean}> {
  const reader=response.body?.getReader();
  if(!reader) return {html:'',truncated:false};
  const chunks:Uint8Array[]=[];let total=0;let truncated=false;
  try {
    while(true) {
      const {done,value}=await reader.read();
      if(done)break;
      const remaining=MAX_BROWSER_HTML_BYTES-total;
      if(value.byteLength>remaining) {
        if(remaining>0)chunks.push(value.subarray(0,remaining));
        total=MAX_BROWSER_HTML_BYTES;
        truncated=true;
        await reader.cancel();
        break;
      }
      chunks.push(value);total+=value.byteLength;
    }
  } finally {try{reader.releaseLock()}catch{/* no-op */}}
  const bytes=new Uint8Array(total);let at=0;
  for(const part of chunks){bytes.set(part,at);at+=part.byteLength;}
  return {html:new TextDecoder('utf-8',{fatal:false}).decode(bytes),truncated};
}

export function cloudflareBrowserCapture(binding:unknown){
  const browser=asBinding(binding);
  return async(raw:string,hosts:readonly string[],robotsRules='')=>{
    const target=assertAllowed(raw,hosts);
    if(!robotsAllowed(robotsRules,target.pathname+target.search))throw new Error('robots.txt disallows browser target');
    // Browser Run Quick Actions support request-regex allowlisting but not session guardrails.
    // Keep only the already approved hostname; no off-host redirects or dependencies.
    const response=await browser.quickAction('content',{
      url:target.href,
      allowRequestPattern:[exactHostRegex(target.hostname)],
      rejectResourceTypes:['image','media','font'],
      gotoOptions:{waitUntil:'domcontentloaded',timeout:10000},
      actionTimeout:10000,
      cacheTTL:0
    });
    if(!response.ok)throw new Error(`Cloudflare Browser Run HTTP ${response.status}`);
    const parsed=await readHtmlPrefix(response);
    // The Quick Action response does not provide the final browser URL.
    // This is the requested URL, not independently verified final-URL provenance.
    return {url:target.href,...parsed};
  };
}
