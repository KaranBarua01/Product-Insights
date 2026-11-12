import type {PageSignals, Signal, WebsiteAnalysis} from './types.js';
import {analyzeHtml, analyzePdf} from './parse.js';
import {classify} from './patterns.js';
import {hasExtractablePdfText} from './pdf-text.js';

const AGENT='InsideJobPatternResearch/0.1 (+https://github.com/KaranBarua01/Product-Insights)';
const MAX_BYTES=2_000_000;
const MAX_PDF_BYTES=3_000_000;
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
export interface InspectOptions {companyName?:string;maxPages?:number;fetcher?:typeof fetch;timeoutMs?:number;now?:string;pdfTextProbe?:(bytes:Uint8Array)=>Promise<boolean|undefined>}
interface FetchResult {url:string;status:number;type:string;body:string;hash?:string;bytes?:Uint8Array;truncated:boolean}
export class CanonicalAliasRedirect extends Error{
  constructor(public readonly target:string){super('Canonical www/apex redirect requires independent robots.txt review');}
}
function sameCanonicalHost(first:string,second:string):boolean{
  const drop=(host:string)=>host.startsWith('www.')?host.slice(4):host;
  return first!==second&&drop(first)===drop(second)&&(first.startsWith('www.')||second.startsWith('www.'));
}
async function hash(value:string):Promise<string>{const v=new TextEncoder().encode(value);const h=await crypto.subtle.digest('SHA-256',v);return [...new Uint8Array(h)].map(x=>x.toString(16).padStart(2,'0')).join('');}
async function fetchBounded(url:string,fetcher:typeof fetch,timeoutMs:number,cap=MAX_BYTES,truncate=false,robotsAlias=false):Promise<FetchResult>{
  const first=validatePublicUrl(url);let target=url;
  for(let redirects=0;redirects<=3;redirects++){
    const safe=validatePublicUrl(target);
    if(safe.hostname!==first.hostname){
      if(!sameCanonicalHost(first.hostname,safe.hostname))throw Error('Cross-host redirect withheld for identity review');
      if(!robotsAlias||safe.pathname!=='/robots.txt')throw new CanonicalAliasRedirect(safe.href);
    }
    const res=await fetcher(safe.href,{redirect:'manual',headers:{'User-Agent':AGENT,'Accept':'text/html,application/xhtml+xml,application/pdf,text/plain;q=0.8,*/*;q=0.2'},signal:AbortSignal.timeout(timeoutMs)});
    if([301,302,303,307,308].includes(res.status)){
      const location=res.headers.get('location');if(!location)throw Error('Redirect response without Location');
      const next=validatePublicUrl(new URL(location,safe).href);
      if(next.hostname!==first.hostname){
        if(!sameCanonicalHost(first.hostname,next.hostname))throw Error('Cross-host redirect withheld for identity review');
        if(!robotsAlias||next.pathname!=='/robots.txt')throw new CanonicalAliasRedirect(next.href);
      }
      target=next.href;continue;
    }
    const len=Number(res.headers.get('content-length')??0);
    const type=res.headers.get('content-type')?.split(';')[0]?.toLowerCase()??'';
    const isPdf=type==='application/pdf';
    if(Number.isFinite(len)&&len>cap&&(!truncate||isPdf))throw Error('Response exceeds '+cap+'-byte budget');
    const reader=res.body?.getReader(),chunks:Uint8Array[]=[];let total=0,truncated=false;
    if(reader){try{while(true){
      const {done,value}=await reader.read();if(done)break;
      if(total+value.byteLength>cap){
        if(!truncate||isPdf){await reader.cancel();throw Error('Response exceeds '+cap+'-byte budget');}
        const take=Math.max(0,cap-total);if(take)chunks.push(value.subarray(0,take));total+=take;
        truncated=true;await reader.cancel();break;
      }
      chunks.push(value);total+=value.byteLength;
    }}finally{try{reader.releaseLock();}catch{ /* no-op */ }}}
    if(len>cap&&truncate&&!isPdf)truncated=true;
    const bytes=new Uint8Array(total);let off=0;for(const c of chunks){bytes.set(c,off);off+=c.byteLength;}
    const magic=bytes.byteLength>=5&&String.fromCharCode(...bytes.slice(0,5))==='%PDF-';
    if(magic&&truncated)throw Error('PDF exceeds '+cap+'-byte budget; partial PDF not analyzed');
    const pdf=isPdf||magic;
    const body=pdf?'':new TextDecoder('utf-8',{fatal:false}).decode(bytes);
    return {url:res.url||safe.href,status:res.status,type:pdf?'application/pdf':type,body,bytes:pdf?bytes:undefined,truncated,hash:await hash(pdf?String(bytes.length)+':'+Array.from(bytes.slice(0,128)).join(','):body)};
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
async function canFetch(u:URL,fetcher:typeof fetch,timeout:number):Promise<{allowed:boolean;rules:string;reason:string;host:string}>{
  const robots=new URL('/robots.txt',u.origin);
  let r:FetchResult;
  try{r=await fetchBounded(robots.href,fetcher,timeout,75_000,false,true);}
  catch(e){return {allowed:false,rules:'',reason:'robots.txt could not be verified: '+String(e),host:u.hostname};}
  const host=new URL(r.url).hostname;
  if(host!==u.hostname&&!sameCanonicalHost(host,u.hostname))return {allowed:false,rules:'',reason:'robots redirected to unrelated host',host:u.hostname};
  if(r.status===404||r.status===410)return {allowed:true,rules:'',reason:'robots absent',host};
  if(r.status!==200)return {allowed:false,rules:'',reason:'robots returned '+r.status+'; conservative stop',host};
  if(!r.type.startsWith('text/')&&!r.type.includes('text'))return {allowed:false,rules:'',reason:'robots response was not text',host};
  if(!robotsAllowed(r.body,u.pathname+u.search))return {allowed:false,rules:r.body,reason:'robots.txt disallows requested path',host};
  return {allowed:true,rules:r.body,reason:'robots parsed',host};
}
function scoreLink(link:{href:string;label:string}):number{
 const u=new URL(link.href);const label=link.label.toLowerCase();const path=u.pathname.toLowerCase();
 if(u.search&&/(?:filter|facet|page|sort|color|size)=/i.test(u.search))return -1;
 if(/\/products?(?:\/|$)|\/categor(?:y|ies)\/|\/catalog|\/models?\//.test(path))return 7;
 if(/\bproducts\b|\bcatalog(?:ue)?\b|product\s+range|part\s+numbers?/.test(label))return 6;
 if(/\/solutions?\//.test(path)||/capabilities|technical|industr/.test(path+' '+label))return 4;
 if(/about|services|manufactur/.test(path+' '+label))return 2;
 return 0;
}
function isLikelyPdf(link:{href:string;label:string}):boolean{
 return /\.pdf(?:$|\?)/i.test(link.href)||/\b(?:datasheet|data sheet|technical pdf|download pdf|specification pdf|product brochure)\b/i.test(link.label);
}
export async function inspectWebsite(value:string,opts:InspectOptions={}):Promise<WebsiteAnalysis>{
  const started=opts.now??new Date().toISOString();const id=crypto.randomUUID();
  const requested=validatePublicUrl(value),maxPages=Math.max(1,Math.min(5,Math.floor(opts.maxPages??3)));
  const result:WebsiteAnalysis={id,companyName:opts.companyName?.slice(0,180),requestedUrl:requested.href,host:requested.hostname,createdAt:started,status:'failed',pages:[],assessments:[],candidates:[],errors:[],limits:{maxPages,inspectedPages:0,maxPageBytes:MAX_BYTES,truncatedPages:0,documentPagesInspected:0}};
  const fetcher=opts.fetcher??fetch,timeout=Math.min(15000,Math.max(1000,opts.timeoutMs??7000));
  let policy=await canFetch(requested,fetcher,timeout);
  if(!policy.allowed){result.status='blocked';result.errors.push(policy.reason);return {...result,...classify(result.pages,started)};}
  const root=new URL(requested.href);root.hostname=policy.host;
  const queue=[root.href],seen=new Set<string>(),pdfLinks=new Set<string>();
  let aliasSwitched=false,htmlPages=0,blockedCount=0;
  const pdfProbe=opts.pdfTextProbe??hasExtractablePdfText;
  const addPdf=async(response:FetchResult)=>{
    let hasText:boolean|undefined;
    if(response.status<400&&response.bytes){
      try{hasText=await pdfProbe(response.bytes);}catch(e){result.errors.push('PDF text-layer check incomplete: '+String(e));}
    }
    const page=analyzePdf(response.url,response.status,response.type,hasText);
    page.contentHash=response.hash;page.truncated=response.truncated;
    result.pages.push(page);result.limits.documentPagesInspected=(result.limits.documentPagesInspected??0)+1;
  };
  while(queue.length&&htmlPages<maxPages){
    const next=queue.shift();if(!next||seen.has(next))continue;seen.add(next);
    const safe=validatePublicUrl(next);
    if(safe.hostname!==policy.host)continue;
    if(!robotsAllowed(policy.rules,safe.pathname+safe.search)){result.errors.push('Robots disallowed sampled page: '+safe.pathname);continue;}
    try{
      let response:FetchResult;
      try{response=await fetchBounded(safe.href,fetcher,timeout,MAX_BYTES,true);}
      catch(e){
        if(!(e instanceof CanonicalAliasRedirect)||aliasSwitched)throw e;
        const alias=validatePublicUrl(e.target);
        if(!sameCanonicalHost(safe.hostname,alias.hostname))throw Error('Unapproved cross-host redirect');
        const alternate=await canFetch(alias,fetcher,timeout);
        if(!alternate.allowed){blockedCount++;result.errors.push('Canonical alias access denied: '+alternate.reason);break;}
        if(alternate.host!==alias.hostname||!robotsAllowed(alternate.rules,alias.pathname+alias.search)){blockedCount++;result.errors.push('Canonical alias not approved by robots');break;}
        aliasSwitched=true;policy=alternate;queue.length=0;
        response=await fetchBounded(alias.href,fetcher,timeout,MAX_BYTES,true);
      }
      if(response.type==='application/pdf'){
        await addPdf(response);
        if(response.status>=400)blockedCount++;
        continue;
      }
      if(!response.type.includes('html')&&!/^\s*<!?doctype|^\s*<html/i.test(response.body)){
        result.errors.push('Non-HTML/PDF response at '+safe.pathname+': '+(response.type||'unknown'));continue;
      }
      const page=analyzeHtml(response.body,response.url,response.status,response.type||'text/html');
      page.contentHash=response.hash;page.truncated=response.truncated;
      result.pages.push(page);htmlPages++;
      if(response.truncated)result.errors.push('HTML truncated at '+MAX_BYTES+' bytes: '+page.url);
      if([401,403,429,503].includes(response.status)){
        page.signals.push({type:'challenge',excerpt:'HTTP '+response.status+' at '+safe.pathname,locator:'HTTP status',certainty:'observed'});
        blockedCount++;
      }
      if(response.status>=400){result.errors.push('HTTP '+response.status+': '+safe.pathname);continue;}
      // HTTP 200 interstitials are access blocks, not successful website evidence.
      if(page.signals.some(s=>s.type==='challenge')){
        blockedCount++;result.errors.push('Challenge/interstitial response; no bypass attempted: '+page.url);continue;
      }
      for(const link of page.links){
        if(!link.external&&new URL(link.href).hostname===policy.host&&isLikelyPdf(link)&&pdfLinks.size<6)pdfLinks.add(link.href);
      }
      const candidates=page.links.filter(l=>!l.external&&new URL(l.href).hostname===policy.host&&!seen.has(l.href)&&!queue.includes(l.href)&&!/\.(?:pdf|jpe?g|png|webp|zip|exe|docx?|xlsx?)(?:$|\?)/i.test(l.href));
      candidates.sort((a,b)=>scoreLink(b)-scoreLink(a));
      for(const c of candidates.filter(l=>scoreLink(l)>1).slice(0,4)){
        if(queue.length>=maxPages*3)break;queue.push(c.href);
      }
    }catch(e){result.errors.push(safe.pathname+': '+String(e));}
  }
  // At most one discovered document, with a separate bounded PDF budget.
  for(const link of pdfLinks){
    if((result.limits.documentPagesInspected??0)>=1)break;
    const safe=validatePublicUrl(link);
    if(safe.hostname!==policy.host||seen.has(safe.href)||!robotsAllowed(policy.rules,safe.pathname+safe.search))continue;
    try{
      const response=await fetchBounded(safe.href,fetcher,timeout,MAX_PDF_BYTES,false);
      if(response.type==='application/pdf')await addPdf(response);
    }catch(e){result.errors.push('Discovered document not assessed: '+String(e));}
  }
  result.limits.inspectedPages=result.pages.length;
  result.limits.truncatedPages=result.pages.filter(p=>p.truncated).length;
  const useful=result.pages.some(p=>p.status>=200&&p.status<400&&!p.signals.some(signal=>signal.type==='challenge'));

  result.status=!useful&&blockedCount?'blocked':useful?(result.errors.length||result.limits.truncatedPages?'partial':'completed'):'failed';
  return {...result,...classify(result.pages,started)};
}
