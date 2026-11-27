import test from 'node:test';
import assert from 'node:assert/strict';
import {patchAgent,patchStart} from './bridge-patch.mjs';
import {startUpdateWatcher} from './watch.mjs';
const baseAgent=[
 "import {createHash} from 'node:crypto';",
 "export const ACTIONS=Object.freeze(['health','ollama_health','run_tests','collect_website','benchmark_failed34']);",
 " async function execute(j){",
 " return {status:'completed'}",
 " }"
].join('\n');
const baseStart=[
 "import {fileURLToPath} from 'node:url';",
 "const port=Number(process.env.PI_LAB_PORT||8791);let ownedOllama=null,lab=null,queueAgent=null,closing=false;",
 "function stop(code=0){if(closing)return;closing=true;queueAgent?.stop();}",
 "queueAgent.start();console.log(queueToken?",
].join('\n');
test('bridge adds only bounded update actions, no shell capability',()=>{
 const changed=patchAgent(baseAgent);
 assert.match(changed,/update_status/);assert.match(changed,/update_check/);assert.match(changed,/update_stage/);
 assert.match(changed,/return \{status:'completed',action:j.action,/);
 assert.ok(!changed.includes('eval('));assert.ok(!changed.includes('exec('));
 assert.equal(patchAgent(changed),changed);
});
test('startup bridge enables watcher and clean stop, idempotently',()=>{
 const changed=patchStart(baseStart);
 assert.match(changed,/startUpdateWatcher\(root\)/);assert.match(changed,/updateWatcher\?\.stop\(\)/);
 assert.equal(patchStart(changed),changed);
});
test('unexpected old code anchors fail closed',()=>{
 assert.throws(()=>patchAgent('different agent'),/anchor/);
 assert.throws(()=>patchStart('different start'),/anchor/);
});
test('watcher stages only new releases, never applies automatically',async()=>{
 let seen=0,staged=0,logs=[],warns=[];
 const watcher=startUpdateWatcher('/virtual',{intervalMs:900000,
  checkFn:async()=>({available:++seen===1,staged:false}),
  stageFn:async()=>{staged++;return {status:'staged',releaseId:'r2'}},
  logger:{log:x=>logs.push(x),warn:x=>warns.push(x)}});
 try{await watcher.poll();await watcher.poll();
  assert.equal(staged,1);assert.equal(seen,2);
  assert.match(logs[0],/next restart/);assert.deepEqual(warns,[]);
 }finally{watcher.stop()}
});
test('watcher handles unavailable channel without modifying live app',async()=>{
 let stages=0,warnings=[];
 const watcher=startUpdateWatcher('/virtual',{intervalMs:900000,checkFn:async()=>{throw Error('HTTP 404')},
  stageFn:async()=>{stages++},logger:{log(){},warn:x=>warnings.push(x)}});
 try{await watcher.poll();await watcher.poll();assert.equal(stages,0);assert.equal(warnings.length,1);}
 finally{watcher.stop()}
});
