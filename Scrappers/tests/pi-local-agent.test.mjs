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
  for(const name of ['health','run_tests','taxonomy_1up','taxonomy_cross','benchmark_10','depth_7','products_7'])
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

test('ten-company benchmark uses only fixed approved sites, exact hosts, and bounded results',async()=>{
  await fixture(async root=>{
    await mkdir(join(root,'benchmark'),{recursive:true});
    await writeFile(join(root,'tools','benchmark.mjs'),'// synthetic test runner');
    await writeFile(join(root,'benchmark','insidejob-os-ten-sites.csv'),'site_id,company_name,url\n');
    await writeFile(join(root,'benchmark','insidejob-os-ten-approved-hosts.txt'),'example.org\n');
    const expectedNames=Array.from({length:10},(_,i)=>'Company '+i);
    let launched=0;
    const result=await executeAction('benchmark_10',{workspace:root,jobId:'private_job_10',
      run:async(exe,args,opts)=>{
        launched++;
        assert.equal(exe,process.execPath);
        assert.equal(opts.cwd,await realpath(root));
        assert.equal(args[0],await realpath(join(root,'tools','benchmark.mjs')));
        for(const flag of ['--sites','--allow-hosts','--pattern-mode','--browser','--max-sites']){
          assert.ok(args.includes(flag));
        }
        assert.equal(args[args.indexOf('--pattern-mode')+1],'none');
        assert.equal(args[args.indexOf('--browser')+1],'none');
        assert.equal(args[args.indexOf('--max-sites')+1],'10');
        assert.ok(!args.includes('--extract-api')&&!args.includes('--pattern-api'));
        assert.ok(!args.includes('--token')&&!args.includes('--command'));
        const dir=join(root,args[args.indexOf('--out')+1]);
        await mkdir(dir,{recursive:true});
        await writeFile(join(dir,'summary.json'),JSON.stringify({totalSites:10,
          statusCounts:{completed:10},quality:{usable:10,usableEligible:10,eligible:10,usableRatePct:100}}));
        await writeFile(join(dir,'results.json'),JSON.stringify({results:expectedNames.map((company,i)=>({
          siteId:'OS10-'+i,companyName:company,status:'completed',usable:true,textChars:400,
          evidenceCount:2,firstStrategy:'S01',finalStrategy:'S01',reason:''}))}));
        return {exitCode:0,timeout:false,output:'ten simulated sites complete'};
      }});
    assert.equal(launched,1);
    assert.equal(result.status,'completed');
    assert.equal(result.rows.length,10);
    assert.equal(result.rows[0].company,'Company 0');
    assert.match(result.caveat,/Real retrieval benchmark only/);
    await assert.rejects(()=>executeAction('benchmark_10',{workspace:root,jobId:'private_job_10'}),
      /already exists/);
  });
});

test('fixed seven-site depth action only calls the predeclared script and returns bounded summaries',async()=>{
  await fixture(async root=>{
    await mkdir(join(root,'benchmark'),{recursive:true});
    await writeFile(join(root,'tools','depth-benchmark.mjs'),'// synthetic benchmark runner');
    await writeFile(join(root,'tools','depth-coverage.mjs'),'// synthetic coverage');
    await writeFile(join(root,'benchmark','insidejob-os-ten-sites.csv'),'site_id,company_name,url\n');
    await writeFile(join(root,'benchmark','insidejob-os-ten-approved-hosts.txt'),'example.org\n');
    let calls=0;
    const value=await executeAction('depth_7',{workspace:root,jobId:'depth_demo_1234',
      run:async(exe,args,options)=>{
        calls++;
        assert.equal(exe,process.execPath);
        assert.equal(options.cwd,await realpath(root));
        assert.equal(args.length,3);
        assert.equal(args[0],await realpath(join(root,'tools','depth-benchmark.mjs')));
        assert.equal(args[1],'--out');
        assert.match(args[2],/depth_demo_1234-depth7$/);
        assert.ok(!args.some(a=>a==='--command'||a==='--site'||a==='--url'||a==='--token'));
        assert.ok(options.timeoutMs<=700000);
        const dir=join(root,args[2]);
        await mkdir(dir,{recursive:true});
        const metric={attemptedPages:3,usablePages:3,uniqueSuccessfulSourceUrls:3,
          textChars:600,evidenceRecords:5,jsonLdProductRecords:2,technicalLineSignals:2};
        const deep={...metric,attemptedPages:12,usablePages:10,textChars:2400,
          evidenceRecords:21,jsonLdProductRecords:5,technicalLineSignals:9};
        const delta={attemptedPages:9,usablePages:7,textChars:1800,
          evidenceRecords:16,jsonLdProductRecords:3,technicalLineSignals:7};
        await writeFile(join(dir,'summary.json'),JSON.stringify({
          schemaVersion:'pi-depth-benchmark/v1',siteCount:7,baseline3:metric,depth12:deep,gain:delta}));
        await writeFile(join(dir,'results.json'),JSON.stringify({
          schemaVersion:'pi-depth-benchmark/v1',
          rows:Array.from({length:7},(_,i)=>({siteId:'OS10-00'+i,company:'Synthetic '+i,
            status:'sampled',durationMs:750,stoppingReason:'page_budget',remainingLeads:7,
            baseline3:metric,depth12:{...deep,
              productSamples:[{name:'Widget',sku:'W1'}],
              technicalExamples:[{sourceUrl:'https://example.org/product',quote:'Pressure: 20 bar'}],
              sourcePages:[{url:'https://example.org/products/1',kind:'product_detail_lead',status:'completed'}]},
            gain:delta,errors:[]}))}));
        return {exitCode:0,timeout:false,output:'ok'};
      }});
    assert.equal(calls,1);
    assert.equal(value.status,'completed');
    assert.equal(value.siteCount,7);
    assert.equal(value.baseline3.usablePages,3);
    assert.equal(value.depth12.usablePages,10);
    assert.equal(value.gain.usablePages,7);
    assert.equal(value.rows.length,7);
    assert.deepEqual(value.rows[0].sampleProducts,['Widget']);
    assert.equal(value.rows[0].visitedPages.length,1);
    assert.match(value.caveat,/unverified/);
    await assert.rejects(()=>executeAction('depth_7',{workspace:root,jobId:'depth_demo_1234'}),
      /already exists/);
  });
});

test('product-intelligence job is fixed to seven permitted sites and bounded local-only output',async()=>{
  await fixture(async root=>{
    await mkdir(join(root,'benchmark'),{recursive:true});
    await writeFile(join(root,'tools','product-intelligence.mjs'),'// synthetic extractor');
    await writeFile(join(root,'tools','product-intelligence-benchmark.mjs'),'// synthetic fixed runner');
    await writeFile(join(root,'benchmark','insidejob-os-ten-sites.csv'),'site_id,company_name,url\n');
    await writeFile(join(root,'benchmark','insidejob-os-ten-approved-hosts.txt'),'manufacturer.example.org\n');
    let calls=0;
    const result=await executeAction('products_7',{workspace:root,jobId:'product_job_1234',run:async(executable,args,options)=>{
      calls++;
      assert.equal(executable,process.execPath);
      assert.equal(options.cwd,await realpath(root));
      assert.deepEqual(args.slice(0,2),[await realpath(join(root,'tools','product-intelligence-benchmark.mjs')),'--out']);
      assert.equal(args.length,3);
      assert.match(args[2],/product_job_1234-products7$/);
      assert.ok(!args.some(a=>/^-{1,2}(?:command|site|url|token|model|api)$/.test(a)));
      assert.ok(options.timeoutMs<=780000);
      const directory=join(root,args[2]);
      await mkdir(directory,{recursive:true});
      const cov={pagesSubmitted:3,pagesUnique:3,pagesUsable:3,productPages:2,categoryPages:1,
        products:2,categories:1,productsWithSpecifications:1,productsWithComponents:1,
        productsWithMaterials:0,specifications:1,components:1,materials:0,unlinkedProducts:1};
      const company={roleCandidate:{primaryRole:'manufacturer'}};
      const sample={name:'Widget X',sourceUrl:'https://manufacturer.example.org/product/widget-x',
        extractionMethod:'product_page_heading',specifications:[{attribute:'weight',value:'10 kg',
          evidence:{quote:'Weight: 10 kg'}}],materials:[],components:[{component:'tray',
          evidence:{quote:'Includes one tray'}}]};
      const cat={name:'Industrial Tools',sourceUrl:'https://manufacturer.example.org/productcategory/tools/'};
      const row={siteId:'OS10-001',company:'Synthetic',runStatus:'sampled',pagesAttempted:3,
        stoppingReason:'frontier_exhausted',baseline3:{coverage:cov},
        depth12:{company,coverage:cov,categories:[cat],products:[sample]},
        pageStatuses:[],errors:[]};
      await writeFile(join(directory,'summary.json'),JSON.stringify({
        schemaVersion:'pi-product-intelligence/v1',siteCount:7,baseline3:cov,depth12:cov}));
      await writeFile(join(directory,'results.json'),JSON.stringify({
        schemaVersion:'pi-product-intelligence/v1',rows:Array.from({length:7},(_,i)=>({
          ...row,siteId:'OS10-00'+i}))}));
      return {exitCode:0,timeout:false,output:'pass'};
    }});
    assert.equal(calls,1);
    assert.equal(result.status,'completed');
    assert.equal(result.siteCount,7);
    assert.equal(result.rows.length,7);
    assert.equal(result.depth12.products,2);
    assert.equal(result.rows[0].products[0].specifications[0].value,'10 kg');
    assert.equal(result.rows[0].companyRoleCandidate,'manufacturer');
    assert.equal(result.rows[0].categories[0].name,'Industrial Tools');
    await assert.rejects(()=>executeAction('products_7',{workspace:root,jobId:'product_job_1234'}),/already exists/);
  });
});
