import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {readLocalUpdateStatus} from '../app/update-status.mjs';

async function fixture(fn){
 const root=await mkdtemp(join(tmpdir(),'pi-local-update-status-'));
 try{
  const dir=join(root,'local-data','pi-updates');
  await mkdir(dir,{recursive:true});
  await fn(dir,root);
 }finally{await rm(root,{recursive:true,force:true});}
}
test('legacy lab has no pending GitHub release',async()=>fixture(async(_,root)=>{
 assert.deepEqual(readLocalUpdateStatus(root),{installed:'legacy-local',staged:null,pending:false,recoveryPending:false});
}));
test('staged release and activated release are distinct',async()=>fixture(async(dir,root)=>{
 await writeFile(join(dir,'staged.json'),JSON.stringify({releaseId:'2026.11.27-canary.1'}));
 assert.equal(readLocalUpdateStatus(root).pending,true);
 await writeFile(join(dir,'installed.json'),JSON.stringify({releaseId:'2026.11.27-canary.1'}));
 assert.deepEqual(readLocalUpdateStatus(root),{installed:'2026.11.27-canary.1',staged:'2026.11.27-canary.1',pending:false,recoveryPending:false});
}));
test('bad or malformed release metadata is not displayed as trusted',async()=>fixture(async(dir,root)=>{
 await writeFile(join(dir,'installed.json'),JSON.stringify({releaseId:'<img onerror=alert(1)>'}));
 await writeFile(join(dir,'staged.json'),'invalid json');
 assert.deepEqual(readLocalUpdateStatus(root),{installed:'legacy-local',staged:null,pending:false,recoveryPending:false});
}));
test('incomplete activation is explicitly reported',async()=>fixture(async(dir,root)=>{
 await writeFile(join(dir,'journal.json'),'{}');
 assert.equal(readLocalUpdateStatus(root).recoveryPending,true);
}));
