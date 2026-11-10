import {test} from 'node:test';
import assert from 'node:assert/strict';
import worker,{remotePatterns} from '../dist/worker.js';

const url='https://manufacturer.com/';
const assessment={patternId:'R01',status:'observed'};
const payload={status:'completed',assessments:[assessment]};

test('service binding sends authenticated pattern request rather than public fetch',async()=>{
  let calls=0;
  const env={PATTERN_API_URL:'https://insidejob-pattern-systems.injindiaops.workers.dev',PATTERN_API_TOKEN:'pattern-secret',PATTERN_SERVICE:{fetch:async request=>{
    calls++;
    assert.equal(new URL(request.url).pathname,'/api/analyze');
    assert.equal(request.headers.get('Authorization'),'Bearer pattern-secret');
    assert.deepEqual(await request.json(),{url,maxPages:2});
    return Response.json(payload);
  }}};
  assert.deepEqual((await remotePatterns(url,env))?.assessments,[assessment]);
  assert.equal(calls,1);
});

test('binding works without PATTERN_API_URL and missing token fails explicitly',async()=>{
  let calls=0;
  const service={fetch:async request=>{calls++;assert.equal(new URL(request.url).pathname,'/api/analyze');return Response.json(payload)}};
  assert.deepEqual((await remotePatterns(url,{PATTERN_SERVICE:service,PATTERN_API_TOKEN:'ok'}))?.assessments,[assessment]);
  await assert.rejects(()=>remotePatterns(url,{PATTERN_SERVICE:service}),/PATTERN_API_TOKEN/);
  assert.equal(calls,1);
});

test('upstream 401 fails rather than fabricating patterns',async()=>{
  await assert.rejects(()=>remotePatterns(url,{PATTERN_SERVICE:{fetch:async()=>new Response('Unauthorized',{status:401})},PATTERN_API_TOKEN:'incorrect'}),/Pattern API HTTP 401/);
  assert.equal(await remotePatterns(url,{PATTERN_API_TOKEN:'unused'}),undefined);
});

test('worker health and routed extraction confirm internal remote patterns',async()=>{
  const previous=globalThis.fetch;
  const html='<html><head><title>Factory</title></head><body><main><h1>Industrial manufacturing</h1><p>'+('Industrial pump manufacturing engineering and machining. '.repeat(10))+'</p></main></body></html>';
  globalThis.fetch=async request=>{
    const path=new URL(String(request instanceof Request?request.url:request)).pathname;
    return path==='/robots.txt'
      ? new Response('User-agent: *\nAllow: /\n',{headers:{'Content-Type':'text/plain'}})
      : new Response(html,{headers:{'Content-Type':'text/html'}});
  };
  try {
    const env={SCRAPPERS_API_TOKEN:'scrapers-secret',ALLOWED_HOSTS:'manufacturer.com',PATTERN_API_TOKEN:'patterns-secret',PATTERN_SERVICE:{fetch:async()=>Response.json(payload)}};
    const health=await (await worker.fetch(new Request('https://scrapers.example/health'),env)).json();
    assert.equal(health.configured.patternApi,true);
    assert.equal(health.configured.patternTransport,'service-binding');
    const request=new Request('https://scrapers.example/api/extract',{method:'POST',headers:{Authorization:'Bearer scrapers-secret','Content-Type':'application/json'},body:JSON.stringify({url,mode:'auto'})});
    const response=await worker.fetch(request,env);
    assert.equal(response.status,200);
    const result=await response.json();
    assert.equal(result.status,'completed');
    assert.equal(result.strategy,'S01');
    assert.equal(result.routing.provenance,'remote');
    assert.deepEqual(result.routing.patternIds,['R01']);
    assert.equal(result.warnings.some(w=>/Pattern API unavailable/.test(w)),false);
  }finally{globalThis.fetch=previous}
});
