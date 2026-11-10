#!/usr/bin/env node
/** Run bounded prototype extraction benchmarks. No network calls on --dry-run. */
import {readFile} from 'node:fs/promises';
import {resolve, dirname, join} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {extract,limitedPatternAnalysis} from '../dist/engine.js';
import {runBenchmark, prepareSites, prepareLabels, writeArtifacts, buildReviewTemplate} from './benchmark-lib.mjs';

const SELF = dirname(fileURLToPath(import.meta.url));
const BASE = resolve(SELF, '..');
const help = `Product Insights - Scrappers V1: bounded CLI benchmark\n\n` +
`Usage:\n` +
`  npm run benchmark -- --sites benchmark/sites.example.csv --allow-hosts benchmark/approved-hosts.txt [options]\n` +
`  npm run benchmark:dry\n\n` +
`Options:\n` +
`  --sites PATH           Company/URL CSV (default benchmark/sites.example.csv)\n` +
`  --allow-hosts PATH     REQUIRED explicit reviewed host allowlist, one host per line\n` +
`  --labels PATH          Optional manually reviewed truth CSV\n` +
`  --out DIR              Results folder (default benchmark/results/<timestamp>)\n` +
`  --pattern-mode MODE    local | api | none (default local)\n` +
`  --pattern-api URL      HTTPS Pattern Systems Worker URL (requires PATTERN_API_TOKEN)\n` +
`  --worker-url URL       Use Scrappers Worker for S01/S02/S03 (requires SCRAPPERS_API_TOKEN)\n` +
`  --strategy MODE        auto | S01 | S02 | S03 (default auto)\n` +
`  --max-sites N          1..30 (default 30)\n` +
`  --delay-ms N           Sequential delay, 0..60000 (default 1500)\n` +
`  --min-chars N          Min body text chars for basic usability (default 120)\n` +
`  --max-pdf-pages N      1..15 (default 8)\n` +
`  --dry-run              Validate inputs and list hosts; no network\n` +
`  --help                 Display this help\n\n` +
`NOTES: local mode cannot run S02 without an injected Cloudflare Browser binding; use --worker-url.\n` +
`Cloudflare bindings, OCR, DNS-level SSRF defenses and production authorization are out of scope.\n`;
const accepted = new Set(['sites','allow-hosts','labels','out','pattern-mode','pattern-api','worker-url','strategy','max-sites','delay-ms','min-chars','max-pdf-pages','dry-run','help']);
function flags(argv) {
  const args={};
  for(let i=0;i<argv.length;i++) {
    const token=argv[i];
    if(!token.startsWith('--')) throw Error(`Unexpected argument: ${token}`);
    const name=token.slice(2);
    if(!accepted.has(name)) throw Error(`Unknown flag --${name}`);
    if(name==='help'||name==='dry-run'){args[name]=true;continue;}
    const value=argv[++i];
    if(!value || value.startsWith('--')) throw Error(`Missing value for --${name}`);
    args[name]=value;
  }
  return args;
}
function intRange(raw,fallback,min,max,field) {
  if(raw===undefined)return fallback;
  const n=Number(raw);
  if(!Number.isInteger(n)||n<min||n>max)throw Error(`${field} must be an integer between ${min} and ${max}`);
  return n;
}
function endpointUrl(raw) {
  const u=new URL(raw);
  if(u.username||u.password||u.search||u.hash)throw Error('Endpoint URL must not contain credentials, query or fragment');
  const local=['localhost','127.0.0.1','[::1]'].includes(u.hostname);
  if(u.protocol!=='https:' && !(u.protocol==='http:'&&local))throw Error('Endpoints must be HTTPS (or HTTP loopback for local development)');
  return u;
}
async function boundedPost(endpoint, body, token, maxBytes=500_000) {
  const response=await fetch(endpoint.href,{method:'POST',redirect:'error',signal:AbortSignal.timeout(30_000),headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(body)});
  const reported=Number(response.headers.get('content-length')||0);
  if(reported>maxBytes) throw Error('Remote response exceeds byte budget');
  const reader=response.body?.getReader();const chunks=[];let size=0;
  if(reader){try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>maxBytes){await reader.cancel();throw Error('Remote response exceeds byte budget')}chunks.push(value)}}finally{try{reader.releaseLock()}catch{/*no-op*/}}}
  const bytes=new Uint8Array(size);let at=0;for(const c of chunks){bytes.set(c,at);at+=c.byteLength;}
  const text=new TextDecoder().decode(bytes);
  if(!response.ok)throw Error(`Remote endpoint HTTP ${response.status}: ${text.slice(0,160)}`);
  const data=JSON.parse(text);
  if(!data || typeof data!=='object' || Array.isArray(data))throw Error('Remote endpoint returned invalid payload');
  return data;
}
async function main(argv=process.argv.slice(2)) {
  const a=flags(argv);
  if(a.help){process.stdout.write(help);return}
  const sitePath=resolve(BASE,a.sites||'benchmark/sites.example.csv');
  const hostsPath=a['allow-hosts'] ? resolve(BASE,a['allow-hosts']) : null;
  if(!hostsPath)throw Error('Missing --allow-hosts. Copy benchmark/approved-hosts.example.txt after authorization and review.');
  const [siteCsv,allowlist]=await Promise.all([readFile(sitePath,'utf8'),readFile(hostsPath,'utf8')]);
  const hosts=allowlist.split(/\r?\n/).map(s=>s.replace(/#.*/, '').trim()).filter(Boolean);
  const maxSites=intRange(a['max-sites'],30,1,30,'--max-sites');
  const sites=prepareSites(siteCsv,hosts,maxSites);
  const labelCsv=a.labels?await readFile(resolve(BASE,a.labels),'utf8'):null;
  const labels=prepareLabels(labelCsv,sites);
  const delayMs=intRange(a['delay-ms'],1500,0,60000,'--delay-ms');
  const minTextChars=intRange(a['min-chars'],120,0,50000,'--min-chars');
  const maxPdfPages=intRange(a['max-pdf-pages'],8,1,15,'--max-pdf-pages');
  const patternMode=a['pattern-mode']||'local';
  if(!['local','api','none'].includes(patternMode))throw Error('--pattern-mode must be local|api|none');
  const strategy=a.strategy||'auto';
  if(!['auto','S01','S02','S03'].includes(strategy))throw Error('--strategy must be auto|S01|S02|S03');
  const stamp=new Date().toISOString().replace(/[:.]/g,'-');
  const out=resolve(BASE,a.out||join('benchmark','results',stamp));
  process.stdout.write(`Preflight: ${sites.length} explicitly allowlisted candidate sites; pattern=${patternMode}; execution=${a['worker-url']?'worker':'local'}\n`);
  if(a['dry-run']){
    for(const s of sites)process.stdout.write(`  ${s.siteId} | ${s.companyName} | ${s.url}\n`);
    process.stdout.write('DRY RUN — no requests made. Review allowlist and manual labels before real testing.\n');
    return;
  }
  const workerEndpoint=a['worker-url']?new URL('/api/extract',endpointUrl(a['worker-url'])):null;
  const workerToken=workerEndpoint?process.env.SCRAPPERS_API_TOKEN:null;
  if(workerEndpoint&&!workerToken)throw Error('SCRAPPERS_API_TOKEN is required for --worker-url');
  if(patternMode==='api'&&!a['pattern-api'])throw Error('--pattern-api URL is required when --pattern-mode api');
  const patternEndpoint=patternMode==='api'?new URL('/api/analyze',endpointUrl(a['pattern-api'])):null;
  const patternToken=patternEndpoint?process.env.PATTERN_API_TOKEN:null;
  if(patternEndpoint&&!patternToken)throw Error('PATTERN_API_TOKEN is required for --pattern-mode api');
  let inspectWebsite;
  if(patternMode==='local'){
    try {
      const moduleUrl=pathToFileURL(resolve(BASE,'..','engine','pattern-systems','dist','inspect.js')).href;
      ({inspectWebsite}=await import(moduleUrl));
      if(typeof inspectWebsite!=='function')throw Error('Missing inspectWebsite export');
    } catch(e) {throw Error('Local Pattern Systems module not built. Run (cd engine/pattern-systems && npm run build), or choose --pattern-mode none/api. '+String(e.message||e));}
  }
  const detectPatterns=async site=>{
    if(patternMode==='none')return {status:'not_assessed'};
    const analysis=patternMode==='local'
      ? await inspectWebsite(site.url,{maxPages:2})
      : await boundedPost(patternEndpoint,{url:site.url,maxPages:2},patternToken,300_000);
    if(!['completed','partial'].includes(analysis.status)) return {status:analysis.status||'failed',error:analysis.errors?.join(' | ')||'Pattern sampling did not complete'};
    const limited=limitedPatternAnalysis(analysis);
    if(!limited)throw Error('Pattern Systems did not return a valid assessment array');
    return {status:analysis.status,analysis:limited};
  };
  const execute=async(site,patternAnalysis)=>{
    const request={url:site.url,mode:strategy,maxPdfPages,...(patternAnalysis?{patternAnalysis}:{})};
    if(workerEndpoint)return boundedPost(workerEndpoint,request,workerToken,500_000);
    return extract(request,{fetcher:fetch},{allowedHosts:hosts,timeoutMs:7000},patternAnalysis?'supplied':'none');
  };
  const config={siteCount:sites.length,patternMode,execution:workerEndpoint?'cloudflare-worker':'local-node',strategy,delayMs,minTextChars,maxPdfPages,sources:{sites:a.sites||'benchmark/sites.example.csv',labels:a.labels||null,allowlist:'explicit file supplied'},browserAvailability:workerEndpoint?'depends on Worker binding':'unavailable locally'};
  const batch=await runBenchmark({sites,labels,execute,detectPatterns,delayMs,minTextChars,config,onProgress:(r,i,total)=>process.stdout.write(`[${i}/${total}] ${r.siteId}  ${r.status}  ${r.finalStrategy||'n/a'}  chars=${r.textChars}  evidence=${r.evidenceCount}  usable=${r.usable}\n`)});
  const files=await writeArtifacts(out,batch);
  if(!labelCsv)await (await import('node:fs/promises')).writeFile(join(out,'labels_to_review.csv'),buildReviewTemplate(sites),'utf8');
  const quality=batch.summary.quality;
  const routed=batch.summary.routing.initial;
  process.stdout.write(`\nCompleted ${batch.summary.totalSites} sites. Usable eligible: ${quality.usableEligible}/${quality.eligible} (${quality.usableRatePct??'n/a'}%).\n`);
  process.stdout.write(`Human-labeled first-route accuracy: ${routed.correct}/${routed.labeled} (${routed.accuracyPct??'not measured'}%).\n`);
  process.stdout.write(`Outputs: ${out}\n  ${Object.values(files).map(p=>p.slice(out.length+1)).join('\n  ')}\n`);
  process.stdout.write('Results are experimental. No production guarantees or actual API cost accounting.\n');
}

main().catch(e=>{process.stderr.write(`Benchmark failed: ${String(e.message||e)}\n`);process.exitCode=1});
