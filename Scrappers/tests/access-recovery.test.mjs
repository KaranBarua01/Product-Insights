import test from 'node:test';
import assert from 'node:assert/strict';
import {assertRobots,fetchBounded,AccessFault,describeAccessFailure} from '../dist/safety.js';
import {extract} from '../dist/engine.js';
import {runResearchV3} from '../tools/research-v3.mjs';

const root='https://industrial.example.com/',host='industrial.example.com',hosts=[host],budget={timeoutMs:1000,maxBytes:2000};
const timeout=()=>new DOMException('Fixture timeout','TimeoutError');
const response=(status=200,body='Published industrial catalog.',headers={})=>new Response(body,{status,headers:{'content-type':'text/html',...headers}});
const redirect=to=>response(302,'',{location:to});
const fault=code=>e=>e instanceof AccessFault&&e.code===code;
const page=(url,status,reason='',links=[])=>({sourceUrl:url,status,reason,strategy:'S01',content:status==='completed'?{title:'Industrial catalog',text:'Product information and material specifications.',links}:{},evidence:[],warnings:[]});

test('a same-host redirect succeeds and preserves the actual source URL',async()=>{
  const seen=[];
  const out=await fetchBounded(root,hosts,async url=>{seen.push(url);return url===root?redirect('/products'):response()},budget);
  assert.deepEqual(seen,[root,root+'products']);assert.equal(out.url,root+'products');assert.equal(out.status,200);
});
test('cross-host redirects require explicit new seed approval, even if the other host is allowlisted',async()=>{
  const seen=[];
  await assert.rejects(fetchBounded(root,[...hosts,'other.example.com'],async url=>{seen.push(url);return redirect('https://other.example.com/')},budget),fault('redirect_policy'));
  assert.deepEqual(seen,[root]);
});
test('HTTPS downgrade is not followed',async()=>{
  let calls=0;
  await assert.rejects(fetchBounded(root,hosts,async()=>{calls++;return redirect('http://industrial.example.com/products')},budget),fault('redirect_policy'));
  assert.equal(calls,1);
});
test('same-host redirect cycles stop before another network request',async()=>{
  const seen=[];
  await assert.rejects(fetchBounded(root,hosts,async url=>{seen.push(url);return redirect(url===root?'/products':'/')},budget),fault('redirect_loop'));
  assert.deepEqual(seen,[root,root+'products']);
});
test('redirect depth is bounded',async()=>{
  let calls=0;
  await assert.rejects(fetchBounded(root,hosts,async()=>redirect('/step-'+(++calls)),budget),fault('redirect_limit'));
  assert.equal(calls,4);
});
test('missing redirect location is diagnosed',async()=>{
  await assert.rejects(fetchBounded(root,hosts,async()=>response(302,''),budget),fault('redirect_invalid'));
});
test('robots restrictions apply before following a same-host redirect',async()=>{
  const seen=[];
  await assert.rejects(fetchBounded(root,hosts,async url=>{seen.push(url);return redirect('/private/catalog')},{...budget,robotsRules:'User-agent: *\nDisallow: /private'}),fault('robots_denied'));
  assert.deepEqual(seen,[root]);
});
test('one transient header timeout is retried within the existing host guard',async()=>{
  const seen=[];
  const out=await fetchBounded(root,hosts,async url=>{seen.push(url);if(seen.length===1)throw timeout();return response()},budget);
  assert.equal(out.status,200);assert.deepEqual(seen,[root,root]);
});
test('persistent timeout stops after two calls with a distinct reason',async()=>{
  let calls=0;
  await assert.rejects(fetchBounded(root,hosts,async()=>{calls++;throw timeout()},budget),fault('timeout'));
  assert.equal(calls,2);
});
test('the retry allowance is shared across all redirects',async()=>{
  const seen=[];
  await assert.rejects(fetchBounded(root,hosts,async url=>{seen.push(url);if(seen.length===1||url!==root)throw timeout();return redirect('/products')},budget),fault('timeout'));
  assert.deepEqual(seen,[root,root,root+'products']);
});
test('explicit HTTP denial, rate limit and service unavailability are not retried',async()=>{
  for(const status of [401,403,429,503]){let calls=0;
    const out=await fetchBounded(root,hosts,async()=>{calls++;return response(status)},budget);
    assert.equal(out.status,status);assert.equal(calls,1);
  }
});
test('generic abort and network safety rejection are never retried',async()=>{
  for(const error of [new DOMException('Cancelled','AbortError'),new Error('Private DNS rejected')]){let calls=0;
    await assert.rejects(fetchBounded(root,hosts,async()=>{calls++;throw error},budget),e=>e===error);
    assert.equal(calls,1);
  }
});
test('robots timeout fails closed with transport rather than denial diagnostic',async()=>{
  const seen=[];
  const out=await extract({url:root,mode:'S01'},{fetcher:async url=>{seen.push(url);throw timeout()}},{allowedHosts:hosts,timeoutMs:1000});
  assert.equal(out.status,'blocked');assert.match(out.reason,/\[robots_unavailable\].*\[timeout\]/);
  assert.deepEqual(seen,[root+'robots.txt',root+'robots.txt']);assert.equal(out.attempts.length,0);
});
test('robots denial is a separate diagnosis and never fetches the seed',async()=>{
  const seen=[];
  const out=await extract({url:root,mode:'S01'},{fetcher:async url=>{seen.push(url);return response(200,'User-agent: *\nDisallow: /',{'content-type':'text/plain'})}},{allowedHosts:hosts});
  assert.equal(out.status,'blocked');assert.match(out.reason,/\[robots_denied\]/);assert.deepEqual(seen,[root+'robots.txt']);
});
test('robots 429 is not retried or reinterpreted as an unavailable document',async()=>{
  let calls=0;
  await assert.rejects(assertRobots(new URL(root),hosts,async()=>{calls++;return response(429)},1000),fault('rate_limited'));
  assert.equal(calls,1);
});
test('a redirect policy stop remains blocked in the extraction engine',async()=>{
  const seen=[];
  const out=await extract({url:root,mode:'S01'},{fetcher:async url=>{seen.push(url);return url.endsWith('/robots.txt')?response(404,''):redirect('https://other.example.com/')}},{allowedHosts:hosts});
  assert.equal(out.status,'blocked');assert.match(out.reason,/\[redirect_policy\]/);
  assert.deepEqual(seen,[root+'robots.txt',root]);
});
test('seed slash is preserved; explicit missing deep entry can recover once at the same-host root',async()=>{
  const seed=root+'outdated/catalog/',seen=[];
  const out=await runResearchV3({url:seed,maxPages:2,delayMs:0,extractPage:async url=>{seen.push(url);return url===seed?page(url,'failed','HTTP 404'):page(url,'completed')}});
  assert.deepEqual(seen,[seed,root]);assert.equal(out.coverage.visitedPages,2);assert.equal(out.status,'sampled');
  assert.equal(out.seedAccessAttempts.length,2);assert.equal(out.seedAccessAttempts[1].recovery,true);
});
test('no root recovery after policy denial or from the homepage itself or without remaining budget',async()=>{
  for(const [url,maxPages,status,reason] of [[root+'old',3,'blocked','Access policy: [robots_denied] HTTP 404'],[root,3,'failed','HTTP 404'],[root+'old',1,'failed','HTTP 410'],[root+'old',3,'failed','timeout']]){
    const seen=[];
    const out=await runResearchV3({url,maxPages,delayMs:0,extractPage:async target=>{seen.push(target);return page(target,status,reason)}});
    assert.deepEqual(seen,[url]);assert.equal(out.seedAccessAttempts.length,1);
  }
});
test('off-host response cannot trigger root recovery',async()=>{
  const seen=[];
  const out=await runResearchV3({url:root+'old',maxPages:3,delayMs:0,extractPage:async url=>{seen.push(url);return page('https://other.example.com/','failed','HTTP 404')}});
  assert.deepEqual(seen,[root+'old']);assert.equal(out.pages[0].status,'blocked');
});
test('site rate limit stops remaining queued work',async()=>{
  const seen=[];
  const out=await runResearchV3({url:root,maxPages:5,delayMs:0,extractPage:async url=>{
    seen.push(url);return url===root?page(url,'completed','',[{url:root+'products/a',label:'Product A'},{url:root+'products/b',label:'Product B'}]):page(url,'blocked','HTTP 429; no bypass attempted');
  }});
  assert.equal(seen.length,2);assert.equal(out.coverage.stopReason,'rate_limited');
});
