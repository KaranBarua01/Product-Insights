import {test} from 'node:test';
import assert from 'node:assert/strict';
import {publicPilot,handleInsightsRoutes} from '../dist/insights-routes.js';
import {runEvidenceAi} from '../dist/ai-bridge.js';
import {managementHtml,managementCss,managementJs} from '../dist/management-ui.js';
import {pilotSnapshot} from '../dist/patricio-pilot.js';
import {vibrantThemeCss} from '../dist/vibrant-theme.js';

const origin='https://scrappers.example';
const req=(path,auth)=>new Request(origin+path,{headers:auth?{Authorization:`Bearer ${auth}`}:{}});
const sample={requestedUrl:'https://www.saginawcontrol.com/',sourceUrl:'https://www.saginawcontrol.com/',strategy:'S01',status:'completed',reason:'sample',content:{text:'We produce stainless steel industrial pumps. Stainless steel is listed in the published brochure.'},evidence:[],warnings:[],attempts:[],routing:{strategy:'S01',provenance:'remote',patternIds:['R01'],reason:'HTTP first'}};
test('pilot snapshot follows handoff and does not fabricate qualified suppliers',()=>{
  const data=publicPilot();
  assert.equal(data.counts.processRequirements,16);
  assert.equal(data.counts.candidateComponents,4);
  assert.equal(data.counts.excludedComponents,2);
  assert.equal(data.counts.syntheticSuppliers,10);
  assert.equal(data.counts.taxonomyReviewFlags,4);
  assert.equal(data.components.filter(c=>!c.excluded).reduce((a,c)=>a+c.requirements.length,0),16);
  assert.equal(data.suppliers.length,10);
  assert.equal(data.limitations.supplier_data,'synthetic_test');
  assert.equal(data.limitations.manufacturing_capability,'not_established');
  assert.equal(data.limitations.ai_used_by_patricio,false);
  assert.equal('factRecords' in data,false);
  assert.equal('sourceRecords' in data,false);
  assert.equal(pilotSnapshot.factRecords,undefined);
});
test('outcome pages are public but source-level evidence requires existing API token',async()=>{
  const env={SCRAPPERS_API_TOKEN:'private-token',AI:{}};
  assert.equal(handleInsightsRoutes(req('/insights'),env)?.status,200);
  const publicResponse=handleInsightsRoutes(req('/api/insights/pilot'),env);
  const publicData=await publicResponse.json();
  assert.equal(publicData.counts.processRequirements,16);
  assert.equal(publicData.sourceRecords,undefined);
  assert.equal(handleInsightsRoutes(req('/api/insights/pilot-detail'),env),undefined);
  const health=await handleInsightsRoutes(req('/api/insights/status'),env).json();
  assert.equal(health.aiConfigured,true);
  assert.equal(handleInsightsRoutes(req('/api/insights/missing'),env),undefined);
});
test('outcome dashboard has mobile layout, sidebar and no embedded credentials',()=>{
  assert.match(managementHtml,/Busch R5 RA 0100 F/);
  assert.match(managementHtml,/detail-drawer/);
  assert.match(managementHtml,/LIVE WEBSITE EXPERIMENT/);
  assert.match(managementCss,/@media\(max-width:600px\)/);
  assert.match(managementJs,/api\/insights\/analyze/);
  assert.match(managementJs,/api\/extract/);
  assert.doesNotMatch(managementHtml+managementJs,/private-token|PATTERN_API_TOKEN/);
  assert.doesNotThrow(()=>new Function(managementJs));
});
test('AI can only propose facts with verbatim quotes present in extracted website text',async()=>{
  let calls=0;
  const binding={run:async(model,args)=>{
    calls++;assert.equal(model,'@cf/meta/llama-3.3-70b-instruct-fp8-fast');
    assert.equal(args.max_tokens,550);
    return {response:{facts:[
      {category:'material',claim:'Site mentions stainless steel',quote:'stainless steel industrial pumps'},
      {category:'component',claim:'Site manufactures titanium rotors',quote:'titanium rotors with 50 micrometer precision'},
      {category:'secret',claim:'Bad category',quote:'stainless steel industrial pumps'}
    ]}};
  }};
  const result=await runEvidenceAi(binding,sample,true);
  assert.equal(result.status,'proposed');
  assert.equal(result.candidates.length,1);
  assert.equal(result.candidates[0].reviewStatus,'requires_human_verification');
  assert.equal(calls,1);
});
test('AI never fabricates when unavailable, disabled, or missing site text',async()=>{
  assert.equal((await runEvidenceAi(undefined,sample,true)).status,'not_configured');
  assert.equal((await runEvidenceAi(undefined,sample,false)).status,'not_requested');
  assert.equal((await runEvidenceAi({run:async()=>({response:{facts:[]}})},sample,true)).status,'no_grounded_facts');
  assert.equal((await runEvidenceAi({run:async()=>{throw Error('GPU down')}},sample,true)).status,'unavailable');
  assert.equal((await runEvidenceAi({run:async()=>({response:{facts:[]}})},{...sample,content:{text:'hey'}},true)).status,'no_extractable_text');
});

test('Daylight theme upgrades the outcome dashboard without changing its data or auth',async()=>{
  const style=handleInsightsRoutes(req('/insights/styles.css'),{});
  assert.equal(style.status,200);
  const css=await style.text();
  assert.match(css,/--bg:#f5f7ff/);
  assert.match(css,/--indigo:#4f46d9/);
  assert.match(css,/\.drawer\{/);
  assert.match(css,/@media\(prefers-reduced-motion:reduce\)/);
  assert.match(managementHtml,/color-scheme" content="light"/);
  assert.equal(css,managementCss+String.fromCharCode(10)+vibrantThemeCss);
});
