// Public source repository: workstream/PR/contract guard. No external packages.
import {readFileSync,readdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=process.cwd();
export const validLanes=['ACQUISITION','MANUFACTURING','INTEGRATION','PLATFORM'];

export function validateRegistry(registry){
  const errors=[],lanes=registry?.lanes||[],caps=registry?.capabilities||[];
  if(registry?.schemaVersion!=='1.0'||registry?.releaseRepository!=='KaranBarua01/development-controller')
    errors.push('Registry version or sole release owner is incorrect');
  if(lanes.length!==4||new Set(lanes.map(x=>x.code)).size!==4||validLanes.some(x=>!lanes.some(y=>y.code===x)))
    errors.push('Exactly four distinct workstreams are required');
  const prefixes=new Set(),ids=new Set(),paths=new Set();
  for(const lane of lanes){
    if(!lane.primary||!lane.pathPrefixes?.length)errors.push('Missing primary owner/path in '+lane.code);
    for(const prefix of lane.pathPrefixes||[]){
      if(prefix.startsWith('/')||prefix.includes('..')||!prefix)errors.push('Unsafe lane path '+prefix);
      if(prefixes.has(prefix))errors.push('Duplicate lane path '+prefix);
      prefixes.add(prefix);
    }
  }
  for(const cap of caps){
    if(!cap.id||ids.has(cap.id))errors.push('Duplicate capability ID '+cap.id);
    if(!cap.canonicalPath||paths.has(cap.canonicalPath))errors.push('Duplicate canonical path '+cap.canonicalPath);
    ids.add(cap.id);paths.add(cap.canonicalPath);
    const owner=lanes.find(x=>x.code===cap.ownerLane);
    if(!owner?.pathPrefixes.some(prefix=>cap.canonicalPath.startsWith(prefix)))
      errors.push('Capability outside owner lane '+cap.id);
  }
  for(const id of ['website-patterns','website-extraction-and-router','js1-js10-proposals','manufacturing-process-inference','supplier-capability-matching','reviewed-evidence-engineering-contract'])
    if(!ids.has(id))errors.push('Missing canonical capability '+id);
  return errors;
}
export function classifyChangedPaths(files,registry){
  const lanes=new Set(),unknown=[];
  for(const file of files){
    const owners=registry.lanes.filter(lane=>lane.pathPrefixes.some(prefix=>file.startsWith(prefix)));
    if(owners.length===1)lanes.add(owners[0].code);
    else unknown.push(file+(owners.length>1?' (ambiguous)':' (unowned)'));
  }
  return {lanes:[...lanes],unknown};
}
function checked(body,needle){
  return body.split('\n').some(line=>/^- \[[xX]\] /.test(line.trim())&&line.includes(needle));
}
export function validatePullRequest({body='',files=[],registry,branch=''}){
  const errors=[];
  const match=body.match(/^\*\*Workstream:\*\*\s*(ACQUISITION|MANUFACTURING|INTEGRATION|PLATFORM)\s*$/m);
  if(!match)errors.push('Set **Workstream:** to an allowed single lane');
  if(!/^\*\*Primary owner:\*\*\s*\S+/m.test(body))errors.push('Name a primary owner');
  if(!/^\*\*Tracking issue:\*\*\s*#\d+\b/m.test(body))errors.push('Link **Tracking issue:** #number');
  for(const value of [
    'I searched existing code','I ran the relevant local tests',
    'I did not add private research','This PR does not claim'
  ])if(!checked(body,value))errors.push('Review and check PR declaration: '+value);
  if(!files.length)errors.push('Empty changed-file list');
  const classified=classifyChangedPaths(files,registry);
  for(const path of classified.unknown)errors.push('No unique workstream owns changed file: '+path);
  const shared=classified.lanes.length>1||files.some(file=>
    file.startsWith('contracts/')||file.startsWith('integration/')||
    file==='Scrappers/src/types.ts'||file==='Scrappers/src/js-profile.ts'||
    file==='Scrappers/src/patricio-pilot.ts'||file==='Scrappers/wrangler.jsonc'||
    file.startsWith('.github/workflows/')||file==='collaboration/workstreams.json'||
    file==='docs/collaboration/INTEGRATION_CONTRACT.md');
  const crossChecked=checked(body,'**Shared interface / multi-lane / deployment change:**');
  if(shared&&!crossChecked)errors.push('Shared/multi-lane changes require the checked shared-change declaration and both engineers reviewing');
  if(match&&!classified.lanes.includes(match[1])&&!(classified.lanes.length>1&&crossChecked))
    errors.push('Declared PR workstream does not own any changed paths');
  if(branch&&!/^(feat\/(acquisition|manufacturing)-|integration\/|chore\/|fix\/|docs\/)/.test(branch))
    errors.push('Use feat/acquisition-, feat/manufacturing-, integration/, chore/, fix/ or docs/ branches');
  return errors;
}
export function validateDraftContract(schema,fixture){
  const errors=[];
  if(schema?.properties?.schemaVersion?.const!=='0.0-proposal'||fixture.schemaVersion!=='0.0-proposal')
    errors.push('Contract must remain an explicit nonfinal proposal');
  if(!fixture.company?.companyRef||fixture.product?.companyRef!==fixture.company.companyRef)
    errors.push('Invalid provisional company/product relation');
  if(!Array.isArray(fixture.components)||!fixture.components.length)errors.push('Missing synthetic component');
  for(const component of fixture.components||[]){
    if(!component.componentRef||!['explicit_source','engineering_hypothesis','unknown'].includes(component.roleClassification?.basis))
      errors.push('Component role classification basis missing');
    for(const fact of component.facts||[]){
      if(!['candidate','reviewed','rejected'].includes(fact.reviewStatus))errors.push('Invalid fact review status');
      if(typeof fact.source?.quote!=='string'||fact.source.quote.length<12||typeof fact.source?.url!=='string')
        errors.push('Missing fact source quotation/URL');
    }
  }
  return errors;
}
export function checkNoDirectDeployment(workflows){
  return workflows.filter(x=>/\bwrangler\s+deploy\b|CLOUDFLARE_API_TOKEN|CLOUDFLARE_ACCOUNT_ID/.test(x.content))
    .map(x=>'Forbidden direct Cloudflare deployment in source workflow '+x.path+' (use development-controller)');
}
function run(){
  const registry=JSON.parse(readFileSync(resolve(root,'collaboration/workstreams.json'),'utf8'));
  const schema=JSON.parse(readFileSync(resolve(root,'contracts/proposals/evidence-to-engineering.v0.schema.json'),'utf8'));
  const sample=JSON.parse(readFileSync(resolve(root,'contracts/proposals/evidence-to-engineering.example.json'),'utf8'));
  const errors=[
    ...validateRegistry(registry),...validateDraftContract(schema,sample),
    ...checkNoDirectDeployment(readdirSync('.github/workflows')
      .filter(x=>/\.ya?ml$/.test(x))
      .map(path=>({path,content:readFileSync(join('.github/workflows',path),'utf8')})))
  ];
  if(process.env.GITHUB_EVENT_NAME==='pull_request'){
    const event=JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH,'utf8'));
    const baseSha=event.pull_request?.base?.sha;
    if(!baseSha)throw Error('Missing PR base commit SHA');
    const files=execFileSync('git',['diff','--name-only',baseSha,'HEAD'],{encoding:'utf8'}).trim().split(/\r?\n/).filter(Boolean);
    errors.push(...validatePullRequest({body:event.pull_request.body||'',files,registry,branch:event.pull_request.head.ref||''}));
    console.log('PR changed paths:',files.length,'Workstreams:',classifyChangedPaths(files,registry));
  }
  if(errors.length){
    for(const error of errors)console.error('::error::'+error);
    process.exitCode=1;
  }else console.log('PASS: ownership, contracts, PR declarations, and controller-only deployment policy.');
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))run();
