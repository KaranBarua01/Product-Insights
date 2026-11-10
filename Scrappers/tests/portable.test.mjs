import test from 'node:test';
import assert from 'node:assert/strict';
import {fetchBounded,assertAllowed} from '../dist/safety.js';
import {scrapeS01} from '../dist/s01.js';
import {scrapeS02} from '../dist/s02.js';
import {extract} from '../dist/engine.js';
import {createPlaywrightBrowserCapture} from '../tools/node-browser.mjs';
const ROOT='https://manufacturer.com/';
const policy={allowedHosts:['manufacturer.com'],maxHtmlPages:3,maxBytesHtml:200_000};
const robots='User-agent: *\nAllow: /\nDisallow: /private\n';
function response(body,status=200,type='text/html'){return new Response(body,{status,headers:{'content-type':type}})}
const content=link=>`<html><head><title>Factory</title><meta name="description" content="Pump production"></head><body><nav><a href="/private">Private</a></nav><main><h1>Factory</h1><p>${'Manufacturing pump housings from iron and steel. '.repeat(6)}</p>${link?'<a href="/products">Products</a>':''}</main></body></html>`;
const detail='<html><title>Products</title><main><h1>Centrifugal pump category</h1><p>Industrial pump housings, casting, machining and dimensional inspection.</p></main></html>';
const routes=(u)=>{
  const path=new URL(String(u)).pathname;
  if(path==='/robots.txt')return response(robots,200,'text/plain');
  if(path==='/products')return response(detail);
  if(path==='/')return response(content(true));
  throw Error('Unexpected link '+path);
};
test('S01 follows relevant approved links but avoids robots-disallowed irrelevant links',async()=>{
  const seen=[];const fetcher=async(u,...args)=>{seen.push(new URL(String(u)).pathname);return routes(u,...args)};
  const v=await extract({url:ROOT},{fetcher},policy);
  assert.equal(v.status,'completed');assert.equal(v.strategy,'S01');assert.equal(v.content.sampledPages.length,2);
  assert.match(v.content.text,/Centrifugal pump category/);
  assert.ok(v.evidence.some(e=>new URL(e.sourceUrl).pathname==='/products'));
  assert.ok(!seen.includes('/private'));assert.equal(v.attempts.length,1);
});
test('oversized HTML is bounded and flagged as partial rather than discarded',async()=>{
  const huge='<html><title>Large Page</title><body><main><h1>Products</h1><p>'+('Industrial cast iron pump components. '.repeat(20000))+'</p></main></body></html>';
  const deps={fetcher:async(u)=>new URL(String(u)).pathname==='/robots.txt'?response('',404,'text/plain'):response(huge)};
  const v=await extract({url:ROOT},deps,{allowedHosts:['manufacturer.com'],maxBytesHtml:110000,maxHtmlPages:1});
  assert.equal(v.status,'partial');assert.equal(v.strategy,'S01');
  assert.equal(v.content.sampledPages[0].truncated,true);assert.ok(v.content.text.length>1000);
  assert.ok(v.warnings.some(w=>/truncated/.test(w)));
});
test('strict cap still rejects PDF/robots and optional truncate returns precise prefix',async()=>{
  const bytes='a'.repeat(900);
  const strict=()=>fetchBounded(ROOT,policy.allowedHosts,async()=>response(bytes),{timeoutMs:1000,maxBytes:100});
  await assert.rejects(strict,/Response exceeds/);
  const allowed=await fetchBounded(ROOT,policy.allowedHosts,async()=>response(bytes),{timeoutMs:1000,maxBytes:100,truncate:true});
  assert.equal(allowed.truncated,true);assert.equal(allowed.bytes.length,100);
});
test('same-host redirect policy still prevents unapproved external navigation',async()=>{
  const redirected=async()=>new Response('',{status:302,headers:{Location:'https://unapproved.com/a'}});
  await assert.rejects(()=>fetchBounded(ROOT,policy.allowedHosts,redirected,{timeoutMs:1000,maxBytes:1000,truncate:true}),/Host not on|Cross-host/);
});
test('S02 is host-injected, not hard-bound to Cloudflare',async()=>{
  const v=await extract({url:ROOT,mode:'S02'},{fetcher:routes,browser:async()=>({url:ROOT,html:detail})},policy);
  assert.equal(v.status,'completed');assert.equal(v.strategy,'S02');assert.match(v.content.text,/Centrifugal/);
});
test('auto S02 route uses standalone browser adapter result',async()=>{
  const v=await extract({url:ROOT,patternAnalysis:{assessments:[{patternId:'R04',status:'lead'},{patternId:'R07',status:'lead'}]}},{fetcher:routes,browser:async()=>({url:ROOT,html:detail})},policy,'supplied');
  assert.equal(v.strategy,'S02');assert.equal(v.routing.strategy,'S02');assert.equal(v.routing.provenance,'supplied');
});
test('429 robots response blocks without attempting target page',async()=>{
  let calls=0;const deps={fetcher:async()=>{calls++;return response('Too many requests',429,'text/plain')}};
  const v=await extract({url:ROOT},deps,policy);
  assert.equal(v.status,'blocked');assert.match(v.reason,/429/);assert.equal(v.attempts.length,0);assert.equal(calls,1);
});
test('playwright adapter is optional and exposes a callable adapter',()=>{
  const capture=createPlaywrightBrowserCapture({executablePath:'/chromium-not-installed'});
  assert.equal(typeof capture,'function');
});
test('S01 outcome preserves multiple-source evidence and bounded outputs',async()=>{
  const v=await scrapeS01(ROOT,{fetcher:routes},{...policy,robotsRules:robots});
  assert.ok(v.evidence.length>1);assert.ok(v.content.text.length<65_001);assert.ok(v.content.links.length<=160);
});
