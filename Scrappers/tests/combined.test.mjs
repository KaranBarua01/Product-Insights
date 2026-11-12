import {test} from 'node:test';
import assert from 'node:assert/strict';
import {publicPilot,handleInsightsRoutes} from '../dist/insights-routes.js';
import {runEvidenceAi,selectAiSources} from '../dist/ai-bridge.js';
import {JS_DEFINITIONS,buildJsProfile,selectJsSources,jsProfileToAiReview} from '../dist/js-profile.js';
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
    assert.equal(args.max_tokens,900);
    return {response:{facts:[
      {category:'material',claim:'Site mentions stainless steel',quote:'stainless steel industrial pumps',sourceId:1},
      {category:'component',claim:'Site manufactures titanium rotors',quote:'titanium rotors with 50 micrometer precision',sourceId:1},
      {category:'secret',claim:'Bad category',quote:'stainless steel industrial pumps',sourceId:1}
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

test('AI receives product-page evidence from all three EPC-style source pages, not just the homepage',async()=>{
  const home='EPC Power utility scale power conversion and grid solutions. '.repeat(155);
  const product1='M System Modular Grid-Forming Inverter, one platform engineered for modern grid applications. '.repeat(80);
  const product2='M Rack liquid-cooled power conversion equipment for AI and grid infrastructure. '.repeat(75);
  const sources=[
    {sourceUrl:'https://www.epcpower.com/',title:'EPC Power',text:home},
    {sourceUrl:'https://www.epcpower.com/products/m-system',title:'M System',text:product1},
    {sourceUrl:'https://www.epcpower.com/products/m-rack',title:'M Rack',text:product2}
  ];
  let prompt;
  const binding={run:async(_model,input)=>{
    prompt=input.messages[1].content;
    assert.match(prompt,/M System Modular Grid-Forming Inverter/);
    assert.match(prompt,/M Rack liquid-cooled power conversion/);
    assert.equal((prompt.match(/SOURCE \d\nURL:/g)||[]).length,3);
    return {response:{facts:[
      {category:'product',claim:'M System is a grid-forming inverter',quote:'M System Modular Grid-Forming Inverter',sourceId:1},
      {category:'product',claim:'M Rack uses liquid cooling',quote:'M Rack liquid-cooled power conversion equipment',sourceId:2},
      {category:'technical_attribute',claim:'A fabricated specification absent from sources',quote:'99.999999 percent efficiency',sourceId:1},
      {category:'product',claim:'M Rack misattributed to homepage',quote:'M Rack liquid-cooled power conversion equipment',sourceId:3}
    ]}};
  }};
  const result=await runEvidenceAi(binding,{...sample,content:{text:home+'\n\n'+product1+'\n\n'+product2,sourceSections:sources}},true);
  assert.equal(result.status,'proposed');
  assert.equal(result.candidates.length,2);
  assert.equal(result.candidates[0].sourceUrl,sources[1].sourceUrl);
  assert.equal(result.candidates[1].sourceUrl,sources[2].sourceUrl);
  assert.equal(result.diagnostics.sourcePagesConsidered,3);
  assert.equal(result.diagnostics.rejectedSuggestions,2);
});
test('AI cites the matching source instead of assigning all product quotes to homepage',async()=>{
  const source={...sample,content:{text:'The homepage contains generic copy',sourceSections:[
    {sourceUrl:'https://www.epcpower.com/',title:'Homepage',text:'Power conversion overview and company news.'},
    {sourceUrl:'https://www.epcpower.com/products/m-rack',title:'M Rack',text:'M Rack is a modular grid forming inverter for industrial applications.'}
  ]}};
  const picked=selectAiSources(source);
  assert.equal(picked[0].sourceUrl,'https://www.epcpower.com/products/m-rack');
  const binding={run:async()=>({response:{facts:[{category:'product',claim:'M Rack is an inverter',quote:'M Rack is a modular grid forming inverter',sourceId:1}]}})};
  const result=await runEvidenceAi(binding,source,true);
  assert.equal(result.status,'proposed');
  assert.equal(result.candidates[0].sourceUrl,picked[0].sourceUrl);
});
test('no grounded facts reports whether model proposed unsupported quotes without inventing fallback claims',async()=>{
  const result=await runEvidenceAi({run:async()=>({response:{facts:[{category:'product',claim:'Unsupported',quote:'This exact text is nowhere to be found',sourceId:1}]}})},sample,true);
  assert.equal(result.status,'no_grounded_facts');
  assert.equal(result.candidates.length,0);
  assert.equal(result.diagnostics.modelSuggestions,1);
  assert.equal(result.diagnostics.rejectedSuggestions,1);
  assert.match(result.detail,/none passed exact quote/);
});

test('JS1–JS10 definitions are complete, ordered and faithful to the specification',()=>{
  assert.deepEqual(JS_DEFINITIONS.map(x=>x.code),['JS1','JS2','JS3','JS4','JS5','JS6','JS7','JS8','JS9','JS10']);
  assert.equal(JS_DEFINITIONS[4].title,'Manufacturing Processes');
  assert.equal(JS_DEFINITIONS[5].title,'Manufacturing Capabilities');
  assert.equal(JS_DEFINITIONS[6].title,'Supply Chain Insights');
});
test('JS profile grounds roles, products, JS5 and JS6 separately and rejects invented buyer RFQs',async()=>{
  const sections=[
    {sourceUrl:'https://www.epcpower.com/',title:'EPC Power',text:'We design and manufacture all power conversion systems in the USA. We serve data centers and utility scale energy storage.'},
    {sourceUrl:'https://www.epcpower.com/products/m-system',title:'M System',text:'M System is a modular grid forming inverter. A technical datasheet is available.'},
    {sourceUrl:'https://www.epcpower.com/products/m-rack',title:'M Rack',text:'M Rack is a liquid cooled power conversion system for data centers.'}
  ];
  let called=0;
  const ai={run:async(_model,args)=>{
    called++;assert.equal(args.max_tokens,2200);
    assert.match(args.messages[1].content,/We design and manufacture/);
    assert.match(args.messages[1].content,/M Rack is a liquid cooled/);
    return {response:{facts:[
      {js:'JS1',claim:'Company says it designs and manufactures power conversion systems',quote:'We design and manufacture all power conversion systems in the USA.',sourceId:1},
      {js:'JS3',claim:'M System is a modular inverter',quote:'M System is a modular grid forming inverter',sourceId:2},
      {js:'JS8',claim:'Serves data centers',quote:'We serve data centers and utility scale energy storage.',sourceId:1},
      {js:'JS6',claim:'Owns a foundry',quote:'casting and foundry operations at this plant',sourceId:1},
      {js:'JS7',claim:'Has a confirmed RFQ for foundry parts',quote:'We are currently purchasing 1000 pump housings',sourceId:1},
      {js:'JS3',claim:'M Rack incorrectly attributed to homepage',quote:'M Rack is a liquid cooled power conversion system',sourceId:1}
    ]}};
  }};
  const extraction={...sample,sourceUrl:sections[0].sourceUrl,requestedUrl:sections[0].sourceUrl,content:{title:'EPC Power',text:sections.map(s=>s.text).join('\n'),sampledPages:sections.map(s=>({url:s.sourceUrl,title:s.title,textChars:s.text.length,truncated:false})),sourceSections:sections}};
  const sourceOrder=selectJsSources(extraction).map(x=>x.url);
  assert.deepEqual(sourceOrder,sections.map(s=>s.sourceUrl));
  const result=await buildJsProfile(ai,extraction);
  assert.equal(called,1);assert.equal(result.sections.length,10);assert.equal(result.status,'proposed');
  assert.equal(result.coverage.acceptedClaims,3);assert.equal(result.coverage.rejectedSuggestions,3);
  assert.equal(result.sections.find(s=>s.code==='JS6').status,'not_found_in_sample');
  assert.equal(result.sections.find(s=>s.code==='JS7').status,'not_found_in_sample');
  assert.equal(result.sections.find(s=>s.code==='JS10').status,'coverage_report');
  assert.equal(result.sections.find(s=>s.code==='JS3').claims[0].sourceUrl,sections[1].sourceUrl);
  const basic=jsProfileToAiReview(result);
  assert.equal(basic.candidates.length,3);
  assert.ok(basic.candidates.every(c=>c.reviewStatus==='requires_human_verification'));
});
test('JS profile never fills missing sections or invents supplier/manufacturing conclusions',async()=>{
  const base={...sample,content:{title:'Company sample',text:'This company offers industrial equipment.'}};
  const empty=await buildJsProfile({run:async()=>({response:{facts:[]}})},base);
  assert.equal(empty.status,'no_grounded_facts');
  assert.equal(empty.sections.filter(s=>s.status==='not_found_in_sample').length,9);
  assert.equal(empty.sections.find(s=>s.code==='JS10').status,'coverage_report');
  const missing=await buildJsProfile(undefined,base);
  assert.equal(missing.status,'not_configured');
  assert.equal(missing.sections.filter(s=>s.status==='not_analysed').length,9);
});

test('JS1–JS10 company profile is visible and accessible in the management demo',()=>{
  assert.match(managementHtml,/id="js-profile"/);
  assert.match(managementHtml,/id="js-profile-checkbox" checked/);
  assert.match(managementHtml,/id="js-profile-grid"/);
  assert.match(managementHtml,/href="#js-profile"/);
  assert.match(managementJs,/function showJsProfile\(profile\)/);
  assert.match(managementJs,/function openJsProfileSection\(code\)/);
  assert.match(managementJs,/sectionsWithClaims/);
  assert.match(managementJs,/buildProfile/);
  assert.match(vibrantThemeCss,/\.js-profile-grid\{/);
  assert.doesNotThrow(()=>new Function(managementJs));
});
