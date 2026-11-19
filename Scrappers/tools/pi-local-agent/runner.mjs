/** Fixed operations. The remote job does not supply paths, flags or commands.
 * The workspace is exactly one Scrappers directory; local-data is gitignored.
 * This is application-layer scope, NOT an OS security sandbox.
 */
import {spawn} from 'node:child_process';
import {lstat,mkdir,readFile,readdir,realpath} from 'node:fs/promises';
import {join,relative,resolve,isAbsolute,sep} from 'node:path';
import {sanitizeOutput} from './policy.mjs';
const DATA='local-data/pi-local-agent';
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
