/* Deliberately allowlist-only. The host allowlist is NOT a DNS-level SSRF boundary. */
const AGENT='InsideJobScrappersPrototype/0.2 (+https://github.com/KaranBarua01/Product-Insights)';
export function validatePublicUrl(value:string):URL {
  let u:URL;try{u=new URL(value)}catch{throw new Error('Invalid absolute URL')}
  if(!['https:','http:'].includes(u.protocol))throw new Error('Only HTTP(S) URLs allowed');
  if(u.username||u.password)throw new Error('URL credentials forbidden');
  if(u.port&&!['80','443'].includes(u.port))throw new Error('Nonstandard ports forbidden');
  const h=u.hostname.toLowerCase().replace(/\.$/,'');
  if(/^\d+(?:\.\d+){3}$/.test(h)||h.startsWith('['))throw new Error('IP literals forbidden');
  if(!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(h))throw new Error('Public domain name required; IPs forbidden');
  if(/\.(?:local|internal|localhost|test|invalid|example)$/.test(h)||/(^|\.)(localhost|internal|local)$/.test(h))throw new Error('Reserved/local hostname forbidden');
  if(h.length>253||h.split('.').some(x=>x.length>63))throw new Error('Invalid hostname length');
  u.hash='';return u;
}
export function normalizeAllowedHosts(raw:string|readonly string[]):string[]{
  const items=typeof raw==='string'?raw.split(','):raw;
  return [...new Set(items.map(v=>v.trim().toLowerCase()).filter(Boolean).map(v=>{
    if(v.includes('/')||v.includes(':')||v.startsWith('*.'))throw new Error('ALLOWED_HOSTS accepts exact hostnames only');
    return validatePublicUrl('https://'+v).hostname;
  }))];
}
export function assertAllowed(raw:string,hosts:readonly string[],rootHost?:string):URL{
  const u=validatePublicUrl(raw);
  if(!hosts.length)throw new Error('ALLOWED_HOSTS is not configured');
  if(!hosts.includes(u.hostname))throw new Error('Host not on ALLOWED_HOSTS');
  if(rootHost&&u.hostname!==rootHost)throw new Error('Cross-host redirect denied');
  return u;
}
interface RobotsGroup {agents:string[];rules:{kind:'allow'|'disallow';path:string}[]}
function robotsGroups(text:string):RobotsGroup[]{
  const groups:RobotsGroup[]=[];let agents:string[]=[],rules:RobotsGroup['rules']=[];
  const push=()=>{if(agents.length)groups.push({agents,rules});agents=[];rules=[]};
  for(const line0 of text.split(/\r?\n/)){
    const line=line0.split('#')[0]?.trim()??'';
    const m=/^([a-z-]+)\s*:\s*(.*)$/i.exec(line);if(!m)continue;
    const key=m[1]?.toLowerCase(),value=m[2]?.trim()??'';
    if(key==='user-agent'){if(rules.length)push();agents.push(value.toLowerCase())}
    else if((key==='allow'||key==='disallow')&&agents.length)rules.push({kind:key,path:value});
  }
  push();return groups;
}
export function robotsAllowed(text:string,targetPath:string):boolean{
  const groups=robotsGroups(text),mine=groups.filter(g=>g.agents.some(a=>a!=='*'&&AGENT.toLowerCase().includes(a)));
  const active=(mine.length?mine:groups.filter(g=>g.agents.includes('*'))).flatMap(g=>g.rules);
  const matches=active.filter(r=>r.path&&new RegExp('^'+r.path.replace(/[.+?^${}()|[\]\\]/g,'\\$&').replace(/\*/g,'.*').replace(/\$$/,'$')).test(targetPath));
  matches.sort((a,b)=>b.path.length-a.path.length||(a.kind==='allow'?-1:1));
  return matches[0]?.kind!=='disallow';
}
export class ResponseLimitError extends Error{constructor(limit:number){super(`Response exceeds ${limit}-byte limit`);this.name='ResponseLimitError'}}
/** Stable access reasons: classify policy stops separately from transport failures. */
export type AccessFailureCode='redirect_policy'|'redirect_loop'|'redirect_limit'|'redirect_invalid'|'robots_denied'|'robots_unavailable'|'rate_limited'|'timeout'|'network_transient';
export class AccessFault extends Error{
  constructor(public readonly code:AccessFailureCode,message:string){super(message);this.name='AccessFault'}
}
export function describeAccessFailure(error:unknown):string{
  return error instanceof AccessFault?'['+error.code+'] '+error.message:String(error instanceof Error?error.message:error);
}
export function isAccessPolicyStop(error:unknown):boolean{
  return error instanceof AccessFault&&['redirect_policy','robots_denied','robots_unavailable','rate_limited'].includes(error.code);
}
function errorField(error:unknown,key:string):unknown{
  return error&&typeof error==='object'?(error as Record<string,unknown>)[key]:undefined;
}
function transientNetworkFailure(error:unknown):'timeout'|'network_transient'|null{
  // Retry only known transport failures; never retry policy exceptions or generic aborts.
  if(error instanceof AccessFault)return null;
  const cause=errorField(error,'cause');
  const code=String(errorField(error,'code')??errorField(cause,'code')??'');
  if(errorField(error,'name')==='TimeoutError'||errorField(cause,'name')==='TimeoutError'||['ETIMEDOUT','UND_ERR_CONNECT_TIMEOUT','UND_ERR_HEADERS_TIMEOUT','UND_ERR_BODY_TIMEOUT'].includes(code))return 'timeout';
  if(['ECONNRESET','EAI_AGAIN','UND_ERR_SOCKET'].includes(code))return 'network_transient';
  return null;
}
async function discardBody(response:Response):Promise<void>{
  try{await response.body?.cancel()}catch{/* best-effort disposal; never use redirect body */}
}
export interface BoundedResponse {url:string;status:number;type:string;bytes:Uint8Array;truncated:boolean}
export async function fetchBounded(raw:string,hosts:readonly string[],fetcher:typeof fetch,
  budget:{timeoutMs:number;maxBytes:number;rootHost?:string;robotsRules?:string;truncate?:boolean},
  accept='text/html,application/pdf;q=0.8,*/*;q=0.2'):Promise<BoundedResponse>{
  let target=raw;const original=assertAllowed(raw,hosts,budget.rootHost);
  const visited=new Set<string>();let retried=false;
  const maxBytes=Math.min(Math.max(budget.maxBytes,1),3_000_000);
  for(let redirects=0;redirects<4;redirects++){
    const url=assertAllowed(target,hosts,original.hostname);
    if(visited.has(url.href))throw new AccessFault('redirect_loop','Redirect loop detected');
    visited.add(url.href);
    if(budget.robotsRules!==undefined&&!robotsAllowed(budget.robotsRules,url.pathname+url.search))throw new AccessFault('robots_denied','robots.txt disallows redirect/request path');
    let response:Response;
    for(;;){
      try{
        response=await fetcher(url.href,{redirect:'manual',signal:AbortSignal.timeout(budget.timeoutMs),headers:{'User-Agent':AGENT,'Accept':accept}});
        break;
      }catch(error){
        const code=transientNetworkFailure(error);
        if(code&&!retried){retried=true;continue}
        if(code)throw new AccessFault(code,describeAccessFailure(error)+'; bounded transport retry exhausted');
        throw error;
      }
    }
    if([301,302,303,307,308].includes(response.status)){
      const location=response.headers.get('location');
      await discardBody(response);
      if(!location)throw new AccessFault('redirect_invalid','Redirect without Location');
      let candidate:URL;
      try{candidate=new URL(location,url)}catch{throw new AccessFault('redirect_invalid','Invalid redirect Location')}
      if(url.protocol==='https:'&&candidate.protocol!=='https:')throw new AccessFault('redirect_policy','HTTPS downgrade or non-HTTPS redirect denied');
      try{target=assertAllowed(candidate.href,hosts,original.hostname).href}
      catch(error){throw new AccessFault('redirect_policy','Redirect not followed: '+describeAccessFailure(error)+'; review and explicitly approve any new seed host')}
      continue;
    }
    const announced=Number(response.headers.get('content-length')||0);
    if(Number.isFinite(announced)&&announced>maxBytes&&!budget.truncate){await discardBody(response);throw new ResponseLimitError(maxBytes)}
    const reader=response.body?.getReader();if(!reader)return {url:url.href,status:response.status,type:response.headers.get('content-type')??'',bytes:new Uint8Array(),truncated:false};
    const chunks:Uint8Array[]=[];let total=0,truncated=false;
    try{
      while(true){
        const {done,value}=await reader.read();if(done)break;
        if(total+value.byteLength>maxBytes){
          if(!budget.truncate){await reader.cancel();throw new ResponseLimitError(maxBytes)}
          const take=maxBytes-total;if(take>0)chunks.push(value.subarray(0,take));total+=take;truncated=true;
          await reader.cancel();break;
        }
        chunks.push(value);total+=value.byteLength;
      }
    }finally{try{reader.releaseLock()}catch{/* noop */}}
    const bytes=new Uint8Array(total);let offset=0;
    for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength}
    return {url:url.href,status:response.status,type:response.headers.get('content-type')??'',bytes,truncated:truncated||(Number.isFinite(announced)&&announced>maxBytes)};
  }
  throw new AccessFault('redirect_limit','Redirect limit exceeded');
}
export async function assertRobots(url:URL,hosts:readonly string[],fetcher:typeof fetch,timeoutMs=6500):Promise<string>{
  let r:BoundedResponse;
  try{r=await fetchBounded(new URL('/robots.txt',url.origin).href,hosts,fetcher,{timeoutMs,maxBytes:64_000,rootHost:url.hostname},'text/plain')}
  catch(error){
    if(isAccessPolicyStop(error))throw error;
    throw new AccessFault('robots_unavailable','robots.txt could not be checked; no page request: '+describeAccessFailure(error));
  }
  if(r.status===404||r.status===410)return '';
  if(r.status===429)throw new AccessFault('rate_limited','robots.txt returned HTTP 429; stop and retry later, no bypass');
  if(r.status===401||r.status===403)throw new AccessFault('robots_denied',`robots.txt returned HTTP ${r.status}; access not granted`);
  if(r.status!==200||!/^text\//i.test(r.type))throw new AccessFault('robots_unavailable',`robots.txt returned HTTP ${r.status} or non-text; conservative stop`);
  const body=new TextDecoder().decode(r.bytes);
  if(!robotsAllowed(body,url.pathname+url.search))throw new AccessFault('robots_denied','robots.txt disallows requested path');
  return body;
}
export function documentLooksPdf(bytes:Uint8Array,type:string,rawUrl:string):boolean{
  return /application\/pdf/i.test(type)||(bytes.length>=5&&String.fromCharCode(...bytes.slice(0,5))==='%PDF-')||/\.pdf(?:$|\?)/i.test(rawUrl);
}
