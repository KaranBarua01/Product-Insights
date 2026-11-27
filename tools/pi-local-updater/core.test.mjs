import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,mkdir,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {validateManifest,sourceUrl,check,stage,activate,rollback,status,recover} from './core.mjs';
const hash=s=>createHash('sha256').update(s).digest('hex');
const COMMIT='a'.repeat(40),OLD='export const version = 1;\n',NEW='export const version = 2;\n';
const manifest=(files=[{path:'app/main.mjs',bytes:Buffer.byteLength(NEW),sha256:hash(NEW),fromSha256:hash(OLD)}])=>({
 schemaVersion:'pi-local-update/v1',channel:'stable',sourceRepo:'KaranBarua01/Product-Insights',
 sourceCommit:COMMIT,releaseId:'r1-demo',minNode:24,files
});
const file=(path,before,after)=>({path,bytes:Buffer.byteLength(after),sha256:hash(after),fromSha256:before===null?null:hash(before)});
async function fixture(){
 const root=await mkdtemp(join(tmpdir(),'pi-update-'));
 await mkdir(join(root,'app'),{recursive:true});await writeFile(join(root,'app/main.mjs'),OLD);
 await mkdir(join(root,'data'));await writeFile(join(root,'data','knowledge.sqlite'),'keep knowledge');
 await mkdir(join(root,'results'));await writeFile(join(root,'results','report.json'),'keep report');
 await mkdir(join(root,'local-data'));await writeFile(join(root,'local-data','token.txt'),'keep secret');
 return root;
}
const fakeFetch=(m,contentMap={ 'app/main.mjs':NEW })=>async(url,init)=>{
 assert.equal(init.redirect,'error');assert.match(url,/^https:\/\/raw\.githubusercontent\.com\//);
 if(url.endsWith('/local/unified-lab/channels/stable.json'))return new Response(JSON.stringify(m),{status:200});
 const p=url.split('/local/unified-lab/')[1];
 return Object.hasOwn(contentMap,p)?new Response(contentMap[p],{status:200}):new Response('absent',{status:404});
};
async function protectedFiles(root){
 assert.equal(await readFile(join(root,'data/knowledge.sqlite'),'utf8'),'keep knowledge');
 assert.equal(await readFile(join(root,'results/report.json'),'utf8'),'keep report');
 assert.equal(await readFile(join(root,'local-data/token.txt'),'utf8'),'keep secret');
}
test('strict manifest validation and unsafe paths denied',()=>{
 const good=manifest();assert.equal(validateManifest(good).files.length,1);
 for(const path of ['data/knowledge.sqlite','results/report.json','runtime/foo.mjs','local-data/key.json','app/../data/secret.mjs','app//evil.mjs','app\\escape.mjs','app/.env','app/node_modules/x.js','../escape.mjs','X:/evil.mjs','app/a.exe','tools/pi-local-updater/core.mjs']){
  assert.throws(()=>validateManifest(manifest([file(path,null,'x')])),path);
 }
 for(const edit of [{sourceRepo:'someone-else/repo'},{sourceCommit:'main'},{channel:'unstable'},{minNode:16},{unknown:true},{files:[...good.files,good.files[0]]},{files:[]}])assert.throws(()=>validateManifest({...good,...edit}));
});
test('only immutable GitHub raw URL is constructed for approved file',()=>{
 const m=manifest();assert.equal(sourceUrl(m,'app/main.mjs'),'https://raw.githubusercontent.com/KaranBarua01/Product-Insights/'+COMMIT+'/local/unified-lab/app/main.mjs');
 assert.throws(()=>sourceUrl(m,'app/unknown.mjs'));
});
test('check is read-only and does not create local metadata',async()=>{
 const root=await fixture();try{const r=await check(root,{fetcher:fakeFetch(manifest())});
  assert.equal(r.available,true);assert.equal(r.installed,'legacy-local');await protectedFiles(root);
 }finally{await rm(root,{recursive:true,force:true})}
});
test('stage verifies expected baseline, origin and SHA-256 without altering running source',async()=>{
 const root=await fixture();try{
  const m=manifest();const s=await stage(root,{manifest:m,fetcher:fakeFetch(m)});
  assert.equal(s.status,'staged');assert.equal(await readFile(join(root,'app/main.mjs'),'utf8'),OLD);
  assert.equal((await status(root)).staged.releaseId,m.releaseId);await protectedFiles(root);
 }finally{await rm(root,{recursive:true,force:true})}
});
test('offline activation executes smoke, switches files, and rollback restores exact originals',async()=>{
 const root=await fixture();try{
  const m=manifest([...manifest().files,file('app/extra.js',null,'export const other=1;\n')]);
  await stage(root,{manifest:m,fetcher:fakeFetch(m,{'app/main.mjs':NEW,'app/extra.js':'export const other=1;\n'})});
  await assert.rejects(activate(root,{offline:async()=>false}),/Stop localhost/);
  let smokeCalls=0;const a=await activate(root,{offline:async()=>true,smoke:async()=>{smokeCalls++}});
  assert.equal(a.status,'activated');assert.equal(smokeCalls,1);
  assert.equal(await readFile(join(root,'app/main.mjs'),'utf8'),NEW);
  assert.equal((await status(root)).installed.releaseId,'r1-demo');
  await protectedFiles(root);
  await assert.rejects(rollback(root,{offline:async()=>false}),/Stop localhost/);
  const b=await rollback(root,{offline:async()=>true});assert.equal(b.status,'rolled_back');
  assert.equal(await readFile(join(root,'app/main.mjs'),'utf8'),OLD);
  await assert.rejects(readFile(join(root,'app/extra.js')),e=>e.code==='ENOENT');
  assert.equal((await status(root)).installed,null);
  assert.equal((await status(root)).rejected?.releaseId,'r1-demo');
  assert.equal((await check(root,{fetcher:fakeFetch(m)})).available,false);await protectedFiles(root);
 }finally{await rm(root,{recursive:true,force:true})}
});
test('failed post-update smoke restores original files automatically',async()=>{
 const root=await fixture();try{
  await stage(root,{manifest:manifest(),fetcher:fakeFetch(manifest())});
  await assert.rejects(activate(root,{offline:async()=>true,smoke:async()=>{throw Error('fixture regression failure')}}),/fixture regression/);
  assert.equal(await readFile(join(root,'app/main.mjs'),'utf8'),OLD);
  assert.equal((await status(root)).journal,null);
  assert.equal((await status(root)).rejected?.reason,'failed_smoke_or_activation');
  await assert.rejects(stage(root,{manifest:manifest(),fetcher:fakeFetch(manifest())}),/quarantined/);await protectedFiles(root);
 }finally{await rm(root,{recursive:true,force:true})}
});
test('wrong source hash cannot be staged or executed',async()=>{
 const root=await fixture();try{
  const m=manifest();
  await assert.rejects(stage(root,{manifest:m,fetcher:fakeFetch(m,{'app/main.mjs':'MALICIOUS CONTENT'})}),/SHA-256/);
  assert.equal(await readFile(join(root,'app/main.mjs'),'utf8'),OLD);
  assert.equal((await status(root)).staged,null);await protectedFiles(root);
 }finally{await rm(root,{recursive:true,force:true})}
});
test('operator modifications after staging abort without overwriting',async()=>{
 const root=await fixture();try{
  await stage(root,{manifest:manifest(),fetcher:fakeFetch(manifest())});
  await writeFile(join(root,'app/main.mjs'),'CUSTOM MODIFICATION');
  await assert.rejects(activate(root,{offline:async()=>true}),/Local file changed/);
  assert.equal(await readFile(join(root,'app/main.mjs'),'utf8'),'CUSTOM MODIFICATION');
 }finally{await rm(root,{recursive:true,force:true})}
});
test('tampered staged bytes cannot activate',async()=>{
 const root=await fixture();try{
  await stage(root,{manifest:manifest(),fetcher:fakeFetch(manifest())});
  await writeFile(join(root,'local-data/pi-updates/staging/r1-demo/app/main.mjs'),'TAMPERED');
  await assert.rejects(activate(root,{offline:async()=>true}),/Staged file hash mismatch/);
  assert.equal(await readFile(join(root,'app/main.mjs'),'utf8'),OLD);
 }finally{await rm(root,{recursive:true,force:true})}
});
test('symbolic-link escape is refused without touching outside',async(t)=>{
 const root=await fixture(),outside=await mkdtemp(join(tmpdir(),'pi-outside-'));
 try{
  await rm(join(root,'app/main.mjs'));await writeFile(join(outside,'victim.mjs'),OLD);
  try{await symlink(join(outside,'victim.mjs'),join(root,'app/main.mjs'))}catch(e){if(['EPERM','EACCES'].includes(e.code)){t.skip('Symlink privileges unavailable');return}throw e}
  await assert.rejects(stage(root,{manifest:manifest(),fetcher:fakeFetch(manifest())}),/Symbolic link/);
  assert.equal(await readFile(join(outside,'victim.mjs'),'utf8'),OLD);
 }finally{await rm(root,{recursive:true,force:true});await rm(outside,{recursive:true,force:true})}
});
test('interrupted activation journal can recover without touching user data',async()=>{
 const root=await fixture();try{
  await mkdir(join(root,'local-data/pi-updates/backups/r1-demo/app'),{recursive:true});
  await writeFile(join(root,'local-data/pi-updates/backups/r1-demo/app/main.mjs'),OLD);
  await writeFile(join(root,'app/main.mjs'),NEW);
  await writeFile(join(root,'local-data/pi-updates/journal.json'),JSON.stringify({releaseId:'r1-demo',files:[{path:'app/main.mjs',existed:true,beforeSha256:hash(OLD)}],previous:null}));
  const r=await recover(root);assert.equal(r.status,'rolled_back_incomplete');
  assert.equal(await readFile(join(root,'app/main.mjs'),'utf8'),OLD);
  assert.equal((await status(root)).journal,null);assert.equal((await status(root)).rejected?.reason,'interrupted_activation');await protectedFiles(root);
 }finally{await rm(root,{recursive:true,force:true})}
});
test('a successful release cannot be mistaken for a different installed release',async()=>{
 const root=await fixture();try{
  await stage(root,{manifest:manifest(),fetcher:fakeFetch(manifest())});await activate(root,{offline:async()=>true});
  const r=await stage(root,{manifest:manifest(),fetcher:fakeFetch(manifest())});
  assert.equal(r.status,'already_installed');
 }finally{await rm(root,{recursive:true,force:true})}
});

test('repeated stage reuses verified file without another network request',async()=>{
 const root=await fixture();
 try{
  await stage(root,{manifest:manifest(),fetcher:fakeFetch(manifest())});
  const noNetwork=async()=>{throw Error('network should not be called')};
  const s=await stage(root,{manifest:manifest(),fetcher:noNetwork});
  assert.equal(s.status,'already_staged');
  assert.equal(await readFile(join(root,'app/main.mjs'),'utf8'),OLD);
  await protectedFiles(root);
 }finally{await rm(root,{recursive:true,force:true})}
});
