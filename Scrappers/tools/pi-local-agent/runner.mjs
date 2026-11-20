/** Fixed operations. The remote job does not supply paths, flags or commands.
 * The workspace is exactly one Scrappers directory; local-data is gitignored.
 * This is application-layer scope, NOT an OS security sandbox.
 */
import {spawn} from 'node:child_process';
import {lstat,mkdir,readFile,readdir,realpath} from 'node:fs/promises';
import {join,relative,resolve,isAbsolute,sep} from 'node:path';
import {sanitizeOutput} from './policy.mjs';
const DATA='local-data/pi-local-agent';
const U30_BATCH=Object.freeze({u30_a:'A',u30_b:'B',u30_c:'C',u30_d:'D',u30_e:'E'});
const ALLOWED_INPUTS=Object.freeze({
  taxonomy_1up:'inputs/1up.json',
  taxonomy_cross:'inputs/cross-industry.json'
});
export function inside(root,candidate){
  const r=relative(root,candidate);
  return r===''||(!r.startsWith('..'+sep)&&r!=='..'&&!isAbsolute(r));
}
export async function workspaceRoot(configured){
  if(typeof configured!=='string'||!isAbsolute(configured))throw Error('Set an ABSOLUTE PI_AGENT_WORKSPACE path to the Scrappers directory');
  const root=await realpath(configured);
  if(!(await lstat(root)).isDirectory())throw Error('Workspace is not a directory');
  if(!(await lstat(join(root,'tools','research-planner.mjs'))).isFile())
    throw Error('Workspace must be the existing Scrappers directory');
  return root;
}
export async function confinedExisting(root,localRelative){
  if(typeof localRelative!=='string'||isAbsolute(localRelative)||localRelative.split(/[\\/]/).includes('..'))
    throw Error('Disallowed file path');
  const expected=resolve(root,localRelative),actual=await realpath(expected);
  if(!inside(root,actual)||!inside(root,expected))throw Error('File resolves outside the workspace');
  if(!(await lstat(actual)).isFile())throw Error('Expected a regular file');
  return actual;
}
export async function confinedOutputDir(root){
  const expected=resolve(root,DATA,'outputs');
  if(!inside(root,expected))throw Error('Output directory escapes workspace');
  await mkdir(expected,{recursive:true});
  const actual=await realpath(expected);
  if(!inside(root,actual))throw Error('Output directory redirects outside workspace');
  if(!(await lstat(actual)).isDirectory())throw Error('Output directory invalid');
  return actual;
}
function childEnv(){
  // Never forward the GitHub token, AI provider keys, NODE_OPTIONS or user env.
  const out={};
  for(const key of ['PATH','Path','SystemRoot','WINDIR','TEMP','TMP','USERPROFILE','APPDATA','LOCALAPPDATA','HOME'])
    if(process.env[key])out[key]=process.env[key];
  return out;
}
export function runProcess(executable,args,{cwd,timeoutMs=90000,secret='',spawnImpl=spawn}={}){
  return new Promise((ok,fail)=>{
    const child=spawnImpl(executable,args,{cwd,env:childEnv(),shell:false,windowsHide:true,stdio:['ignore','pipe','pipe']});
    let output='',closed=false,timedOut=false;
    const collect=chunk=>{
      output+=String(chunk);
      if(output.length>75000){timedOut=true;child.kill();}
    };
    child.stdout?.on('data',collect);child.stderr?.on('data',collect);
    const timeout=setTimeout(()=>{timedOut=true;child.kill();},timeoutMs);
    child.once('error',err=>{if(closed)return;closed=true;clearTimeout(timeout);fail(err);});
    child.once('close',(code,signal)=>{
      if(closed)return;closed=true;clearTimeout(timeout);
      ok({exitCode:code??-1,signal:signal||null,timeout:timedOut,
        output:sanitizeOutput(output,{secret,maxChars:6000})});
    });
  });
}
export async function executeAction(action,{workspace,jobId,secret='',run=runProcess}={}){
  const root=await workspaceRoot(workspace);
  if(action==='health')return {status:'completed',action,nodeVersion:process.version,
    workspace:'Scrappers (private local path omitted)',network:'outbound-only'};
  if(action==='ollama_health'||action==='ollama_1up'){
    // Remote Issue cannot choose target, model, prompts, scripts or output path.
    // Never forward the GitHub token into the local model process.
    if(typeof jobId!=='string'||!/^[A-Za-z0-9_-]{8,64}$/.test(jobId))
      throw Error('Invalid Ollama jobId');
    const script=await confinedExisting(root,'tools/pi-local-agent/ollama-job.mjs');
    await confinedExisting(root,'tools/ollama-mapping.mjs');
    await confinedExisting(root,'tools/research-taxonomy-store.mjs');
    await confinedExisting(root,'dist/engine.js');
    const out=await confinedOutputDir(root);
    const name=jobId+'-'+action+'.json',file=join(out,name);
    try{await lstat(file);throw Error('Ollama job result already exists');}
    catch(e){if(e.code!=='ENOENT')throw e;}
    const p=await run(process.execPath,[script,action,'--out',join(DATA,'outputs',name)],
      {cwd:root,secret,timeoutMs:action==='ollama_health'?150000:720000});
    if(p.exitCode!==0||p.timeout)return {status:'failed',action,
      exitCode:p.exitCode,timeout:p.timeout,
      diagnostic:'Local fixed job did not finish; inspect Windows agent console. No remote shell commands executed.'};
    const resultFile=await confinedExisting(root,join(DATA,'outputs',name));
    const data=await readFile(resultFile,'utf8');
    if(data.length>55000)throw Error('Ollama job summary too large');
    const parsed=JSON.parse(data);
    if(parsed.schemaVersion!=='pi-ollama-agent-result/v1'||parsed.action!==action||
      !['completed','failed','unavailable'].includes(parsed.status))
      throw Error('Unexpected local Ollama job response contract');
    if(action==='ollama_health')return {status:parsed.status,action,
      model:String(parsed.model||'').slice(0,70),check:String(parsed.check||'').slice(0,80),
      latencyMs:Number(parsed.latencyMs||0),localhostOnly:true,
      reason:String(parsed.reason||'').slice(0,140),
      conclusion:parsed.status==='completed'?'Local model generated expected JSON':'Model inference not verified'};
    // Only a bounded evidence summary is sent to the PRIVATE issue.
    const a=parsed.acquisition||{},m=parsed.model||{},t=parsed.taxonomy||{},o=parsed.output||{};
    const products=(Array.isArray(o.products)?o.products:[]).slice(0,12).map(p=>({
      name:String(p.name||'').slice(0,130),
      sourceUrl:String(p.sourceUrl||'').slice(0,240),
      extractionMethod:String(p.method||'').slice(0,70),
      evidenceQuote:String(p.quote||'').slice(0,180),
      reviewStatus:'unverified',
      components:(p.components||[]).slice(0,2).map(x=>({
        name:String(x.name||'').slice(0,100),quote:String(x.quote||'').slice(0,150)})),
      materials:(p.materials||[]).slice(0,2).map(x=>({
        name:String(x.name||'').slice(0,100),quote:String(x.quote||'').slice(0,150)})),
      taxonomyStatus:String(p.taxonomy?.status||'not_mapped').slice(0,60),
      taxonomySuggestions:(p.taxonomy?.suggestions||[]).slice(0,2).map(x=>({
        code:String(x.code||'').slice(0,80),label:String(x.label||'').slice(0,100)}))
    }));
    return {status:parsed.status,action,site:'1up-usa.com',durationMs:Number(parsed.durationMs||0),
      acquisition:{status:String(a.status||'').slice(0,50),
        pagesVisited:Number(a.pagesVisited||0),pagesUsable:Number(a.pagesUsable||0),
        pages:(a.pages||[]).slice(0,7).map(x=>({
          url:String(x.url||'').slice(0,230),status:String(x.status||'').slice(0,35),
          textChars:Number(x.textChars||0),warning:String(x.warning||'').slice(0,105)}))},
      model:{name:String(m.name||'').slice(0,70),status:String(m.status||'').slice(0,55),
        pagesAnalyzed:Number(m.pagesAnalyzed||0),
        acceptedCandidates:Number(m.acceptedCandidates||0),
        reason:String(m.reason||'').slice(0,130)},
      taxonomy:{installed:Boolean(t.installed),nodes:Number(t.nodes||0),
        masterChanged:false},
      results:{productCount:Number(o.productCount||0),productsWithMaterials:Number(o.productsWithMaterials||0),
        productsWithComponents:Number(o.productsWithComponents||0),
        taxonomyProposals:Number(o.taxonomyProposals||0),products},
      localDetailsPath:'local-data/pi-local-agent/outputs/'+name.replace(/\.json$/,'-evidence.json'),
      quality:'unverified_candidates_not_accuracy',
      caveat:'Only public website text and review candidates. No confirmed BOM, processes, OS connection, or taxonomy mutation.'};
  }
  if(Object.hasOwn(U30_BATCH,action)){
    // Each private job selects exactly one immutable six-site cohort batch.
    // Remote Issue fields cannot choose URLs, scripts, page budgets or paths.
    const batch=U30_BATCH[action];
    if(typeof jobId!=='string'||!/^[A-Za-z0-9_-]{8,64}$/.test(jobId))throw Error('Invalid U30 output jobId');
    const script=await confinedExisting(root,'tools/universal-benchmark.mjs');
    await confinedExisting(root,'tools/universal-validation.mjs');
    for(const name of [
      'benchmark/universal-v1/cohort.csv','benchmark/universal-v1/hosts.txt',
      'benchmark/universal-v1/cohort-lock.json','tools/product-intelligence.mjs',
      'tools/research-planner.mjs','benchmark/insidejob-os-ten-sites.csv',
      'benchmark/sites.example.csv'
    ])await confinedExisting(root,name);
    const out=await confinedOutputDir(root),folder=jobId+'-u30'+batch;
    const target=join(out,folder);
    try{await lstat(target);throw Error('U30 results already exist');}
    catch(e){if(e.code!=='ENOENT')throw e;}
    const p=await run(process.execPath,[script,'--batch',batch,'--out',join(DATA,'outputs',folder)],
      {cwd:root,secret,timeoutMs:600000});
    if(p.exitCode!==0||p.timeout)
      return {status:'failed',action,batch,exitCode:p.exitCode,timeout:p.timeout,diagnostic:p.output};
    const summaryPath=await confinedExisting(root,join(DATA,'outputs',folder,'summary.json'));
    const resultsPath=await confinedExisting(root,join(DATA,'outputs',folder,'results.json'));
    const reviewPath=await confinedExisting(root,join(DATA,'outputs',folder,'manual-review.csv'));
    await confinedExisting(root,join(DATA,'outputs',folder,'manual-role-review.csv'));
    const report=JSON.parse(await readFile(summaryPath,'utf8'));
    const parsed=JSON.parse(await readFile(resultsPath,'utf8'));
    if(!reviewPath||report.schemaVersion!=='pi-universal-holdout/v1'||report.batch!==batch||
      report.siteCount!==6||parsed.schemaVersion!=='pi-universal-holdout/v1'||
      parsed.batch!==batch||!Array.isArray(parsed.rows)||parsed.rows.length!==6)
      throw Error('Unexpected frozen U30 batch report');
    const fields=['pagesUsable','products','categories','productsWithSpecifications',
      'productsWithComponents','productsWithMaterials','specifications','components',
      'materials','unlinkedProducts'];
    const pack=x=>Object.fromEntries(fields.map(k=>[k,Number(x?.[k]||0)]));
    return {status:'completed',action,batch,siteCount:6,
      frozenExtractorGitBlobSha:report.frozenLockPins?.['product-intelligence.mjs']||null,
      qualityStatus:'unreviewed_no_product_accuracy',
      baseline3:pack(report.baseline3),depth12:pack(report.depth12),
      sourceSignals:report.sourceSignals,manualReviewRows:report.reviewTemplateRows,
      rows:parsed.rows.map(r=>({siteId:r.siteId,company:r.company,industry:r.industry,
        roleStratumNotGroundTruth:r.roleStratum,status:r.runStatus,
        pagesAttempted:r.pagesAttempted,stoppingReason:r.stoppingReason,
        baseline3:pack(r.baseline3?.coverage),depth12:pack(r.depth12?.coverage),
        traceability:{checked:r.traceability?.claimCount,matched:r.traceability?.matched,
          missingSource:r.traceability?.missingSource,missingQuote:r.traceability?.missingQuote},
        duplicateCandidates:r.duplicateSignals?.samePageNormalizedNameGroups,
        productSamples:(r.depth12?.products||[]).slice(0,3).map(p=>({
          name:String(p.name||'').slice(0,150),sourceUrl:String(p.sourceUrl||'').slice(0,240),
          specifications:(p.specifications||[]).slice(0,1).map(x=>({
            attribute:x.attribute,value:String(x.value||'').slice(0,90),
            quote:String(x.evidence?.quote||'').slice(0,180)}))})),
        categorySamples:(r.depth12?.categories||[]).slice(0,2).map(x=>({
          name:String(x.name||'').slice(0,130),sourceUrl:String(x.sourceUrl||'').slice(0,240)})),
        failedPages:(r.pageStatuses||[]).filter(x=>!['completed','partial'].includes(x.status))
          .slice(0,2).map(x=>({url:String(x.url||'').slice(0,220),
            status:x.status,reason:String(x.reason||'').slice(0,145)})),
        errors:(r.errors||[]).slice(0,2)})),
      outputLocal:join(DATA,'outputs',folder),
      caveat:'Frozen independent cross-industry V1 evaluation, not accuracy. Candidate roles are sampling hints. Manual labels are blank; all reported source records are unverified.'};
  }
  if(action==='products_7'){
    // One explicitly approved fixed seven-site, bounded research job. The
    // queue cannot specify URLs, output paths, binaries, scripts or AI options.
    if(typeof jobId!=='string'||!/^[A-Za-z0-9_-]{8,64}$/.test(jobId))throw Error('Invalid output jobId');
    const script=await confinedExisting(root,'tools/product-intelligence-benchmark.mjs');
    await confinedExisting(root,'tools/product-intelligence.mjs');
    await confinedExisting(root,'benchmark/insidejob-os-ten-sites.csv');
    await confinedExisting(root,'benchmark/insidejob-os-ten-approved-hosts.txt');
    const out=await confinedOutputDir(root),folder=jobId+'-products7';
    const destination=join(out,folder);
    try{await lstat(destination);throw Error('Product result directory already exists');}
    catch(e){if(e.code!=='ENOENT')throw e;}
    const task=await run(process.execPath,[script,'--out',join(DATA,'outputs',folder)],
      {cwd:root,secret,timeoutMs:780000});
    if(task.exitCode!==0||task.timeout)
      return {status:'failed',action,exitCode:task.exitCode,timeout:task.timeout,diagnostic:task.output};
    const summaryFile=await confinedExisting(root,join(DATA,'outputs',folder,'summary.json'));
    const rowsFile=await confinedExisting(root,join(DATA,'outputs',folder,'results.json'));
    const summary=JSON.parse(await readFile(summaryFile,'utf8'));
    const parsed=JSON.parse(await readFile(rowsFile,'utf8'));
    if(summary.schemaVersion!=='pi-product-intelligence/v1'||summary.siteCount!==7||
      parsed.schemaVersion!=='pi-product-intelligence/v1'||!Array.isArray(parsed.rows)||parsed.rows.length!==7)
      throw Error('Unexpected seven-site product intelligence report');
    const fields=['pagesSubmitted','pagesUnique','pagesUsable','productPages','categoryPages',
      'products','categories','productsWithSpecifications','productsWithComponents',
      'productsWithMaterials','specifications','components','materials','unlinkedProducts'];
    const pack=x=>Object.fromEntries(fields.map(k=>[k,Number(x?.[k]||0)]));
    return {status:'completed',action,siteCount:7,baseline3:pack(summary.baseline3),
      depth12:pack(summary.depth12),
      rows:parsed.rows.map(r=>({siteId:r.siteId,company:r.company,status:r.runStatus,
        attemptedPages:r.pagesAttempted,stoppingReason:r.stoppingReason,
        baseline3:pack(r.baseline3?.coverage),depth12:pack(r.depth12?.coverage),
        companyRoleCandidate:r.depth12?.company?.roleCandidate?.primaryRole||'unknown',
        categories:(r.depth12?.categories||[]).slice(0,5).map(c=>({name:String(c.name||'').slice(0,125),
          sourceUrl:String(c.sourceUrl||'').slice(0,240)})),
        products:(r.depth12?.products||[]).slice(0,7).map(p=>({name:String(p.name||'').slice(0,150),
          sourceUrl:String(p.sourceUrl||'').slice(0,240),method:p.extractionMethod,
          specifications:(p.specifications||[]).slice(0,2).map(x=>({attribute:x.attribute,
            value:String(x.value||'').slice(0,130),quote:String(x.evidence?.quote||'').slice(0,210)})),
          materials:(p.materials||[]).slice(0,2).map(x=>({material:x.material,
            quote:String(x.evidence?.quote||'').slice(0,210)})),
          components:(p.components||[]).slice(0,2).map(x=>({component:x.component,
            quote:String(x.evidence?.quote||'').slice(0,210)}))
        })),
        failures:(r.pageStatuses||[]).filter(p=>!['completed','partial'].includes(p.status)).slice(0,3)
          .map(p=>({url:String(p.url||'').slice(0,230),status:p.status,reason:String(p.reason||'').slice(0,130)})),
        errors:(r.errors||[]).slice(0,2)})),
      outputLocal:join(DATA,'outputs',folder),
      warning:'Provisional evidence-backed extraction only, not validated product accuracy. Manufactured-versus-distributed and unknown materials/components require explicit verification.'};
  }
  if(action==='depth_7'){
    // Explicitly opt-in seven-site 3-vs-12 comparative research. No remotely
    // selectable URLs, page counts, scripts, shell commands or parameters.
    if(typeof jobId!=='string'||!/^[A-Za-z0-9_-]{8,64}$/.test(jobId))throw Error('Invalid output jobId');
    const script=await confinedExisting(root,'tools/depth-benchmark.mjs');
    await confinedExisting(root,'tools/depth-coverage.mjs');
    await confinedExisting(root,'benchmark/insidejob-os-ten-sites.csv');
    await confinedExisting(root,'benchmark/insidejob-os-ten-approved-hosts.txt');
    const out=await confinedOutputDir(root);
    const folder=jobId+'-depth7';
    const target=join(out,folder);
    try{await lstat(target);throw Error('Depth benchmark result directory already exists');}
    catch(e){if(e.code!=='ENOENT')throw e;}
    const args=[script,'--out',join(DATA,'outputs',folder)];
    const task=await run(process.execPath,args,{cwd:root,secret,timeoutMs:700000});
    if(task.exitCode!==0||task.timeout)
      return {status:'failed',action,exitCode:task.exitCode,timeout:task.timeout,diagnostic:task.output};
    const summaryFile=await confinedExisting(root,join(DATA,'outputs',folder,'summary.json'));
    const rowsFile=await confinedExisting(root,join(DATA,'outputs',folder,'results.json'));
    const summary=JSON.parse(await readFile(summaryFile,'utf8'));
    const parsed=JSON.parse(await readFile(rowsFile,'utf8'));
    if(summary.schemaVersion!=='pi-depth-benchmark/v1'||summary.siteCount!==7||
      parsed.schemaVersion!=='pi-depth-benchmark/v1'||!Array.isArray(parsed.rows)||parsed.rows.length!==7)
      throw Error('Unexpected seven-site depth report');
    const fields=['attemptedPages','usablePages','uniqueSuccessfulSourceUrls','textChars',
      'evidenceRecords','categoryPageLeads','productDetailPageLeads','capabilityPages',
      'categoryLinkLeads','productLinkLeads','jsonLdProductRecords','pdfLinksDiscovered',
      'pdfDocumentsRead','pdfPagesRead','technicalEvidencePages','technicalLineSignals',
      'browserAttempts','browserSuccesses'];
    const pack=x=>Object.fromEntries(fields.map(k=>[k,Number(x?.[k]||0)]));
    return {status:'completed',action,siteCount:7,
      baseline3:pack(summary.baseline3),depth12:pack(summary.depth12),gain:pack(summary.gain),
      rows:parsed.rows.map(r=>({siteId:r.siteId,company:r.company,status:r.status,
        durationMs:r.durationMs,stoppingReason:r.stoppingReason,remainingLeads:r.remainingLeads,
        baseline3:pack(r.baseline3),depth12:pack(r.depth12),gain:pack(r.gain),
        sampleProducts:(r.depth12?.productSamples||[]).slice(0,5).map(x=>x.name),
        categoryExamples:(r.depth12?.categorySamples||[]).slice(0,6).map(x=>({
          label:String(x.label||'').slice(0,110),url:String(x.url||'').slice(0,230)})),
        technicalExamples:(r.depth12?.technicalExamples||[]).slice(0,2).map(x=>({
          sourceUrl:String(x.sourceUrl||'').slice(0,230),quote:String(x.quote||'').slice(0,210)})),
        visitedPages:(r.depth12?.sourcePages||[]).slice(0,12).map(x=>({
          url:String(x.url||'').slice(0,230),kind:x.kind,status:x.status,
          heading:String(x.heading||'').slice(0,130)})),
        errors:(r.errors||[]).slice(0,2)})),
      outputLocal:join(DATA,'outputs',folder),
      caveat:'Controlled 3-vs-12 page acquisition test. Structured product records and technical lines are unverified leads, not catalog completeness or engineering facts. Browser fallback only where available; no policy bypass.'};
  }
  if(action==='benchmark_10'){
    // Opt-in live retrieval only. The private job cannot choose URLs, paths, commands or flags.
    // Reuse the existing policy-aware scraper benchmark and a fixed, explicitly reviewed list.
    if(typeof jobId!=='string'||!/^[A-Za-z0-9_-]{8,64}$/.test(jobId))throw Error('Invalid output jobId');
    const script=await confinedExisting(root,'tools/benchmark.mjs');
    await confinedExisting(root,'benchmark/insidejob-os-ten-sites.csv');
    await confinedExisting(root,'benchmark/insidejob-os-ten-approved-hosts.txt');
    const outputDir=await confinedOutputDir(root);
    const name=jobId+'-os10';
    const batchDir=join(outputDir,name);
    try{await lstat(batchDir);throw Error('Job result directory already exists');}
    catch(e){if(e.code!=='ENOENT')throw e;}
    const args=[script,
      '--sites','benchmark/insidejob-os-ten-sites.csv',
      '--allow-hosts','benchmark/insidejob-os-ten-approved-hosts.txt',
      '--pattern-mode','none','--strategy','auto','--browser','none',
      '--html-pages','3','--max-sites','10','--delay-ms','1500',
      '--out',join(DATA,'outputs',name)];
    const execution=await run(process.execPath,args,{cwd:root,secret,timeoutMs:580000});
    if(execution.exitCode!==0||execution.timeout){
      return {status:'failed',action,exitCode:execution.exitCode,timeout:execution.timeout,
        diagnostic:execution.output};
    }
    const sumPath=await confinedExisting(root,join(DATA,'outputs',name,'summary.json'));
    const rowsPath=await confinedExisting(root,join(DATA,'outputs',name,'results.json'));
    const summary=JSON.parse(await readFile(sumPath,'utf8'));
    const parsed=JSON.parse(await readFile(rowsPath,'utf8'));
    if(summary.totalSites!==10||!Array.isArray(parsed.results)||parsed.results.length!==10)
      throw Error('Unexpected ten-company benchmark result count');
    return {status:'completed',action,siteCount:summary.totalSites,
      statusCounts:summary.statusCounts,quality:summary.quality,
      rows:parsed.results.map(x=>({siteId:x.siteId,company:x.companyName,status:x.status,
        usable:x.usable,evidenceCount:x.evidenceCount,textChars:x.textChars,
        firstStrategy:x.firstStrategy,finalStrategy:x.finalStrategy,
        reason:String(x.reason||'').slice(0,220)})),
      outputLocal:join(DATA,'outputs',name),
      caveat:'Real retrieval benchmark only: no JS1-JS10, taxonomy accuracy, production integration, or process validation. Browser escalation and pattern scoring disabled for this first pass.'};
  }
  if(action==='run_tests'){
    const tsc=await confinedExisting(root,'node_modules/typescript/bin/tsc');
    const testDir=await realpath(join(root,'tests'));
    if(!inside(root,testDir))throw Error('Tests redirect outside workspace');
    const files=(await readdir(testDir)).filter(x=>/^[a-z0-9-]+\.test\.mjs$/i.test(x)).sort();
    if(!files.length)throw Error('No Scrappers tests found');
    const build=await run(process.execPath,[tsc,'-p','tsconfig.json'],{cwd:root,secret,timeoutMs:60000});
    if(build.exitCode!==0||build.timeout)return {status:'failed',action,phase:'build',...build};
    const tests=await run(process.execPath,['--test',...files.map(x=>join(testDir,x))],
      {cwd:root,secret,timeoutMs:100000});
    const counts={};
    for(const key of ['tests','pass','fail']){
      const match=tests.output.match(new RegExp('(?:ℹ|#)\\s*'+key+'\\s+(\\d+)'));
      counts[key]=match?Number(match[1]):null;
    }
    return {status:tests.exitCode===0&&!tests.timeout?'completed':'failed',
      action,phase:'tests',counts,...tests};
  }
  if(!Object.hasOwn(ALLOWED_INPUTS,action))throw Error('Unsupported action');
  const runner=await confinedExisting(root,'tools/taxonomy-benchmark.mjs');
  const taxonomy=await confinedExisting(root,join(DATA,'inputs','taxonomy.html'));
  const evidence=await confinedExisting(root,join(DATA,ALLOWED_INPUTS[action]));
  const outputDir=await confinedOutputDir(root);
  // jobId validated by protocol; keep the file name independently bounded.
  if(typeof jobId!=='string'||!/^[A-Za-z0-9_-]{8,64}$/.test(jobId))throw Error('Invalid output jobId');
  const outputFile=join(outputDir,jobId+'.json');
  // Do not overwrite an existing symlink or a previous artifact.
  try{await lstat(outputFile);throw Error('Job result file already exists');}
  catch(e){if(e.code!=='ENOENT')throw e;}
  const p=await run(process.execPath,[runner,'--taxonomy',taxonomy,'--evidence',evidence,'--out',outputFile],
    {cwd:root,secret,timeoutMs:90000});
  if(p.exitCode!==0||p.timeout)return {status:'failed',action,exitCode:p.exitCode,timeout:p.timeout,
    output:p.output};
  const result=JSON.parse(await readFile(outputFile,'utf8'));
  if(result.status!=='unlabeled_retrieval_probe_not_accuracy')throw Error('Unexpected taxonomy probe result');
  return {status:'completed',action,exitCode:0,taxonomyNodes:result.taxonomyNodes,
    searchableNodes:result.searchableNodes,products:result.products,
    candidateProducts:result.candidateProducts,abstentions:result.abstentions,
    rows:result.results.slice(0,35).map(x=>({product:x.product,topCategory:x.topCategory,
      topCode:x.topCode,status:x.status})),
    outputLocal:'local-data/pi-local-agent/outputs/'+jobId+'.json',
    warning:'Review-only retrieval: NOT validated classification accuracy. Original taxonomy remains on PC.'};
}
