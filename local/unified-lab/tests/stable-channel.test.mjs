import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {validateManifest} from '../../../tools/pi-local-updater/core.mjs';

const repo=fileURLToPath(new URL('../../../',import.meta.url));
const manifest=validateManifest(JSON.parse(readFileSync(join(repo,'local/unified-lab/channels/stable.json'),'utf8')));
test('stable source commit exists in already-reviewed main history',()=>{
 assert.equal(manifest.channel,'stable');
 assert.equal(manifest.sourceRepo,'KaranBarua01/Product-Insights');
 execFileSync('git',['merge-base','--is-ancestor',manifest.sourceCommit,'origin/main'],{cwd:repo,windowsHide:true});
});
test('pinned immutable GitHub release files match the declared byte and sha256 values',()=>{
 for(const file of manifest.files){
  const bytes=execFileSync('git',['show',manifest.sourceCommit+':local/unified-lab/'+file.path],{cwd:repo,maxBuffer:1024*1024,windowsHide:true});
  assert.equal(bytes.byteLength,file.bytes,file.path);
  assert.equal(createHash('sha256').update(bytes).digest('hex'),file.sha256,file.path);
 }
});
test('source-only app manifest excludes mutable local state and unbounded deployment',()=>{
 assert.ok(manifest.files.length>0);
 for(const f of manifest.files){
  assert.doesNotMatch(f.path,/^(?:data|results|runtime|local-data|node_modules|secrets)\//);
  assert.ok(f.bytes<=500_000);
  assert.ok(f.path.startsWith('app/')||f.path.startsWith('tests/')||f.path.startsWith('updater/')||f.path.startsWith('benchmark/')||f.path.startsWith('engine/'));
 }
});
