import {LIBRARY,detectorCoverage,normalizeResults,exportMatrixCsv} from './patterns.js';
import {inspectWebsite,validatePublicUrl} from './inspect.js';
import type {WebsiteAnalysis} from './types.js';

interface Database {prepare(sql:string):{bind(...args:unknown[]):{run():Promise<unknown>;first<T>():Promise<T|null>;all<T>():Promise<{results:T[]}>}}}
export interface Env {DB?:Database;PATTERN_SYSTEM_API_TOKEN?:string}
const json=(value:unknown,status=200)=>new Response(JSON.stringify(value,null,2),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const err=(message:string,status=400)=>json({error:message},status);
function authorized(request:Request,env:Env):Response|null{
  if(!env.PATTERN_SYSTEM_API_TOKEN)return err('Set PATTERN_SYSTEM_API_TOKEN as a Worker secret before using analysis or stored reports',503);
  const header=request.headers.get('Authorization')??'';
  if(header!==`Bearer ${env.PATTERN_SYSTEM_API_TOKEN}`)return err('Bearer token required',401);
  return null;
}
async function bodyJson(request:Request):Promise<unknown>{
  const len=Number(request.headers.get('content-length')??0);if(len>64000)throw Error('Body limit: 64 KB');
  const t=await request.text();if(t.length>64000)throw Error('Body limit: 64 KB');
  return JSON.parse(t);
}
async function saveRun(db:Database|undefined,a:WebsiteAnalysis){
  if(!db)return;
  await db.prepare('INSERT OR REPLACE INTO runs (id,url,host,company_name,created_at,status,result_json) VALUES (?,?,?,?,?,?,?)').bind(a.id,a.requestedUrl,a.host,a.companyName??null,a.createdAt,a.status,JSON.stringify(a)).run();
}
async function getRuns(db:Database,limit=100):Promise<WebsiteAnalysis[]>{
  const r=await db.prepare('SELECT result_json FROM runs ORDER BY created_at DESC LIMIT ?').bind(Math.max(1,Math.min(500,limit))).all<{result_json:string}>();
  return r.results.map(x=>JSON.parse(x.result_json) as WebsiteAnalysis);
}
const ui=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>InsideJob Pattern Systems</title><style>body{font:16px/1.55 system-ui;margin:0;background:#f5f7fa;color:#182b3c}main{max-width:960px;margin:45px auto;padding:0 20px}h1{font-size:2rem}small{color:#526a7d}form{display:grid;gap:12px;background:white;border:1px solid #ddd;padding:25px;border-radius:10px}input,button{font:inherit;padding:10px;border-radius:6px;border:1px solid #abbac6}button{background:#173e55;color:white;cursor:pointer}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#122c3b;color:#e5f5fc;padding:20px;border-radius:8px;min-height:80px}a{color:#165d78}</style></head><body><main><p><small>INSIDEJOB / PRODUCT INSIGHTS / RESEARCH</small></p><h1>Website Pattern Systems V1</h1><p>Inspect a public industrial website and review observed patterns, unverified leads, evidence, and gaps. Analyses are bounded HTTP samples, not exhaustive crawls.</p><form id="f"><label>Website URL <input name="url" type="url" placeholder="https://manufacturer.example" required style="width:95%"></label><label>Company (optional) <input name="companyName" style="width:95%"></label><label>Worker API token <input type="password" name="token" required style="width:95%" autocomplete="off"></label><label>Maximum sample pages <input type="number" name="maxPages" min="1" max="5" value="3"></label><button type="submit">Inspect website</button></form><h2>Result</h2><pre id="out">Ready. A token configured in Cloudflare is required.</pre><p><a href="/api/patterns">Browse the pattern library</a> · <a href="/health">Health check</a></p></main><script>document.getElementById('f').addEventListener('submit',async e=>{e.preventDefault();const f=e.target;const d=Object.fromEntries(new FormData(f));const o=document.getElementById('out');o.textContent='Inspecting...';try{const r=await fetch('/api/analyze',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+d.token},body:JSON.stringify({url:d.url,companyName:d.companyName,maxPages:Number(d.maxPages)})});const j=await r.json();o.textContent=JSON.stringify(j,null,2)}catch(x){o.textContent=String(x)}})</script></body></html>`;
export default {
 async fetch(request:Request,env:Env):Promise<Response>{
   try{
     const url=new URL(request.url);const route=url.pathname;
     if(request.method==='GET'&&route==='/')return new Response(ui,{headers:{'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'self'",'X-Content-Type-Options':'nosniff'}});
     if(request.method==='GET'&&route==='/health')return json({status:'ok',module:'website-pattern-systems',version:'0.1.0',coverage:detectorCoverage(),dbConfigured:!!env.DB});
     if(request.method==='GET'&&route==='/api/patterns')return json({schemaVersion:'1.0',counts:detectorCoverage(),patterns:LIBRARY});
     if(['/api/analyze','/api/batch','/api/runs','/api/report'].includes(route)||route.startsWith('/api/runs/')){
       const unauthorized=authorized(request,env);if(unauthorized)return unauthorized;
     }
     if(request.method==='POST'&&route==='/api/analyze'){
       const input=await bodyJson(request) as {url?:unknown;companyName?:unknown;maxPages?:unknown};
       if(typeof input?.url!=='string')return err('url must be an absolute HTTP/HTTPS URL');
       validatePublicUrl(input.url);
       const a=await inspectWebsite(input.url,{companyName:typeof input.companyName==='string'?input.companyName:undefined,maxPages:typeof input.maxPages==='number'?input.maxPages:undefined});
       await saveRun(env.DB,a);return json(a);
     }
     if(request.method==='POST'&&route==='/api/batch'){
       const input=await bodyJson(request) as {websites?:unknown;maxPages?:unknown};
       if(!Array.isArray(input?.websites)||input.websites.length===0||input.websites.length>3)return err('websites must contain 1-3 entries per request');
       const items=input.websites as {url?:unknown;companyName?:unknown}[];
       for(const site of items)if(typeof site?.url!=='string')return err('Each website must have a url string');
       const runs:WebsiteAnalysis[]=[];
       for(const site of items){const u=site.url as string;validatePublicUrl(u);const a=await inspectWebsite(u,{companyName:typeof site.companyName==='string'?site.companyName:undefined,maxPages:typeof input.maxPages==='number'?input.maxPages:2});runs.push(a);await saveRun(env.DB,a);}
       return json({runs,report:normalizeResults(runs)});
     }
     if(request.method==='GET'&&route==='/api/runs'){
       if(!env.DB)return err('D1 not bound; run records are available only in immediate API responses',501);
       return json({runs:await getRuns(env.DB,Number(url.searchParams.get('limit')??100))});
     }
     if(request.method==='GET'&&route.startsWith('/api/runs/')){
       if(!env.DB)return err('D1 not bound',501);
       const id=route.slice('/api/runs/'.length);if(!/^[0-9a-f-]{36}$/.test(id))return err('Invalid run ID');
       const r=await env.DB.prepare('SELECT result_json FROM runs WHERE id = ?').bind(id).first<{result_json:string}>();
       return r?json(JSON.parse(r.result_json)):err('Run not found',404);
     }
     if(request.method==='GET'&&route==='/api/report'){
       if(!env.DB)return err('D1 not bound; use /api/batch for an immediate report',501);
       const runs=await getRuns(env.DB,500);
       if(url.searchParams.get('format')==='csv')return new Response(exportMatrixCsv(runs),{headers:{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="website-pattern-matrix.csv"','Cache-Control':'no-store'}});
       return json(normalizeResults(runs));
     }
     return err('Route not found',404);
   }catch(e){return err(String(e instanceof Error?e.message:e),400);}
 }
};
