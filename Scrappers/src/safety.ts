/* Prototype access guard: an allowlist is REQUIRED. Host syntax checks alone cannot defeat DNS rebinding. */
const agent = 'InsideJobScrappersPrototype/0.1 (+https://github.com/KaranBarua01/Product-Insights)';
export function validatePublicUrl(value: string): URL {
  let u: URL;
  try { u = new URL(value); } catch { throw new Error('Invalid absolute URL'); }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('Only HTTP(S) URLs allowed');
  if (u.username || u.password) throw new Error('URL credentials forbidden');
  if (u.port && !['80','443'].includes(u.port)) throw new Error('Nonstandard ports forbidden');
  const host = u.hostname.toLowerCase().replace(/\.$/, '');
  if (/^\d+(?:\.\d+){3}$/.test(host)) throw new Error('IP literals forbidden');
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(host)) throw new Error('Public domain name required; IPs forbidden');
  if (host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.localhost') || host.endsWith('.test') || host.endsWith('.invalid') || host.endsWith('.example') || /(^|\.)(localhost|internal|local)$/.test(host)) throw new Error('Reserved/local hostname forbidden');
  if (host.length > 253 || host.split('.').some(x => x.length > 63)) throw new Error('Invalid hostname length');
  u.hash = '';
  return u;
}
export function normalizeAllowedHosts(raw: string | readonly string[]): string[] {
  const items = typeof raw === 'string' ? raw.split(',') : raw;
  return [...new Set(items.map(s=>s.trim().toLowerCase()).filter(Boolean).map(s => {
    if (s.includes('/') || s.includes(':') || s.startsWith('*.')) throw new Error('ALLOWED_HOSTS accepts explicit hostnames only');
    return validatePublicUrl('https://' + s).hostname;
  }))];
}
export function assertAllowed(raw: string, hosts: readonly string[], rootHost?: string): URL {
  const u = validatePublicUrl(raw);
  if (!hosts.length) throw new Error('ALLOWED_HOSTS is not configured');
  if (!hosts.includes(u.hostname)) throw new Error('Host not on ALLOWED_HOSTS');
  if (rootHost && rootHost !== u.hostname) throw new Error('Cross-host redirect denied');
  return u;
}
function robotEntries(text: string): { agents: string[]; rules: { kind: 'allow' | 'disallow'; path: string }[] }[] {
  const groups: { agents: string[]; rules: { kind: 'allow' | 'disallow'; path: string }[] }[] = [];
  let agents: string[] = [], rules: { kind: 'allow' | 'disallow'; path: string }[] = [];
  const emit = () => { if (agents.length) groups.push({agents, rules}); agents=[]; rules=[]; };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.split('#')[0]?.trim() ?? '';
    const match = /^([a-z-]+)\s*:\s*(.*)$/i.exec(line); if (!match) continue;
    const key = match[1]?.toLowerCase(), value = match[2]?.trim() ?? '';
    if (key === 'user-agent') { if (rules.length) emit(); agents.push(value.toLowerCase()); }
    else if ((key === 'allow' || key === 'disallow') && agents.length) rules.push({kind:key,path:value});
  }
  emit(); return groups;
}
export function robotsAllowed(text: string, targetPath: string): boolean {
  const groups = robotEntries(text);
  const mine = groups.filter(g=>g.agents.some(a=>a !== '*' && agent.toLowerCase().includes(a)));
  const active = (mine.length ? mine : groups.filter(g=>g.agents.includes('*'))).flatMap(g=>g.rules);
  const rules = active.filter(r=>r.path && new RegExp('^' + r.path.replace(/[.+?^${}()|[\]\\]/g,'\\$&').replace(/\*/g,'.*').replace(/\$$/,'$')).test(targetPath));
  rules.sort((a,b)=>b.path.length-a.path.length || (a.kind==='allow'?-1:1));
  return rules[0]?.kind !== 'disallow';
}
export async function fetchBounded(raw: string, hosts: readonly string[], fetcher: typeof fetch, budget: {timeoutMs:number;maxBytes:number;rootHost?:string;robotsRules?:string}, accept='text/html,application/pdf;q=0.8,*/*;q=0.2'): Promise<{url: string; status: number; type: string; bytes: Uint8Array}> {
  let target=raw; const original=assertAllowed(raw, hosts, budget.rootHost);
  for(let redirects=0;redirects<4;redirects++){
    const url=assertAllowed(target,hosts,original.hostname);
    if (budget.robotsRules!==undefined && !robotsAllowed(budget.robotsRules,url.pathname+url.search)) throw new Error('robots.txt disallows redirect/request path');
    const response=await fetcher(url.href,{redirect:'manual',signal:AbortSignal.timeout(budget.timeoutMs),headers:{'User-Agent':agent,'Accept':accept}});
    if ([301,302,303,307,308].includes(response.status)) {
      const location=response.headers.get('location');
      if(!location) throw new Error('Redirect without Location');
      target=new URL(location,url).href;
      continue;
    }
    const announced=Number(response.headers.get('content-length') || 0);
    if (Number.isFinite(announced) && announced>budget.maxBytes) throw new Error('Response exceeds byte limit');
    const reader=response.body?.getReader(); if(!reader) return {url:url.href,status:response.status,type:response.headers.get('content-type')??'',bytes:new Uint8Array()};
    let total=0; const chunks:Uint8Array[]=[];
    try{
      while(true){ const {done,value}=await reader.read();if(done)break;total+=value.byteLength;if(total>budget.maxBytes){await reader.cancel();throw new Error('Response exceeds byte limit')}chunks.push(value); }
    }finally{try{reader.releaseLock()}catch{/* no-op */}}
    const bytes=new Uint8Array(total);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
    return {url:url.href,status:response.status,type:response.headers.get('content-type')??'',bytes};
  }
  throw new Error('Redirect limit exceeded');
}
export async function assertRobots(url: URL, hosts: readonly string[], fetcher: typeof fetch, timeoutMs=6500): Promise<string> {
  const r=await fetchBounded(new URL('/robots.txt',url.origin).href,hosts,fetcher,{timeoutMs,maxBytes:64_000,rootHost:url.hostname},'text/plain');
  if (r.status===404 || r.status===410) return '';
  if (r.status!==200 || !/^text\//i.test(r.type)) throw new Error('robots.txt unavailable or not text; conservative stop');
  const body=new TextDecoder().decode(r.bytes);
  if(!robotsAllowed(body,url.pathname+url.search)) throw new Error('robots.txt disallows requested path');
  return body;
}
export function documentLooksPdf(bytes:Uint8Array,type:string,rawUrl:string):boolean{
  return /application\/pdf/i.test(type) || (bytes.length>=5 && String.fromCharCode(...bytes.slice(0,5))==='%PDF-') || /\.pdf(?:$|\?)/i.test(rawUrl);
}
