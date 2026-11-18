/** Stage 2 PC-local review queue and versioned WORKING taxonomy editions.
 * Never overwrite the supplied master taxonomy. No silent AI auto-approval.
 * All state lives inside gitignored Scrappers/local-data/.
 */
import {createHash,randomBytes} from 'node:crypto';
import {mkdir,readFile,rename,rm,writeFile} from 'node:fs/promises';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {makeManifest} from './research-taxonomy-store.mjs';

const BASE=resolve(dirname(fileURLToPath(import.meta.url)),'..','local-data','stage2');
export const STAGE2_PROPOSALS_PATH=join(BASE,'proposals.json');
export const STAGE2_WORKING_PATH=join(BASE,'working-taxonomy.json');
const hash=s=>createHash('sha256').update(String(s)).digest('hex');
const norm=s=>String(s||'').replace(/\s+/g,' ').trim().toLowerCase();
async function jsonFile(file){
  try{return JSON.parse(await readFile(file,'utf8'));}
  catch(e){if(e?.code==='ENOENT')return null;throw e;}
}
async function writeJson(file,data){
  await mkdir(dirname(file),{recursive:true,mode:0o700});
  const temp=join(dirname(file),'.stage2-'+randomBytes(8).toString('hex')+'.tmp');
  try{await writeFile(temp,JSON.stringify(data,null,2),'utf8');await rename(temp,file);}
  finally{await rm(temp,{force:true}).catch(()=>{});}
}
const empty=()=>({schemaVersion:'insidejob-stage2-proposals/1',proposals:[]});
function proposalId(p){
  return hash([p.kind,norm(p.label),p.parentCode||'',p.existingCode||''].join('|')).slice(0,20);
}
function validProposal(p){
  if(!p||typeof p!=='object'||!['new_node','alias'].includes(p.kind))return false;
  for(const key of ['label','reason','productName','quote','sourceUrl'])
    if(typeof p[key]!=='string'||!p[key].trim())return false;
  if(p.label.length>150||p.reason.length>500||p.quote.length<12||p.quote.length>300)return false;
  try{const u=new URL(p.sourceUrl);if(!['http:','https:'].includes(u.protocol)||u.username||u.password)return false;}
  catch{return false;}
  if(p.kind==='new_node'&&typeof p.parentCode!=='string')return false;
  if(p.kind==='alias'&&typeof p.existingCode!=='string')return false;
  return true;
}
export async function listTaxonomyProposals({path=STAGE2_PROPOSALS_PATH}={}){
  const file=await jsonFile(path);
  if(!file)return empty();
  if(file.schemaVersion!=='insidejob-stage2-proposals/1'||!Array.isArray(file.proposals)||file.proposals.length>500)throw Error('Invalid local taxonomy proposal queue');
  return file;
}
export async function enqueueTaxonomyProposals(items,{path=STAGE2_PROPOSALS_PATH,baseNodeHash}={}){
  if(!Array.isArray(items)||items.length>20)throw Error('Invalid taxonomy proposal batch');
  const queue=await listTaxonomyProposals({path}),existing=new Set(queue.proposals.map(p=>p.id));
  let added=0;
  for(const p of items){
    if(!validProposal(p)||queue.proposals.length>=500)continue;
    const id=proposalId(p);
    if(existing.has(id))continue;
    existing.add(id);added++;
    queue.proposals.push({id,kind:p.kind,label:p.label.trim(),parentCode:p.kind==='new_node'?p.parentCode:null,
      existingCode:p.kind==='alias'?p.existingCode:null,reason:p.reason.trim().slice(0,500),
      productName:p.productName.trim(),sourceUrl:p.sourceUrl,quote:p.quote.trim(),
      baseNodeHash:baseNodeHash||null,createdAt:new Date().toISOString(),status:'pending',
      attribution:'Cloudflare AI suggestion from user-researched website; not independently verified',
      approval:null,publishedVersion:null});
  }
  if(added)await writeJson(path,queue);
  return {added,total:queue.proposals.length,pending:queue.proposals.filter(p=>p.status==='pending').length};
}
export async function reviewTaxonomyProposal({id,decision,reviewer='local_presenter',reason='',path=STAGE2_PROPOSALS_PATH}={}){
  if(!['approved','rejected'].includes(decision)||typeof id!=='string')throw Error('Review decision must be approved or rejected');
  const queue=await listTaxonomyProposals({path}),p=queue.proposals.find(x=>x.id===id);
  if(!p)throw Error('Proposal not found');
  if(p.status!=='pending')throw Error('Only pending proposals may be reviewed');
  p.status=decision;p.approval={reviewer:String(reviewer).slice(0,80),reason:String(reason).slice(0,350),
    decidedAt:new Date().toISOString()};
  await writeJson(path,queue);
  return p;
}
function validateEdition(edition,base){
  if(edition.baseNodeHash!==base.manifest.nodeHash)throw Error('Working edition belongs to a different installed master taxonomy; no automatic migration');
  if(edition.schemaVersion!=='insidejob-local-taxonomy-edition/1'||!Array.isArray(edition.nodes)||!Array.isArray(edition.aliases))throw Error('Invalid working edition');
  const codes=new Set();
  for(const n of edition.nodes){
    if(typeof n.code!=='string'||!n.code||codes.has(n.code)||typeof n.path!=='string'||typeof n.label!=='string')throw Error('Invalid edition node');
    codes.add(n.code);
  }
  if(edition.manifest?.nodeHash!==hash(JSON.stringify(edition.nodes)))throw Error('Working taxonomy checksum mismatch');
  return edition;
}
export async function loadWorkingTaxonomy(base,{path=STAGE2_WORKING_PATH}={}){
  if(!base||!Array.isArray(base.nodes)||!base.manifest)throw Error('Installed master taxonomy is required');
  const stored=await jsonFile(path);
  if(!stored)return {nodes:base.nodes,aliases:[],edition:null,manifest:base.manifest};
  const edition=validateEdition(stored,base);
  return {nodes:edition.nodes,aliases:edition.aliases,edition,manifest:edition.manifest};
}
function newCode(label,parentCode,used){
  const slug=norm(label).replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'').slice(0,45)||'category';
  const id='local_'+slug+'_'+hash(parentCode+'|'+norm(label)).slice(0,8);
  if(used.has(id))throw Error('Generated node ID collides with an existing code');
  return id;
}
export async function publishApprovedTaxonomy(base,{queuePath=STAGE2_PROPOSALS_PATH,workingPath=STAGE2_WORKING_PATH,versionsDir=join(BASE,'versions')}={}){
  const queue=await listTaxonomyProposals({path:queuePath});
  const approved=queue.proposals.filter(p=>p.status==='approved');
  if(!approved.length)throw Error('No approved taxonomy proposals to publish');
  const prior=await loadWorkingTaxonomy(base,{path:workingPath});
  const nodes=prior.nodes.map(n=>({...n})),aliases=[...prior.aliases],seenCodes=new Set(nodes.map(n=>n.code)),applied=[];
  const byCode=new Map(nodes.map(n=>[n.code,n]));
  const existingAliases=new Set(aliases.map(a=>norm(a.alias)+'|'+a.existingCode));
  for(const p of approved){
    if(p.baseNodeHash&&p.baseNodeHash!==base.manifest.nodeHash)throw Error('Proposal was created against another taxonomy; review again before publication');
    if(!validProposal(p))throw Error('Approved proposal has invalid evidence');
    if(p.kind==='new_node'){
      const parent=byCode.get(p.parentCode);
      if(!parent||parent.level>2)throw Error('Proposed parent is not a valid L0-L2 taxonomy node: '+p.parentCode);
      if(nodes.some(n=>norm(n.label)===norm(p.label)&&n.path.startsWith(parent.path+' > ')))throw Error('Duplicate child label: '+p.label);
      const code=newCode(p.label,parent.code,seenCodes);
      const newNode={code,label:p.label,level:parent.level+1,path:parent.path+' > '+p.label,
        localStatus:'human_approved_candidate',sourceProposalId:p.id};
      nodes.push(newNode);seenCodes.add(code);byCode.set(code,newNode);
    }else{
      const target=byCode.get(p.existingCode);
      if(!target||target.level<2)throw Error('Alias target must be a real L2/L3 classification');
      const key=norm(p.label)+'|'+target.code;
      if(nodes.some(n=>norm(n.label)===norm(p.label)))throw Error('Alias already exists as a taxonomy label');
      if(!existingAliases.has(key)){aliases.push({alias:p.label,existingCode:target.code,sourceProposalId:p.id});existingAliases.add(key);}
    }
    applied.push(p.id);
  }
  const version=(prior.edition?.version||0)+1;
  const manifest=makeManifest(nodes,{sourceName:'LOCAL working edition '+version,
    sourceHash:base.manifest.sourceSha256,installedAt:new Date().toISOString()});
  const edition={schemaVersion:'insidejob-local-taxonomy-edition/1',version,
    baseNodeHash:base.manifest.nodeHash,manifest,nodes,aliases,
    publishedAt:new Date().toISOString(),status:'locally_published_not_canonical',
    approvedProposalIds:[...(prior.edition?.approvedProposalIds||[]),...applied]};
  // Retain an immutable edition snapshot before swapping the current working copy.
  const snapshot=join(versionsDir,'edition-'+String(version).padStart(4,'0')+'.json');
  if(await jsonFile(snapshot))throw Error('Edition version already exists; refusing overwrite');
  await writeJson(snapshot,edition);
  await writeJson(workingPath,edition);
  for(const p of approved){p.status='published';p.publishedVersion=version;}
  await writeJson(queuePath,queue);
  return {version,addedNodes:nodes.length-prior.nodes.length,aliasesAdded:aliases.length-prior.aliases.length,
    totalNodes:nodes.length,manifest,editionPath:snapshot,status:edition.status};
}
