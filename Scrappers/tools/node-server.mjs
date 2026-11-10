#!/usr/bin/env node
/** Runtime-neutral extraction HTTP adapter: standard Node.js, no Cloudflare dependency. */
import {createServer} from 'node:http';
import {timingSafeEqual} from 'node:crypto';
import {resolve,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {extract,limitedPatternAnalysis} from '../dist/engine.js';
import {assertAllowed,normalizeAllowedHosts} from '../dist/safety.js';
import {createPlaywrightBrowserCapture} from './node-browser.mjs';

const host=process.env.SCRAPPERS_HOST||'127.0.0.1';
const port=Number(process.env.PORT||8787);
const token=process.env.SCRAPPERS_API_TOKEN||'';
const allowlist=normalizeAllowedHosts(process.env.ALLOWED_HOSTS||'');
const browserChoice=process.env.SCRAPPERS_BROWSER||'none';
if(!token||token.length<16)throw Error('Set SCRAPPERS_API_TOKEN to at least 16 characters');
if(!allowlist.length)throw Error('ALLOWED_HOSTS is required. List exact approved hostnames, separated by commas');
if(!Number.isInteger(port)||port<1||port>65535)throw Error('PORT must be 1-65535');
if(!['none','playwright'].includes(browserChoice))throw Error('SCRAPPERS_BROWSER must be none or playwright');
const browser=browserChoice==='playwright'?createPlaywrightBrowserCapture():undefined;
const MAX_BODY=9_000;
function send(res,data,status=200){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));}
function authorized(value){
  if(!value?.startsWith('Bearer '))return false;
  const a=Buffer.from(value.slice(7)),b=Buffer.from(token);
  return a.length===b.length&&timingSafeEqual(a,b);
}
async function parseRequest(req){
  if(Number(req.headers['content-length']||0)>MAX_BODY)throw Error('Request body exceeds limit');
  let text='';for await(const chunk of req){text+=chunk.toString('utf8');if(text.length>MAX_BODY)throw Error('Request body exceeds limit')}
  const body=JSON.parse(text);if(!body||typeof body!=='object'||Array.isArray(body))throw Error('Expected JSON object');
  if(typeof body.url!=='string'||body.url.length>2048)throw Error('url must be absolute HTTP(S) URL');
  assertAllowed(body.url,allowlist);
  if(body.mode!==undefined&&!['auto','S01','S02','S03'].includes(body.mode))throw Error('Invalid mode');
  if(body.maxPdfPages!==undefined&&(!Number.isInteger(body.maxPdfPages)||body.maxPdfPages<1||body.maxPdfPages>15))throw Error('maxPdfPages must be 1-15');
  if(body.patternAnalysis!==undefined&&!limitedPatternAnalysis(body.patternAnalysis))throw Error('Invalid patternAnalysis');
  return body;
}
async function localPatterns(raw){
  const file=pathToFileURL(resolve(dirname(fileURLToPath(import.meta.url)),'..','..','engine','pattern-systems','dist','inspect.js')).href;
  const {inspectWebsite}=await import(file);
  const result=await inspectWebsite(raw,{maxPages:2});
  if(!['completed','partial'].includes(result.status))throw Error(`Pattern sampling: ${result.errors?.join(' | ')||result.status}`);
  return limitedPatternAnalysis(result);
}
async function getPatterns(raw){
  const mode=process.env.SCRAPPERS_PATTERN_MODE||'none';
  if(mode==='local')return localPatterns(raw);
  if(mode==='none')return undefined;
  throw Error('SCRAPPERS_PATTERN_MODE must be none or local');
}
let active=0;
const server=createServer(async(req,res)=>{
  const pathname=new URL(req.url||'/',`http://${host}`).pathname;
  if(req.method==='GET'&&pathname==='/health')return send(res,{module:'scrappers',version:'0.2',runtime:'node',strategies:['S01','S02','S03'],configured:{browser:!!browser,patterns:process.env.SCRAPPERS_PATTERN_MODE==='local'}});
  if(req.method==='GET'&&pathname==='/api/strategies')return send(res,{strategies:{S01:'Bounded multi-page HTML',S02:'Playwright local or remote CDP',S03:'PDF text + OCR-needed signals'}});
  if(req.method!=='POST'||pathname!=='/api/extract')return send(res,{error:'Not found'},404);
  if(!authorized(req.headers.authorization))return send(res,{error:'Unauthorized'},401);
  if(active>=2)return send(res,{error:'Server busy. Retry later.'},429);
  active++;
  try{
    const body=await parseRequest(req),warnings=[];
    let patternAnalysis=limitedPatternAnalysis(body.patternAnalysis),provenance='none';
    if(patternAnalysis)provenance='supplied';
    else if(process.env.SCRAPPERS_PATTERN_MODE==='local'){
      try{patternAnalysis=await getPatterns(body.url);if(patternAnalysis)provenance='local'}
      catch(e){warnings.push('Local Pattern Systems unavailable: '+String(e.message||e));}
    }
    const result=await extract({url:body.url,mode:body.mode||'auto',maxPdfPages:body.maxPdfPages||8,patternAnalysis},{fetcher:fetch,...(browser?{browser}:{})},{allowedHosts:allowlist,timeoutMs:8000,maxHtmlPages:3},provenance);
    result.warnings.unshift(...warnings);return send(res,result);
  }catch(e){return send(res,{error:String(e.message||e).slice(0,350)},400);}
  finally{active--}
});
server.requestTimeout=40_000;
server.listen(port,host,()=>process.stdout.write(`Scrappers Node HTTP API listening on http://${host}:${port} (allowlisted hosts: ${allowlist.length}, browser: ${browserChoice})\n`));
