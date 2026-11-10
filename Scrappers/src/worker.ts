import type {ExtractRequest,Mode,PatternAnalysis} from './types.js';
import {extract,limitedPatternAnalysis} from './engine.js';
import {normalizeAllowedHosts,assertAllowed} from './safety.js';
import {cloudflareBrowserCapture} from './s02.js';
interface Env {
  SCRAPPERS_API_TOKEN?:string;
  ALLOWED_HOSTS?:string;
  MYBROWSER?:unknown;
  PATTERN_API_URL?:string;
  PATTERN_API_TOKEN?:string;
}
const json=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const validModes:Mode[]=['auto','S01','S02','S03'];
async function remotePatterns(url:string,env:Env):Promise<PatternAnalysis|undefined>{
  if(!env.PATTERN_API_URL||!env.PATTERN_API_TOKEN)return undefined;
  const endpoint=new URL('/api/analyze',env.PATTERN_API_URL);
  if(endpoint.protocol!=='https:')throw Error('PATTERN_API_URL must be HTTPS');
  const response=await fetch(endpoint.href,{method:'POST',headers:{Authorization:`Bearer ${env.PATTERN_API_TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify({url,maxPages:2}),signal:AbortSignal.timeout(12_000)});
  if(!response.ok)throw Error(`Pattern API HTTP ${response.status}`);
  const size=Number(response.headers.get('content-length')||0);
  if(size>200_000)throw Error('Pattern API response too large');
  const payload=await response.text();if(payload.length>200_000)throw Error('Pattern API response too large');
  return limitedPatternAnalysis(JSON.parse(payload));
}
export default {
  async fetch(request:Request,env:Env):Promise<Response>{
    const url=new URL(request.url);
    if(request.method==='GET' && url.pathname==='/health')return json({module:'scrappers',version:'0.1',strategies:['S01','S02','S03'],configured:{allowlist:!!env.ALLOWED_HOSTS,token:!!env.SCRAPPERS_API_TOKEN,browser:!!env.MYBROWSER,patternApi:!!env.PATTERN_API_URL}});
    if(request.method==='GET' && url.pathname==='/api/strategies')return json({strategies:{S01:'Bounded HTTP/HTML + JSON-LD + app state',S02:'Cloudflare Browser Run (when binding exists)',S03:'Bounded PDF text extraction; scanned PDFs flagged for OCR'},note:'No bulk crawling, no access-control bypass, no JS1–JS10 inference'});
    if(request.method!=='POST'||url.pathname!=='/api/extract')return json({error:'Not found'},404);
    if(!env.SCRAPPERS_API_TOKEN||request.headers.get('authorization')!==`Bearer ${env.SCRAPPERS_API_TOKEN}`)return json({error:'Unauthorized'},401);
    const len=Number(request.headers.get('content-length')??0);if(Number.isFinite(len)&&len>9000)return json({error:'Request too large'},413);
    let body:Record<string,unknown>;
    try{const raw=await request.text();if(raw.length>9000)return json({error:'Request too large'},413);body=JSON.parse(raw);if(!body||typeof body!=='object'||Array.isArray(body))throw Error('Object required');}
    catch{return json({error:'Expected JSON object'},400)}
    if(typeof body.url!=='string'||body.url.length>2048)return json({error:'url must be an absolute HTTP(S) URL'},400);
    if(body.mode!==undefined && !validModes.includes(body.mode as Mode))return json({error:'Invalid mode'},400);
    if(body.maxPdfPages!==undefined && (!Number.isInteger(body.maxPdfPages)||Number(body.maxPdfPages)<1||Number(body.maxPdfPages)>15))return json({error:'maxPdfPages must be 1–15'},400);
    let allowedHosts:string[];
    try{allowedHosts=normalizeAllowedHosts(env.ALLOWED_HOSTS??'');assertAllowed(body.url,allowedHosts);}catch(e){return json({error:String(e instanceof Error?e.message:e)},400);}
    const supplied=body.patternAnalysis===undefined?undefined:limitedPatternAnalysis(body.patternAnalysis);
    if(body.patternAnalysis!==undefined&&!supplied)return json({error:'Invalid patternAnalysis payload'},400);
    let patternAnalysis=supplied;
    let provenance:'supplied'|'remote'|'none'=supplied?'supplied':'none';
    let warning:string|undefined;
    if(!patternAnalysis&&env.PATTERN_API_URL){try{patternAnalysis=await remotePatterns(body.url,env);if(patternAnalysis)provenance='remote';}catch(e){warning='Pattern API unavailable; conservative HTTP-first routing: '+String(e instanceof Error?e.message:e);}}
    const payload:ExtractRequest={url:body.url,mode:body.mode as Mode|undefined,patternAnalysis,maxPdfPages:body.maxPdfPages as number|undefined};
    const result=await extract(payload,{fetcher:fetch,...(env.MYBROWSER?{browser:cloudflareBrowserCapture(env.MYBROWSER)}:{})},{allowedHosts},provenance);
    if(warning)result.warnings.unshift(warning);
    return json(result);
  }
};
