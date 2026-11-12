import {demoHtml,demoStyles,demoScript} from './demo.js';
import {managementHtml,managementCss,managementJs} from './management-ui.js';
import {handleInsightsRoutes} from './insights-routes.js';

interface DemoEnv {
  AI?:unknown;
  PATTERN_API_URL?:string;
  PATTERN_SERVICE?:{fetch(request:Request):Promise<Response>};
}
const baseHeaders={
  'Cache-Control':'no-store',
  'X-Content-Type-Options':'nosniff',
  'Referrer-Policy':'no-referrer',
  'X-Frame-Options':'DENY'
};
const csp="default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";
const json=(data:unknown,status=200)=>Response.json(data,{status,headers:baseHeaders});

async function catalog(env:DemoEnv):Promise<Response>{
  if(!env.PATTERN_SERVICE&&!env.PATTERN_API_URL)return json({error:'Pattern Systems not configured'},503);
  try{
    const url=new URL('/api/patterns',env.PATTERN_API_URL??'https://pattern-service.internal');
    if(url.protocol!=='https:')return json({error:'Pattern Systems endpoint must be HTTPS'},503);
    const request=new Request(url,{method:'GET',headers:{Accept:'application/json'},signal:AbortSignal.timeout(9000)});
    const response=env.PATTERN_SERVICE?await env.PATTERN_SERVICE.fetch(request):await fetch(request);
    if(!response.ok)throw Error('Catalog upstream error');
    if(Number(response.headers.get('content-length')||0)>180_000)throw Error('Catalog oversized');
    const raw=await response.text();if(raw.length>180_000)throw Error('Catalog oversized');
    const payload=JSON.parse(raw) as {patterns?:unknown};
    if(!Array.isArray(payload.patterns))throw Error('Invalid catalog');
    const patterns=payload.patterns
      .filter((x):x is {id:string;name:string;group:string}=>
        !!x&&typeof x==='object'&&typeof x.id==='string'&&/^[A-Z][0-9]{2}$/.test(x.id)&&
        typeof x.name==='string'&&x.name.length<=180&&typeof x.group==='string'&&x.group.length<=30)
      .slice(0,70)
      .map(x=>({id:x.id,name:x.name,group:x.group}));
    return json({source:'insidejob-pattern-systems',patterns,count:patterns.length});
  }catch{return json({error:'Pattern catalog temporarily unavailable'},502)}
}

/** Public read-only demo and catalog. Extraction remains authenticated in worker.ts. */
export async function handleDemoRequest(request:Request,env:DemoEnv):Promise<Response|undefined>{
  if(request.method!=='GET')return undefined;
  const insight=handleInsightsRoutes(request,env);if(insight)return insight;
  const path=new URL(request.url).pathname;
  if(path==='/')return new Response(null,{status:302,headers:{...baseHeaders,Location:'/demo'}});
  if(path==='/demo')return new Response(managementHtml,{headers:{...baseHeaders,'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':csp}});
  if(path==='/demo/styles.css')return new Response(managementCss,{headers:{...baseHeaders,'Content-Type':'text/css; charset=utf-8'}});
  if(path==='/demo/app.js')return new Response(managementJs,{headers:{...baseHeaders,'Content-Type':'text/javascript; charset=utf-8'}});
  if(path==='/demo/legacy')return new Response(demoHtml.replaceAll('/demo/styles.css','/demo/legacy/styles.css').replaceAll('/demo/app.js','/demo/legacy/app.js'),{headers:{...baseHeaders,'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':csp}});
  if(path==='/demo/legacy/styles.css')return new Response(demoStyles,{headers:{...baseHeaders,'Content-Type':'text/css; charset=utf-8'}});
  if(path==='/demo/legacy/app.js')return new Response(demoScript,{headers:{...baseHeaders,'Content-Type':'text/javascript; charset=utf-8'}});
  if(path==='/api/pattern-catalog')return catalog(env);
  return undefined;
}
