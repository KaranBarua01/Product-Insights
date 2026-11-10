import {test} from 'node:test';
import assert from 'node:assert/strict';
import {cloudflareBrowserCapture} from '../dist/cloudflare-adapter.js';

const URL='https://manufacturer.com/products';
const hosts=['manufacturer.com'];
const robots='User-agent: *\nAllow: /\nDisallow: /private';

test('Cloudflare Quick Action adapter is optional, host-scoped and parses HTML',async()=>{
  let calls=0;
  const browser={quickAction:async(action,options)=>{
    calls++;
    assert.equal(action,'content');
    assert.equal(options.url,URL);
    assert.equal(options.allowRequestPattern.length,1);
    assert.match(options.allowRequestPattern[0],/manufacturer/);
    const encoded=options.allowRequestPattern[0];
    const permitted=new RegExp(encoded.slice(1,-2),'i');
    assert.ok(permitted.test('https://manufacturer.com/products'));
    assert.equal(permitted.test('https://manufacturer.com.evil.org/'),false);
    assert.ok(options.rejectResourceTypes.includes('image'));
    return new Response('<html><main>Industrial pumps</main></html>',{status:200});
  }};
  const result=await cloudflareBrowserCapture(browser)(URL,hosts,robots);
  assert.match(result.html,/Industrial pumps/);
  assert.equal(result.url,URL);assert.equal(result.truncated,false);assert.equal(calls,1);
});

test('Cloudflare adapter rejects disallowed hosts and robots paths before browser calls',async()=>{
  let calls=0;
  const browser={quickAction:async()=>{calls++;return new Response('should not be reached')}};
  const capture=cloudflareBrowserCapture(browser);
  await assert.rejects(()=>capture('https://unapproved.com/',hosts,robots),/Host not on ALLOWED_HOSTS/);
  await assert.rejects(()=>capture('https://manufacturer.com/private',hosts,robots),/robots.txt disallows/);
  assert.equal(calls,0);
});

test('Cloudflare adapter rejects missing browser binding and non-2xx responses',async()=>{
  assert.throws(()=>cloudflareBrowserCapture(undefined),/binding unavailable/);
  const capture=cloudflareBrowserCapture({quickAction:async()=>new Response('forbidden',{status:403})});
  await assert.rejects(()=>capture(URL,hosts,robots),/Browser Run HTTP 403/);
});

test('Cloudflare adapter bounds rendered HTML bytes and marks truncation',async()=>{
  const body='A'.repeat(1_300_000);
  const capture=cloudflareBrowserCapture({quickAction:async()=>new Response(body)});
  const result=await capture(URL,hosts,robots);
  assert.equal(result.truncated,true);
  assert.equal(result.html.length,1_250_000);
});
