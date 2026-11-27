import test from 'node:test';
import assert from 'node:assert/strict';
import {publicAddress,approvedUrl,selectPinnedAddress,createPinnedFetcher} from './pinned-fetch.mjs';
test('reject private, reserved, mapped and transition addresses',()=>{
 for(const ip of ['127.0.0.1','10.1.1.1','169.254.169.254','100.64.0.1','192.168.1.1','172.16.0.1','0.0.0.0','198.18.0.1','192.0.2.1','::1','::ffff:127.0.0.1','fe80::1','fc00::1','2002:7f00:1::1','2001:db8::1'])assert.equal(publicAddress(ip),false,ip);
 assert.equal(publicAddress('8.8.8.8'),true);assert.equal(publicAddress('2606:4700:4700::1111'),true);
});
test('mixed DNS results fail closed',()=>{
 assert.throws(()=>selectPinnedAddress([{address:'8.8.8.8',family:4},{address:'127.0.0.1',family:4}]),/policy/);
 assert.deepEqual(selectPinnedAddress([{address:'8.8.8.8',family:4}]),{address:'8.8.8.8',family:4});
});
test('unapproved origin, scheme, credentials and port rejected',()=>{
 for(const url of ['http://maker.com/','https://other.com/','https://a:b@maker.com/','https://maker.com:444/','https://127.0.0.1/'])assert.throws(()=>approvedUrl(url,'maker.com'));
 assert.equal(approvedUrl('https://maker.com/products','maker.com').pathname,'/products');
});
test('unsafe requests fail before connecting',async()=>{
 let dnsCalls=0;const t=createPinnedFetcher('maker.com',{lookupFn:async()=>{dnsCalls++;return [{address:'127.0.0.1',family:4}]}});
 await assert.rejects(t.fetcher('https://maker.com/',{method:'POST',redirect:'manual'}),/GET/);
 await assert.rejects(t.fetcher('https://maker.com/',{redirect:'follow'}),/GET/);assert.equal(dnsCalls,0);
 await assert.rejects(t.fetcher('https://maker.com/',{redirect:'manual'}),/policy/);assert.equal(dnsCalls,1);assert.equal(t.stats().requests,1);
});

// Exercise the body path, not just DNS preflight. Use Node streams and
// deterministic late events, with no external network connections.
import {responseBody} from './pinned-fetch.mjs';
import {PassThrough} from 'node:stream';
import {setImmediate as tick} from 'node:timers/promises';

test('cancel while buffered response data remains does not enqueue after closure',async()=>{
  for(let i=0;i<100;i++){
    const source=new PassThrough();let bytes=0;
    const r=new Response(responseBody(source,n=>{bytes+=n}));
    source.write(Buffer.alloc(16384,65));source.write(Buffer.alloc(16384,66));
    const reader=r.body.getReader();const first=await reader.read();
    assert.equal(first.done,false);assert.equal(bytes,first.value.byteLength);
    await reader.cancel();
    source.emit('data',Buffer.from('late data'));source.emit('error',Error('late socket error'));source.emit('end');
    assert.equal((await reader.read()).done,true);assert.equal(source.destroyed,true);
    await tick();
  }
});
test('cancel before first read for redirect or oversized response is safe',async()=>{
  const source=new PassThrough();let bytes=0;
  const r=new Response(responseBody(source,n=>{bytes+=n}),{status:302});
  source.write(Buffer.alloc(1024));await r.body.cancel();
  source.emit('data',Buffer.alloc(1024));source.emit('aborted');
  assert.equal(bytes,0);assert.equal(source.destroyed,true);
});
test('ordinary complete body preserves every byte and closes once',async()=>{
  const source=new PassThrough();let bytes=0;
  const r=new Response(responseBody(source,n=>{bytes+=n}));
  source.write(Buffer.from('abc'));source.end(Buffer.from('def'));
  assert.equal(await r.text(),'abcdef');assert.equal(bytes,6);
});
test('byte budget failure rejects read and ignores later socket events',async()=>{
  const source=new PassThrough();let bytes=0;
  const r=new Response(responseBody(source,n=>{bytes+=n;if(bytes>4)throw Error('network_byte_budget')}));
  const reader=r.body.getReader();source.write(Buffer.from('12345'));
  await assert.rejects(reader.read(),/network_byte_budget/);
  assert.equal(source.destroyed,true);source.emit('data',Buffer.from('late'));
  assert.equal(bytes,5);
});
test('premature close is reported as incomplete instead of successful EOF',async()=>{
  const source=new PassThrough(),r=new Response(responseBody(source,()=>{}));
  const reader=r.body.getReader();const read=reader.read();source.destroy();
  await assert.rejects(read,/closed before completion/);
});
test('cancelling a pending read releases it without an unhandled stream error',async()=>{
  const source=new PassThrough(),r=new Response(responseBody(source,()=>{}));
  const reader=r.body.getReader();const read=reader.read();await reader.cancel();
  assert.equal((await read).done,true);
  source.emit('error',Error('late abort'));source.emit('data',Buffer.from('late'));
  await tick();assert.equal(source.destroyed,true);
});
