import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {createServer} from 'node:net';
import {once} from 'node:events';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {setTimeout as wait} from 'node:timers/promises';

async function freePort(){
  const s=createServer();
  s.listen(0,'127.0.0.1');await once(s,'listening');
  const port=s.address().port;
  s.close();await once(s,'close');
  return port;
}
test('Stage 2 local app serves a real installed taxonomy, review queue and safe offline status', {timeout:20000},async()=>{
  const folder=await mkdtemp(join(tmpdir(),'stage2-lab-'));
  let child,logs='';
  try{
    const file=join(folder,'taxonomy.json');
    await writeFile(file,JSON.stringify([{code:'industry',label:'Industrial',children:[
      {code:'tools',label:'Industrial Tools',children:[{code:'cutting',label:'Cutting Tools',
        children:[{code:'milling',label:'Milling Cutters'}]}]}]}]),'utf8');
    const port=await freePort(),origin='http://127.0.0.1:'+port;
    child=spawn(process.execPath,[resolve('tools/research-lab.mjs')],{
      cwd:resolve('.'),env:{...process.env,RESEARCH_LAB_PORT:String(port),
        RESEARCH_LAB_TAXONOMY_FILE:file,RESEARCH_LAB_AI_URL:'',RESEARCH_LAB_AI_TOKEN:''},
      stdio:['ignore','pipe','pipe']});
    child.stdout.on('data',chunk=>{logs+=chunk.toString();});
    child.stderr.on('data',chunk=>{logs+=chunk.toString();});
    let healthy=null;
    for(let i=0;i<85;i++){
      if(child.exitCode!==null)throw Error('Local Lab exited: '+logs);
      try{const r=await fetch(origin+'/health');if(r.ok){healthy=await r.json();break;}}catch{}
      await wait(100);
    }
    assert.ok(healthy,'Lab did not start: '+logs);
    assert.equal(healthy.taxonomyLoaded,4);
    assert.equal(healthy.stage2AiConfigured,false);
    const html=await (await fetch(origin+'/')).text();
    assert.match(html,/Stage 2/);
    assert.match(html,/Publish approved working edition/);

    assert.match(html,/Product Insights · Intelligence Lab/);
    assert.match(html,/id="mode-business"/);
    assert.match(html,/id="mode-technical"/);
    assert.match(html,/id="business-view"/);
    assert.match(html,/id="technical-view" hidden/);
    assert.match(html,/id="os-snapshot-file"/);
    assert.match(html,/id="biz-product-tree"/);
    assert.match(html,/id="biz-processes"/);
    assert.match(html,/business-app\.js/);
    const businessJs=await fetch(origin+'/business-app.js');
    assert.equal(businessJs.status,200);
    assert.match(await businessJs.text(),/manufacturing processes required for this product|Manufacturing processes required for this product/);
    const preflight=await (await fetch(origin+'/api/business')).json();
    assert.equal(preflight.business,null);
    assert.equal(preflight.osSnapshot,null);
    const template=await (await fetch(origin+'/api/os/template')).json();
    assert.equal(template.schemaVersion,'pi-os-snapshot/v1');
    assert.equal(template.products.length,0);
    assert.equal((await fetch(origin+'/api/os/handoff')).status,404);
    const os={
      schemaVersion:'pi-os-snapshot/v1',
      company:{id:'internal-local-only',name:'Synthetic OS Company',website:'https://example.org/'},
      categories:['Widgets'],products:[{name:'Widget A'}],
      parts:[],manufacturingProcesses:[]
    };
    const blockedOs=await fetch(origin+'/api/os/snapshot',{
      method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(os)});
    assert.equal(blockedOs.status,403);
    const token=html.match(/<meta name="lab-token" content="([0-9a-f]{64})">/)?.[1];
    assert.ok(token,'random local session token exists');
    const imported=await fetch(origin+'/api/os/snapshot',{
      method:'POST',headers:{'x-lab-token':token,'Content-Type':'application/json'},
      body:JSON.stringify(os)});
    assert.equal(imported.status,200);
    const body=await imported.json();
    assert.equal(body.osSnapshot.company.name,'Synthetic OS Company');
    assert.equal(body.business,null,'OS snapshot import does not create fake research');
    const importedStatus=await (await fetch(origin+'/api/business')).json();
    assert.equal(importedStatus.osSnapshot.company.name,'Synthetic OS Company');
    const clear=await fetch(origin+'/api/os/clear',{
      method:'POST',headers:{'x-lab-token':token,'Content-Type':'application/json'},
      body:'{}'});
    assert.equal(clear.status,200);
    const noOs=await (await fetch(origin+'/api/business')).json();
    assert.equal(noOs.osSnapshot,null);

    const parents=await (await fetch(origin+'/api/stage2/parents')).json();
    assert.equal(parents.parents.length,3);
    const proposals=await (await fetch(origin+'/api/stage2/proposals')).json();
    assert.deepEqual(proposals.proposals,[]);
    assert.equal(proposals.localEditionVersion,0);
    const blocked=await fetch(origin+'/api/stage2/publish',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
    assert.equal(blocked.status,403,'Mutating review endpoints require a session token');
    assert.equal((await fetch(origin+'/api/stage2/taxonomy/export')).status,404);
  }finally{
    if(child&&child.exitCode===null){child.kill('SIGTERM');await Promise.race([once(child,'exit'),wait(4000)]);}
    await rm(folder,{recursive:true,force:true});
  }
});
