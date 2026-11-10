#!/usr/bin/env node
/** Bounded, sequential prototype benchmark. No requests on --dry-run. */
import {readFile,writeFile} from 'node:fs/promises';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {extract,limitedPatternAnalysis} from '../dist/engine.js';
import {createPlaywrightBrowserCapture} from './node-browser.mjs';
import {runBenchmark,prepareSites,prepareLabels,writeArtifacts,buildReviewTemplate} from './benchmark-lib.mjs';
const BASE=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const HELP=`Product Insights - portable extraction benchmark V1.1

Usage: npm run benchmark -- --sites benchmark/sites.example.csv --allow-hosts benchmark/approved-hosts.txt [options]

  --sites PATH              Site CSV (default benchmark/sites.example.csv)
  --allow-hosts PATH        REQUIRED reviewed, exact hostname allowlist
  --labels PATH             Optional human-reviewed truth CSV
  --out DIR                 Report directory
  --pattern-mode MODE       local|api|none (default local)
  --pattern-api URL         Pattern Systems API endpoint; PATTERN_API_TOKEN required
  --extract-api URL         Generic Node/Cloudflare HTTP extraction service; SCRAPPERS_API_TOKEN required
  --worker-url URL          Backward-compatible alias of --extract-api
  --browser MODE            none|playwright (default none; applies to local extraction)
  --strategy MODE           auto|S01|S02|S03 (default auto)
  --html-pages N            HTML pages per website, 1..4 (default 3, local only)
  --max-sites N             Sites per batch, 1..30 (default 30)
  --delay-ms N              Inter-site pause, 0..60000 (default 1500)
  --min-chars N             Basic text usability threshold (default 120)
  --max-pdf-pages N         PDF pages, 1..15 (default 8)
  --dry-run                 Validate and list sites without network requests
  --help                    Show this help

Browser: npm install && npx playwright install chromium; then use --browser playwright.
For a remote browser, configure PLAYWRIGHT_CDP_URL before running.
Unapproved URLs are rejected; robots/429 blocks are not bypassed.
`;
const ARGS=new Set(['sites','allow-hosts','labels','out','pattern-mode','pattern-api','extract-api','worker-url','browser','strategy','html-pages','max-sites','delay-ms','min-chars','max-pdf-pages','dry-run','help']);
function parseArgs(argv){
  const result={};
  for(let i=0;i<argv.length;i++){
    const flag=argv[i];if(!flag.startsWith('--'))throw Error('Unexpected argument: '+flag);
    const name=flag.slice(2);if(!ARGS.has(name))throw Error('Unknown flag '+flag);
    if(name==='dry-run'||name==='help'){result[name]=true;continue}
    const value=argv[++i];if(!value||value.startsWith('--'))throw Error('Missing value for '+flag);
    result[name]=value;
  }
  return result;
}
function intRange(value,fallback,min,max,field){
  if(value===undefined)return fallback;
  const n=Number(value);if(!Number.isInteger(n)||n<min||n>max)throw Error(`${field} must be an integer between ${min} and ${max}`);
  return n;
}
function safeEndpoint(raw){
  const url=new URL(raw),local=['localhost','127.0.0.1','[::1]'].includes(url.hostname);
  if(url.username||url.password||url.search||url.hash)throw Error('Endpoint URL must not contain credentials, query or fragment');
  if(url.protocol!=='https:'&&!(url.protocol==='http:'&&local))throw Error('Endpoints must use HTTPS or loopback HTTP');
  return url;
}
async function boundedPost(endpoint,body,token,maxBytes=500_000){
  const response=await fetch(endpoint.href,{method:'POST',redirect:'error',signal:AbortSignal.timeout(32_000),headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(body)});
  const claimed=Number(response.headers.get('content-length')||0);if(claimed>maxBytes)throw Error('Remote response exceeds byte budget');
  let total=0;const chunks=[];const reader=response.body?.getReader();
  if(reader){try{while(true){const {done,value}=await reader.read();if(done)break;total+=value.byteLength;if(total>maxBytes){await reader.cancel();throw Error('Remote response exceeds byte budget')}chunks.push(value)}}finally{try{reader.releaseLock()}catch{/* noop */}}}
  const bytes=new Uint8Array(total);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.byteLength}
  const text=new TextDecoder().decode(bytes);
  if(!response.ok)throw Error(`Extraction service HTTP ${response.status}: ${text.slice(0,180)}`);
  const result=JSON.parse(text);if(!result||typeof result!=='object'||Array.isArray(result))throw Error('Invalid remote JSON payload');
  return result;
}
async function main(argv=process.argv.slice(2)){
  const a=parseArgs(argv);if(a.help){process.stdout.write(HELP);return}
  const sitePath=resolve(BASE,a.sites||'benchmark/sites.example.csv');
  const hostsPath=a['allow-hosts']?resolve(BASE,a['allow-hosts']):null;
  if(!hostsPath)throw Error('Missing --allow-hosts. Review benchmark/approved-hosts.example.txt first.');
  const [csv,allowed]=await Promise.all([readFile(sitePath,'utf8'),readFile(hostsPath,'utf8')]);
  const hosts=allowed.split(/\r?\n/).map(s=>s.replace(/#.*/,'').trim()).filter(Boolean);
  const sites=prepareSites(csv,hosts,intRange(a['max-sites'],30,1,30,'--max-sites'));
  const labelCsv=a.labels?await readFile(resolve(BASE,a.labels),'utf8'):null;
  const labels=prepareLabels(labelCsv,sites);
  const delayMs=intRange(a['delay-ms'],1500,0,60000,'--delay-ms');
  const minTextChars=intRange(a['min-chars'],120,0,50000,'--min-chars');
  const maxPdfPages=intRange(a['max-pdf-pages'],8,1,15,'--max-pdf-pages');
  const htmlPages=intRange(a['html-pages'],3,1,4,'--html-pages');
  const patternMode=a['pattern-mode']||'local';
  if(!['local','api','none'].includes(patternMode))throw Error('--pattern-mode must be local|api|none');
  const strategy=a.strategy||'auto';
  if(!['auto','S01','S02','S03'].includes(strategy))throw Error('--strategy must be auto|S01|S02|S03');
  const browserMode=a.browser||'none';
  if(!['none','playwright'].includes(browserMode))throw Error('--browser must be none|playwright');
  const endpointRaw=a['extract-api']||a['worker-url'];
  if(a['extract-api']&&a['worker-url'])throw Error('Use only one of --extract-api and --worker-url');
  if(endpointRaw&&browserMode!=='none')throw Error('Use --browser on the remote server, not alongside --extract-api');
  const stamp=new Date().toISOString().replace(/[:.]/g,'-');
  const out=resolve(BASE,a.out||join('benchmark','results',stamp));
  process.stdout.write(`Preflight: ${sites.length} explicitly allowlisted candidates; patterns=${patternMode}; execution=${endpointRaw?'http-api':'local-node'}; browser=${browserMode}\n`);
  if(a['dry-run']){
    for(const site of sites)process.stdout.write(`  ${site.siteId} | ${site.companyName} | ${site.url}\n`);
    process.stdout.write('DRY RUN - no requests made. Review target permissions and manual labels.\n');return;
  }
  const extractEndpoint=endpointRaw?new URL('/api/extract',safeEndpoint(endpointRaw)):null;
  const extractToken=extractEndpoint?process.env.SCRAPPERS_API_TOKEN:null;
  if(extractEndpoint&&!extractToken)throw Error('SCRAPPERS_API_TOKEN required for --extract-api');
  if(patternMode==='api'&&!a['pattern-api'])throw Error('--pattern-api required when --pattern-mode api');
  const patternEndpoint=patternMode==='api'?new URL('/api/analyze',safeEndpoint(a['pattern-api'])):null;
  const patternToken=patternEndpoint?process.env.PATTERN_API_TOKEN:null;
  if(patternEndpoint&&!patternToken)throw Error('PATTERN_API_TOKEN required for --pattern-mode api');
  let inspectWebsite;
  if(patternMode==='local'){
    try{
      const path=pathToFileURL(resolve(BASE,'..','engine','pattern-systems','dist','inspect.js')).href;
      ({inspectWebsite}=await import(path));if(typeof inspectWebsite!=='function')throw Error('inspectWebsite missing');
    }catch(e){throw Error('Pattern Systems build missing; run its npm run build, or use --pattern-mode none/api. '+String(e.message||e))}
  }
  const browser=browserMode==='playwright'?createPlaywrightBrowserCapture():undefined;
  const detectPatterns=async site=>{
    if(patternMode==='none')return {status:'not_assessed'};
    const analysis=patternMode==='local'
      ?await inspectWebsite(site.url,{maxPages:2})
      :await boundedPost(patternEndpoint,{url:site.url,maxPages:2},patternToken,300_000);
    if(!['completed','partial'].includes(analysis.status))return {status:analysis.status||'failed',error:analysis.errors?.join(' | ')||'Pattern sampling did not finish'};
    const limited=limitedPatternAnalysis(analysis);if(!limited)throw Error('Invalid Pattern Systems assessments');
    return {status:analysis.status,analysis:limited};
  };
  const execute=async(site,patternAnalysis)=>{
    const request={url:site.url,mode:strategy,maxPdfPages,...(patternAnalysis?{patternAnalysis}:{})};
    if(extractEndpoint)return boundedPost(extractEndpoint,request,extractToken,700_000);
    return extract(request,{fetcher:fetch,...(browser?{browser}:{})},{allowedHosts:hosts,timeoutMs:8000,maxHtmlPages:htmlPages},patternAnalysis?'supplied':'none');
  };
  const config={siteCount:sites.length,patternMode,execution:extractEndpoint?'http-api':'local-node',strategy,delayMs,minTextChars,maxPdfPages,htmlPages,
    sources:{sites:a.sites||'benchmark/sites.example.csv',labels:a.labels||null,allowlist:'explicit file supplied'},
    browserAvailability:extractEndpoint?'Depends on configured HTTP service':browserMode==='playwright'?'Playwright requested; browser launch not verified':'Unavailable locally'};
  const batch=await runBenchmark({sites,labels,execute,detectPatterns,delayMs,minTextChars,config,
    onProgress:(r,i,total)=>process.stdout.write(`[${i}/${total}] ${r.siteId}  ${r.status}  ${r.finalStrategy||'n/a'}  chars=${r.textChars}  evidence=${r.evidenceCount}  usable=${r.usable}\n`)});
  const files=await writeArtifacts(out,batch);
  if(!labelCsv)await writeFile(join(out,'labels_to_review.csv'),buildReviewTemplate(sites),'utf8');
  const quality=batch.summary.quality,route=batch.summary.routing.initial;
  process.stdout.write(`\nCompleted ${batch.summary.totalSites} sites. Usable eligible: ${quality.usableEligible}/${quality.eligible} (${quality.usableRatePct??'n/a'}%).\n`);
  process.stdout.write(`Human-labeled first-route accuracy: ${route.correct}/${route.labeled} (${route.accuracyPct??'not measured'}%).\n`);
  process.stdout.write(`Outputs: ${out}\n  ${Object.values(files).map(p=>p.slice(out.length+1)).join('\n  ')}\n`);
  process.stdout.write('Results are experimental; no catalog-completeness or actual cost claims.\n');
}
main().catch(e=>{process.stderr.write('Benchmark failed: '+String(e.message||e)+'\n');process.exitCode=1});
