import {pilotSnapshot} from './patricio-pilot.js';
import {managementHtml,managementCss,managementJs} from './management-ui.js';

interface DemoEnv {AI?:unknown}
const baseHeaders={
  'Cache-Control':'no-store',
  'X-Content-Type-Options':'nosniff',
  'Referrer-Policy':'no-referrer',
  'X-Frame-Options':'DENY'
};
const csp="default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";
const json=(value:unknown,status=200)=>Response.json(value,{status,headers:baseHeaders});

/** Sanitized, reproducible summaries only. Private handoff facts/rationales are never included. */
export function publicPilot(){
  return {
    title:pilotSnapshot.title,source:pilotSnapshot.source,version:pilotSnapshot.version,
    limitations:pilotSnapshot.limitations,counts:pilotSnapshot.counts,
    components:pilotSnapshot.components.map(c=>({
      id:c.id,name:c.name,roleClass:c.roleClass,material:c.material,excluded:c.excluded,
      requirements:c.requirements.map(r=>({req_id:r.req_id,any_of:r.any_of,role:r.role,plausibility:r.plausibility,conditions:r.conditions,
      evidenceRefs:r.reasoning.map(t=>({rule:t.rule,via_rule:t.via_rule,facts:t.facts,sources:t.sources,geometry_confirmed:t.geometry_confirmed}))}))
    })),
    suppliers:pilotSnapshot.suppliers.map(s=>({
      id:s.id,name:s.name,totals:s.totals,
      components:s.components.map(c=>({id:c.id,name:c.name,category:c.category,
      requirements:c.requirements.map(r=>({req_id:r.req_id,status:r.status,is_core:r.is_core,matched_original_text:r.matched_original_text,relation:r.relation}))}))
    })),
    reviewFlags:pilotSnapshot.reviewFlags.map(f=>({flag_id:f.flag_id,resolution:f.resolution,review_with:f.review_with}))
  };
}

export function handleInsightsRoutes(request:Request,env:DemoEnv):Response|undefined{
  const path=new URL(request.url).pathname;
  if(request.method!=='GET')return undefined;
  if(path==='/insights')return new Response(managementHtml,{headers:{...baseHeaders,'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':csp}});
  if(path==='/insights/styles.css')return new Response(managementCss,{headers:{...baseHeaders,'Content-Type':'text/css; charset=utf-8'}});
  if(path==='/insights/app.js')return new Response(managementJs,{headers:{...baseHeaders,'Content-Type':'text/javascript; charset=utf-8'}});
  if(path==='/api/insights/pilot')return json(publicPilot());
  if(path==='/api/insights/status')return json({version:'0.1.0',ui:'outcome-first',pilot:'deterministic-handoff-snapshot',dataStatus:'synthetic_test',aiConfigured:!!env.AI,liveBridge:'ai-fact-candidates-require-human-review'});
  return undefined;
}
