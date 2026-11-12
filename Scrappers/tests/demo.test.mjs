import {test} from 'node:test';
import assert from 'node:assert/strict';
import worker from '../dist/worker.js';
import {demoHtml,demoStyles,demoScript} from '../dist/demo.js';
import {managementHtml,managementCss,managementJs} from '../dist/management-ui.js';
import {vibrantThemeCss} from '../dist/vibrant-theme.js';
const origin='https://product-insights-scrappers-prototype.example';
const req=(path)=>new Request(origin+path);
const env={SCRAPPERS_API_TOKEN:'super-secret-test-token',ALLOWED_HOSTS:'www.saginawcontrol.com,www.dometic.com',PATTERN_API_TOKEN:'private-pattern-token'};

test('company demo has a standalone responsive UI and never embeds runtime secrets',async()=>{
  const homepage=await worker.fetch(req('/'),env);
  assert.equal(homepage.status,302);
  assert.equal(homepage.headers.get('location'),'/demo');
  const response=await worker.fetch(req('/demo'),env);
  assert.equal(response.status,200);
  assert.match(response.headers.get('content-type')??'',/text\/html/);
  assert.match(response.headers.get('content-security-policy')??'',/script-src 'self'/);
  assert.match(response.headers.get('content-security-policy')??'',/connect-src 'self'/);
  assert.equal(response.headers.get('cache-control'),'no-store');
  const html=await response.text();
  assert.match(html,/Product Insights \| Working Prototype/);
  assert.match(html,/Busch R5 RA 0100 F/);
  assert.match(html,/LIVE WEBSITE EXPERIMENT/);
  assert.match(html,/Pattern Systems/);
  assert.equal(html,managementHtml);
  for(const secret of [env.SCRAPPERS_API_TOKEN,env.PATTERN_API_TOKEN])assert.doesNotMatch(html,new RegExp(secret));
});

test('demo static assets are served with restrictive headers and JS syntax is valid',async()=>{
  const css=await worker.fetch(req('/demo/styles.css'),env);
  const js=await worker.fetch(req('/demo/app.js'),env);
  assert.match(css.headers.get('content-type')??'',/text\/css/);
  assert.match(js.headers.get('content-type')??'',/javascript/);
  const cssBody=await css.text();
  assert.match(cssBody,/@media\(max-width:600px\)/);
  assert.ok(cssBody.endsWith(vibrantThemeCss));
  assert.match(cssBody, /\.hero-journey\{/);
  const source=await js.text();
  assert.equal(source,managementJs);
  assert.doesNotMatch(source,/localStorage|sessionStorage|document\.cookie/);
  assert.match(source,/\/api\/extract/);
  assert.match(source,/tokenField\.value=''/);
  assert.doesNotThrow(()=>new Function(source));
  assert.ok(managementCss.length>1000);
});

test('pattern catalog is proxied over internal service binding without exposing upstream tokens',async()=>{
  let calls=0;
  const response=await worker.fetch(req('/api/pattern-catalog'),{
    ...env,PATTERN_SERVICE:{fetch:async request=>{
      calls++;
      assert.equal(new URL(request.url).pathname,'/api/patterns');
      assert.equal(request.headers.get('authorization'),null);
      return Response.json({patterns:[
        {id:'R01',name:'Readable HTML without browser execution',group:'delivery',secret:'not-disclosed'},
        {id:'R03',name:'Embedded structured application state',group:'delivery'},
        {id:'invalid',name:'Invalid',group:'delivery'}
      ]});
    }}
  });
  assert.equal(response.status,200);
  const json=await response.json();
  assert.equal(json.patterns.length,2);
  assert.equal(calls,1);
  assert.equal(json.patterns[0].secret,undefined);
  assert.equal(json.patterns[0].name,'Readable HTML without browser execution');
});

test('demo does not relax extraction authentication or allowlist',async()=>{
  const unauthenticated=await worker.fetch(new Request(origin+'/api/extract',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:'https://www.saginawcontrol.com/'})}),env);
  assert.equal(unauthenticated.status,401);
  const disallowed=await worker.fetch(new Request(origin+'/api/extract',{method:'POST',headers:{Authorization:'Bearer '+env.SCRAPPERS_API_TOKEN,'Content-Type':'application/json'},body:JSON.stringify({url:'https://not-approved.example/'})}),env);
  assert.equal(disallowed.status,400);
  const missing=await worker.fetch(req('/api/pattern-catalog'),{});
  assert.equal(missing.status,503);
});
