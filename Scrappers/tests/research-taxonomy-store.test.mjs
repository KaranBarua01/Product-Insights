import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {installTaxonomy,loadInstalledTaxonomy} from '../tools/research-taxonomy-store.mjs';
const sample=JSON.stringify([{code:'sector',label:'Industrial',children:[{code:'parts',label:'Parts',children:[{code:'pumps',label:'Pumps',children:[{code:'impellers',label:'Impellers'}]}]}]}]);
test('first-time taxonomy installation persists normalized nodes and metadata across reloads',async()=>{
  const folder=await mkdtemp(join(tmpdir(),'ij-taxonomy-'));
  try{
    const file=join(folder,'local-data','installed-taxonomy.json');
    assert.equal(await loadInstalledTaxonomy({storagePath:file}),null);
    const installed=await installTaxonomy(sample,{storagePath:file,fileName:'OEM Explorer.html'});
    assert.equal(installed.nodes.length,4);
    assert.equal(installed.manifest.levelCounts.L3,1);
    assert.equal(installed.manifest.sourceName,'OEM Explorer.html');
    const reloaded=await loadInstalledTaxonomy({storagePath:file});
    assert.deepEqual(reloaded.nodes,installed.nodes);
    assert.equal(reloaded.manifest.nodeHash,installed.manifest.nodeHash);
    assert.equal(reloaded.manifest.storage,'local_pc_only');
    assert.equal((await readFile(file,'utf8')).includes('<script>'),false);
  }finally{await rm(folder,{recursive:true,force:true});}
});
test('an invalid replacement does not destroy the installed taxonomy',async()=>{
  const folder=await mkdtemp(join(tmpdir(),'ij-taxonomy-'));
  try{
    const file=join(folder,'installed.json');
    const initial=await installTaxonomy(sample,{storagePath:file});
    await assert.rejects(()=>installTaxonomy('not a taxonomy',{storagePath:file}),/Expected JSON taxonomy/);
    const after=await loadInstalledTaxonomy({storagePath:file});
    assert.equal(after.manifest.nodeHash,initial.manifest.nodeHash);
  }finally{await rm(folder,{recursive:true,force:true});}
});
test('tampering with an installed taxonomy fails the integrity check',async()=>{
  const folder=await mkdtemp(join(tmpdir(),'ij-taxonomy-'));
  try{
    const file=join(folder,'installed.json');
    await installTaxonomy(sample,{storagePath:file});
    const payload=JSON.parse(await readFile(file,'utf8'));
    payload.nodes[3].label='Wrong label';
    await writeFile(file,JSON.stringify(payload),'utf8');
    await assert.rejects(()=>loadInstalledTaxonomy({storagePath:file}),/integrity check failed/);
  }finally{await rm(folder,{recursive:true,force:true});}
});
