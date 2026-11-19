import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,symlink,realpath} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {parseQueueRepo,parseJob,JOB_SCHEMA,QUEUE_LABEL,sanitizeOutput} from '../tools/pi-local-agent/policy.mjs';
import {workspaceRoot,inside,confinedExisting,confinedOutputDir,executeAction} from '../tools/pi-local-agent/runner.mjs';
const owner='KaranBarua01';
function job(action='health',extra={},offset=0){
  const now=Date.now()+offset;
  return {number:33,labels:[{name:QUEUE_LABEL}],user:{login:owner},
    body:JSON.stringify({schemaVersion:JOB_SCHEMA,jobId:'testjob_01234',action,
      issuedAt:new Date(now-1000).toISOString(),expiresAt:new Date(now+5*60000).toISOString(),...extra})};
}
async function fixture(fn){
  const root=await mkdtemp(join(tmpdir(),'pi-agent-'));
  await mkdir(join(root,'tools'),{recursive:true});
  await writeFile(join(root,'tools','research-planner.mjs'),'// synthetic workspace');
  try{return await fn(root);}
  finally{await rm(root,{recursive:true,force:true});}
}
test('private queue configuration rejects public Product-Insights and malicious paths',()=>{
  assert.equal(parseQueueRepo('KaranBarua01/PI-Agent-Queue'),'KaranBarua01/PI-Agent-Queue');
  for(const name of ['KaranBarua01/Product-Insights','karanbarua01/product-insights','https://github.com/x/y',
    '../private','foo/bar/other','foo/b..ar'])assert.throws(()=>parseQueueRepo(name));
});
test('job only accepts exact short-lived JSON allowlist and owner',()=>{
  assert.equal(parseJob(job(),{owner}).action,'health');
  for(const name of ['health','run_tests','taxonomy_1up','taxonomy_cross'])
    assert.equal(parseJob(job(name),{owner}).action,name);
  assert.throws(()=>parseJob({...job(),user:{login:'other'}},{owner}),/author/);
  assert.throws(()=>parseJob({...job(),labels:[]},{owner}),/queue/);
  assert.throws(()=>parseJob(job('powershell'),{owner}),/Unknown/);
  assert.throws(()=>parseJob(job('health',{command:'Remove-Item -Recurse C:\\'}),{owner}),/fields/);
  assert.throws(()=>parseJob(job('health',{path:'../../outside'}),{owner}),/fields/);
  assert.throws(()=>parseJob(job('health',{},-20*60000),{owner}),/expired|window/);
  assert.throws(()=>parseJob(job('health',{},20*60000),{owner}),/future-dated/);
  assert.throws(()=>parseJob({...job(),body:'not json'},{owner}),/JSON|invalid or too large/);
});
test('secret scrubbing hides GitHub token variants and truncates output',()=>{
  assert.doesNotMatch(sanitizeOutput('Bearer secretVALUE0123 github_pat_0123456789abcdef',{}),/secretVALUE|github_pat_/);
  assert.equal(sanitizeOutput('abcSECRETxyz',{secret:'SECRET'}),'abc[REDACTED]xyz');
  assert.match(sanitizeOutput('A'.repeat(200),{maxChars:20}),/truncated/);
});
test('workspace is explicit; realpath confinement blocks symlink escape',async()=>{
  await fixture(async root=>{
    const resolved=await workspaceRoot(root);
    // Windows may create an 8.3 temp path (KARANB~1), while realpath expands it.
    // Test the normalized workspace, not the display spelling of the same path.
    assert.equal(resolved,await realpath(root));
    assert.equal(inside(resolved,join(resolved,'tools','research-planner.mjs')),true);
    assert.equal(inside(resolved,join(resolved,'..','elsewhere')),false);
    await assert.rejects(()=>workspaceRoot('relative'),/ABSOLUTE/);
    const file=await confinedExisting(resolved,'tools/research-planner.mjs');
    assert.equal(file,await realpath(join(resolved,'tools','research-planner.mjs')));
    await assert.rejects(()=>confinedExisting(resolved,'../some-other-file'),/Disallowed/);
    const out=await confinedOutputDir(resolved);
    assert.ok(inside(resolved,out));
    const outside=await mkdtemp(join(tmpdir(),'pi-agent-outside-'));
    try{
      await writeFile(join(outside,'private.txt'),'never read');
      try{
        await symlink(join(outside,'private.txt'),join(resolved,'tools','linked-secret.txt'),'file');
        await assert.rejects(()=>confinedExisting(resolved,'tools/linked-secret.txt'),/outside/);
      }catch(e){if(!['EPERM','EACCES','ENOTSUP'].includes(e.code))throw e;}
    }finally{await rm(outside,{recursive:true,force:true});}
  });
});
test('health returns no private local path, needs no GitHub or AI calls',async()=>{
  await fixture(async root=>{
    const h=await executeAction('health',{workspace:root});
    assert.equal(h.status,'completed');
    assert.equal(h.action,'health');
    assert.ok(!JSON.stringify(h).includes(root));
  });
});
test('taxonomy probe calls ONLY fixed local paths and returns bounded review candidates',async()=>{
  await fixture(async root=>{
    const resolved=await workspaceRoot(root);
    await mkdir(join(root,'local-data','pi-local-agent','inputs'),{recursive:true});
    await writeFile(join(root,'tools','taxonomy-benchmark.mjs'),'// synthetic runner');
    await writeFile(join(root,'local-data','pi-local-agent','inputs','taxonomy.html'),'private taxonomy');
    await writeFile(join(root,'local-data','pi-local-agent','inputs','1up.json'),'{"rows":[]}');
    let launched=0;
    const result=await executeAction('taxonomy_1up',{workspace:root,jobId:'safe_job_1234',run:async(exe,args,opts)=>{
      launched++;
      assert.equal(exe,process.execPath);assert.equal(opts.cwd,resolved);
      assert.equal(args[0],await realpath(join(resolved,'tools','taxonomy-benchmark.mjs')));
      assert.ok(!args.includes('--command')&&!args.includes('-Command'));
      const output=args[args.indexOf('--out')+1];
      assert.ok(inside(resolved,output));
      await writeFile(output,JSON.stringify({status:'unlabeled_retrieval_probe_not_accuracy',
        taxonomyNodes:1213,searchableNodes:1175,products:1,candidateProducts:1,abstentions:0,
        results:[{product:'Test Rack',topCategory:'Cargo racks & boxes',topCode:'demo-only',
          status:'candidate_requires_review'}]}));
      return {exitCode:0,timeout:false,output:'done'};
    }});
    assert.equal(launched,1);assert.equal(result.status,'completed');
    assert.equal(result.candidateProducts,1);
    assert.match(result.warning,/NOT validated/);
    await assert.rejects(()=>executeAction('taxonomy_1up',{workspace:root,jobId:'safe_job_1234',run:async()=>{}}),/already exists/);
    assert.ok((await readFile(join(root,'local-data','pi-local-agent','outputs','safe_job_1234.json'),'utf8')).includes('1213'));
  });
});
test('unknown operation never executes a process',async()=>{
  await fixture(async root=>{
    await assert.rejects(()=>executeAction('powershell',{workspace:root,run:()=>{throw Error('should never be called');}}),/Unsupported/);
  });
});
