import type {PageSignals, Signal, WebsiteAnalysis} from './types.js';
import {analyzeHtml, analyzePdf} from './parse.js';
import {classify} from './patterns.js';

const AGENT='InsideJobPatternResearch/0.1 (+https://github.com/KaranBarua01/Product-Insights)';
const MAX_BYTES=512000;
export function validatePublicUrl(value:string):URL{
  let u:URL;try{u=new URL(value)}catch{throw Error('Invalid absolute URL');}
  if(u.protocol!=='http:'&&u.protocol!=='https:')throw Error('Only public HTTP/HTTPS URLs allowed');
  if(u.username||u.password)throw Error('Credential-bearing URLs are forbidden');
  if(u.port&&!['80','443'].includes(u.port))throw Error('Nonstandard ports are forbidden');
  const host=u.hostname.toLowerCase().replace(/\.$/,'');
  if(!host||host.length>253||!host.includes('.')||/[^a-z0-9.-]/.test(host)||host.includes('..'))throw Error('Public DNS hostname required');
  if(/(^|\.)(localhost|local|internal|invalid|test|example)$/.test(host)||/\.localhost$/.test(host)||host.endsWith('.local')||host.endsWith('.internal'))throw Error('Local/internal host forbidden');
  if(/^\d+\.\d+\.\d+\.\d+$/.test(host)||host.startsWith('[')||/^0x[0-9a-f]+$/i.test(host)||/^\d+$/.test(host))throw Error('IP literals are forbidden');
  if(!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(host))throw Error('Invalid DNS hostname');
  u.hash='';return u;
}
export interface InspectOptions {companyName?:string;maxPages?:number;fetcher?:typeof fetch;timeoutMs?:number;now?:string}
interface FetchResult {url:string;status:number;type:string;body:string;hash?:string}
async function hash(value:string):Promise<string>{const v=new TextEncoder().encode(value);const h=await crypto.subtle.digest('SHA-256',v);return [...new Uint8Array(h)].map(x=>x.toString(16).padStart(2,'0')).join('');}
async function fetchBounded(url:string,fetcher:typeof fetch,timeoutMs:number,cap=MAX_BYTES):Promise<FetchResult>{
  const first=new URL(url);let target=url;
  for(let redirects=0;redirects<=3;redirects++){
    const safe=validatePublicUrl(target);
    if(safe.hostname!==first.hostname)throw Error('Cross-host redirect withheld for identity review');
    const res=await fetcher(safe.href,{redirect:'manual',headers:{'User-Agent':AGENT,'Accept':'text/html,application/xhtml+xml,application/pdf,text/plain;q=0.8,*/*;q=0.2'},signal:AbortSignal.timeout(timeoutMs)});
    if([301,302,303,307,308].includes(res.status)){
      const location=res.headers.get('location');if(!location)throw Error('Redirect response without Location');
      target=new URL(location,safe).href;continue;
    }
    const len=Number(res.headers.get('content-length')??0);if(Number.isFinite(len)&&len>cap)throw Error(`Response exceeds ${cap}-byte budget`);
    const reader=res.body?.getReader();const chunks:Uint8Array[]=[];let total=0;
    if(reader){try{while(true){const {done,value}=await reader.read();if(done)break;total+=value.byteLength;if(total>cap){await reader.cancel();throw Error(`Response exceeds ${cap}-byte budget`);}chunks.push(value);}}finally{try{reader.releaseLock();}catch{ /* ignore */ }}}
    const bytes=new Uint8Array(total);let off=0;for(const c of chunks){bytes.set(c,off);off+=c.byteLength;}
    const type=res.headers.get('content-type')?.split(';')[0]?.toLowerCase()??'';
    const isPdf=type==='application/pdf'||(bytes[0]===37&&bytes[1]===80&&bytes[2]===68&&bytes[3]===70);
    const body=isPdf?'':new TextDecoder('utf-8',{fatal:false}).decode(bytes);
    return {url:res.url||safe.href,status:res.status,type:isPdf?'application/pdf':type,body,hash:await hash(isPdf?`${bytes.length}:${Array.from(bytes.slice(0,128))}`:body)};
  }
  throw Error('Redirect limit exceeded');
}
type RobotRule={kind:'allow'|'disallow';path:string};
export function robotsAllowed(text:string,path:string,userAgent='InsideJobPatternResearch'):boolean{
  const groups:{agents:string[];rules:RobotRule[]}[]=[];
  let agents:string[]=[],rules:RobotRule[]=[];
  const push=()=>{if(agents.length)groups.push({agents,rules});agents=[];rules=[];};
  for(const raw of text.split(/\r?\n/)){
    const line=raw.split('#')[0]?.trim()??'';if(!line)continue;
    const match=/^([a-z-]+)\s*:\s*(.*)$/i.exec(line);if(!match)continue;
    const field=match[1]?.toLowerCase(),val=match[2]?.trim()??'';
    if(field==='user-agent'){if(rules.length)push();agents.push(val.toLowerCase());}
    else if((field==='allow'||field==='disallow')&&agents.length){rules.push({kind:field,path:val});}
  }
  push();
  const ua=userAgent.toLowerCase();
  const specific=groups.filter(g=>g.agents.some(a=>a!=='*'&&ua.includes(a)));
  const active=(specific.length?specific:groups.filter(g=>g.agents.includes('*'))).flatMap(g=>g.rules);
  const target=path;
  const matches=active.map(r=>{
    if(!r.path)return null;
    const escaped=r.path.replace(/[.+?^${}()|[\]\\]/g,'\\$&').replace(/\*/g,'.*');
    const regex=new RegExp('^'+escaped.replace(/\$$/,'$'));
    return regex.test(target)?{kind:r.kind,length:r.path.length}:null;
  }).filter((x):x is {kind:'allow'|'disallow';length:number}=>x!==null).sort((a,b)=>b.length-a.length||(a.kind==='allow'?-1:1));
  return matches[0]?.kind!=='disallow';
}
async function canFetch(u:URL,fetcher:typeof fetch,timeout:number):Promise<{allowed:boolean;rules:string;reason:string}>{
  const robots=new URL('/robots.txt',u.origin);
  let r:FetchResult;
  try{r=await fetchBounded(robots.href,fetcher,timeout,75000);}catch(e){return {allowed:false,rules:'',reason:`robots.txt could not be verified: ${String(e)}`};}
  if(r.status===404||r.status===410)return {allowed:true,rules:'',reason:'robots absent'};
  if(r.status!==200)return {allowed:false,rules:'',reason:`robots returned ${r.status}; conservative stop`};
  if(!r.type.startsWith('text/')&&!r.type.includes('text'))return {allowed:false,rules:'',reason:'robots response was not text'};
  return {allowed:true,rules:r.body,reason:'robots parsed'};
}
function scoreLink(link:{href:string;label:string}):number{
 const s=(link.href+' '+link.label).toLowerCase();
 return /\/products?\/|\/category\//.test(s)?5:/catalog|product|capabilities|technical|industry/.test(s)?4:/about|services|solutions/.test(s)?3:/download|blog|news/.test(s)?1:0;
}
export async function inspectWebsite(value:string,opts:InspectOptions={}):Promise<WebsiteAnalysis>{
  const started=opts.now??new Date().toISOString();const id=crypto.randomUUID();
  const requested=validatePublicUrl(value);const maxPages=Math.max(1,Math.min(5,Math.floor(opts.maxPages??3)));
  const result:WebsiteAnalysis={id,companyName:opts.companyName?.slice(0,180),requestedUrl:requested.href,host:requested.hostname,createdAt:started,status:'failed',pages:[],assessments:[],candidates:[],errors:[],limits:{maxPages,inspectedPages:0}};
  const fetcher=opts.fetcher??fetch;const timeout=Math.min(15000,Math.max(1000,opts.timeoutMs??7000));
  const policy=await canFetch(requested,fetcher,timeout);
  if(!policy.allowed){result.status='blocked';result.errors.push(policy.reason);return {...result,...classify(result.pages,started)};}
  const queue=[requested.href];const seen=new Set<string>();
  while(queue.length&&result.pages.length<maxPages){
    const next=queue.shift();if(!next||seen.has(next))continue;seen.add(next);
    const safe=validatePublicUrl(next);
    if(safe.hostname!==requested.hostname)continue;
    if(!robotsAllowed(policy.rules,safe.pathname+safe.search)){result.errors.push(`Robots disallowed sampled page: ${safe.pathname}`);continue;}
    try{
      const response=await fetchBounded(safe.href,fetcher,timeout);
      let page:PageSignals;
      if(response.type==='application/pdf')page=analyzePdf(response.url,response.status,response.type);
      else if(response.type.includes('html')||/^\s*<!?doctype|^\s*<html/i.test(response.body))page=analyzeHtml(response.body,response.url,response.status,response.type||'text/html');
      else {result.errors.push(`Non-HTML/PDF response at ${safe.pathname}: ${response.type||'unknown'}`);continue;}
      page.contentHash=response.hash;
      if([401,403,429,503].includes(response.status)){
        page.signals.push({type:'challenge',excerpt:`HTTP ${response.status} at ${safe.pathname}`,locator:'HTTP status',certainty:'observed'});
      }
      result.pages.push(page);
      if(response.status>=400){result.errors.push(`HTTP ${response.status}: ${safe.pathname}`);continue;}
      const candidates=page.links.filter(l=>!l.external && l.href.startsWith(safe.origin) && !seen.has(l.href) && !queue.includes(l.href) && !/\.(?:pdf|jpe?g|png|webp|zip|exe|docx?|xlsx?)(?:$|\?)/i.test(l.href));
      candidates.sort((a,b)=>scoreLink(b)-scoreLink(a));
      // Exclude non-research links and avoid accidental enumeration of search/filter combinations.
      for(const c of candidates.filter(l=>scoreLink(l)>1).slice(0,3)){if(queue.length>=maxPages*2)break;queue.push(c.href);}
    }catch(e){result.errors.push(`${safe.pathname}: ${String(e)}`);}
  }
  result.limits.inspectedPages=result.pages.length;
  result.status=result.pages.some(p=>p.status<400)?(result.errors.length?'partial':'completed'):'failed';
  return {...result,...classify(result.pages,started)};
}
