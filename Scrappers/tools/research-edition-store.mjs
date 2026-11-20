/** Append-only CODE/JSON working editions in gitignored local-data.
 * No database, no OS API integration, no write to the original OEM taxonomy.
 */
import {createHash,randomBytes} from 'node:crypto';
import {mkdir,readFile,writeFile,rename,rm} from 'node:fs/promises';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {RESEARCH_GRAPH_SCHEMA} from './research-relationship-graph.mjs';

export const LOCAL_WORKING_DIR=resolve(dirname(fileURLToPath(import.meta.url)),
 '..','local-data','product-insights-working');
export const EDITION_SCHEMA='pi-ai-working-edition-json/v1';
const sha=s=>createHash('sha256').update(s).digest('hex');
const empty=()=>({schemaVersion:EDITION_SCHEMA,version:0,source:'local_laptop',
 status:'proposals_unreviewed_no_original_mutations',
 runs:[],workingNodes:[],workingRelations:[],totals:{companies:0,products:0,parts:0,
  materials:0,processHypotheses:0,taxonomyMappings:0,gaps:0,candidateNodes:0,
  candidateRelations:0},updatedAt:null});
async function readJson(file){try{return JSON.parse(await readFile(file,'utf8'));}catch(e){if(e?.code==='ENOENT')return null;throw e;}}
async function atomic(file,value){
 await mkdir(dirname(file),{recursive:true,mode:0o700});
 const temp=file+'.'+randomBytes(8).toString('hex')+'.tmp';
 try{await writeFile(temp,JSON.stringify(value,null,2),'utf8');await rename(temp,file);}
 finally{await rm(temp,{force:true}).catch(()=>{});}
}
export async function readResearchEdition({directory=LOCAL_WORKING_DIR}={}){
 const item=await readJson(join(directory,'edition-manifest.json'));
 if(!item)return empty();
 if(item.schemaVersion!==EDITION_SCHEMA||!Number.isInteger(item.version)||
   !Array.isArray(item.runs)||item.runs.length>250)
   throw Error('Local working edition manifest is invalid');
 return item;
}
const normalize=x=>String(x||'').replace(/\s+/g,' ').trim().toLowerCase();
/** Build candidate index without claiming that identical names prove identical parts.
 * Each candidate retains the sites that contributed that label. The per-run JSON
 * archives preserve full source evidence and relationships for later review.
 */
function mergeCandidateIndex(prior,graph,now){
 const nodeMap=new Map((prior.workingNodes||[]).map(x=>[x.key,{...x,
   companyHosts:[...(x.companyHosts||[])]}]));
 const linkMap=new Map((prior.workingRelations||[]).map(x=>[x.key,{...x}]));
 const newIds=new Map(),origin=new Map(graph.nodes.map(x=>[x.id,x]));
 for(const node of graph.nodes){
   if(!['product','part','material','process'].includes(node?.kind))continue;
   const key=sha(node.kind+'|'+(node.kind==='product'?graph.company.host+'|'+
      normalize(node.sourceUrl)+'|':'')+normalize(node.label)).slice(0,24);
   newIds.set(node.id,key);
   const old=nodeMap.get(key);
   if(old){
     old.occurrences=(old.occurrences||0)+1;old.lastSeenAt=now;
     if(!old.companyHosts.includes(graph.company.host)&&old.companyHosts.length<12)
       old.companyHosts.push(graph.company.host);
   }else if(nodeMap.size<4000){
     nodeMap.set(key,{key,kind:node.kind,label:String(node.label||'').slice(0,140),
       occurrences:1,companyHosts:[graph.company.host],firstSeenAt:now,lastSeenAt:now,
       status:node.status||'unverified_candidate',sourceUrl:node.sourceUrl||null});
   }
 }
 for(const edge of graph.links){
   const from=newIds.get(edge.from),to=newIds.get(edge.to)||
     (typeof edge.to==='string'&&edge.to.startsWith('original:')?edge.to:null);
   if(!from||!to||!['possible_part_or_accessory','source_mentions_material',
       'possible_manufacturing_process','proposed_existing_taxonomy_mapping'].includes(edge.relation))continue;
   const key=sha(from+'|'+edge.relation+'|'+to).slice(0,24);
   const existing=linkMap.get(key);
   if(existing){existing.occurrences=(existing.occurrences||0)+1;
     existing.lastSeenAt=now;}
   else if(linkMap.size<9000)linkMap.set(key,{key,from,to,
     relation:edge.relation,occurrences:1,lastSeenAt:now,
     status:'unreviewed_relation_candidate'});
 }
 return {workingNodes:[...nodeMap.values()],workingRelations:[...linkMap.values()]};
}

export async function appendResearchEdition(graph,{directory=LOCAL_WORKING_DIR}={}){
 if(graph?.schemaVersion!==RESEARCH_GRAPH_SCHEMA||graph.originalMasterModified!==false||
   graph.osWritePerformed!==false||!graph.company?.host)
   throw Error('Only read-only, valid research graphs can enter the working edition');
 const json=JSON.stringify(graph);
 if(Buffer.byteLength(json,'utf8')>520000)throw Error('Research graph exceeds bounded JSON limit');
 const fingerprint=sha(json),file=join(directory,'runs',fingerprint+'.json');
 const prior=await readResearchEdition({directory});
 const existing=prior.runs.find(x=>x.fingerprint===fingerprint);
 if(existing)return {added:false,version:prior.version,run:existing,totals:prior.totals};
 if(prior.runs.length>=250)throw Error('Working edition reached 250-run prototype limit; no silent deletion');
 await mkdir(dirname(file),{recursive:true,mode:0o700});
 // Immutable per-run artifact. Duplicate runs are reused, never overwritten.
 try{await writeFile(file,JSON.stringify({schemaVersion:EDITION_SCHEMA,
   createdAt:new Date().toISOString(),fingerprint,graph},null,2),{flag:'wx',mode:0o600});}
 catch(e){if(e?.code!=='EEXIST')throw e;}
 const now=new Date().toISOString(),run={
   id:'run-'+fingerprint.slice(0,15),fingerprint,companyHost:graph.company.host,
   companyName:graph.company.name,createdAt:now,graphFile:'runs/'+fingerprint+'.json',
   counts:graph.counts||{},status:'unreviewed'};
 const runs=[...prior.runs,run];
 const counts={companies:new Set(runs.map(x=>x.companyHost)).size,
   products:runs.reduce((n,x)=>n+Number(x.counts.products||0),0),
   parts:runs.reduce((n,x)=>n+Number(x.counts.observedParts||0)+Number(x.counts.aiHypothesisParts||0),0),
   materials:runs.reduce((n,x)=>n+Number(x.counts.materials||0),0),
   processHypotheses:runs.reduce((n,x)=>n+Number(x.counts.processHypotheses||0),0),
   taxonomyMappings:runs.reduce((n,x)=>n+Number(x.counts.taxonomyMappings||0),0),
   gaps:runs.reduce((n,x)=>n+Number(x.counts.unmappedProducts||0)+Number(x.counts.unmappedParts||0),0)};
 const version=prior.version+1,aggregated=mergeCandidateIndex(prior,graph,now);
 counts.candidateNodes=aggregated.workingNodes.length;
 counts.candidateRelations=aggregated.workingRelations.length;
 const next={schemaVersion:EDITION_SCHEMA,version,source:'local_laptop',
   status:'proposals_unreviewed_no_original_mutations',
   runs,...aggregated,totals:counts,updatedAt:now,
   originalMasterModified:false,osWritePerformed:false};
 // Keep immutable versioned manifests for audit, and a current code/JSON pointer.
 const archive=join(directory,'versions','edition-'+String(version).padStart(4,'0')+'.json');
 if(await readJson(archive))throw Error('Edition version collision; refusing overwrite');
 await atomic(archive,next);await atomic(join(directory,'edition-manifest.json'),next);
 return {added:true,version,run,totals:counts};
}
export function publicEditionSummary(edition){
 return {schemaVersion:EDITION_SCHEMA,version:edition.version||0,
  status:edition.status||'not_available',updatedAt:edition.updatedAt||null,
  totals:edition.totals||empty().totals,
  candidateNodes:edition.workingNodes?.length||0,
  candidateRelations:edition.workingRelations?.length||0,
  candidateSamples:(edition.workingNodes||[]).slice(-10).map(x=>({
    kind:x.kind,label:x.label,status:x.status,
    companyCount:(x.companyHosts||[]).length,occurrences:x.occurrences||0})),
  recentCompanies:(edition.runs||[]).slice(-10).map(x=>({
    companyName:String(x.companyName||'').slice(0,100),
    companyHost:String(x.companyHost||'').slice(0,140),
    counts:x.counts||{},version:x.id})),
  originalMasterModified:false,osWritePerformed:false};
}
