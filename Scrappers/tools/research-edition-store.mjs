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
 runs:[],totals:{companies:0,products:0,parts:0,materials:0,processHypotheses:0,
  taxonomyMappings:0,gaps:0},updatedAt:null});
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
 const version=prior.version+1;
 const next={schemaVersion:EDITION_SCHEMA,version,source:'local_laptop',
   status:'proposals_unreviewed_no_original_mutations',
   runs,totals:counts,updatedAt:now,originalMasterModified:false,osWritePerformed:false};
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
  recentCompanies:(edition.runs||[]).slice(-10).map(x=>({
    companyName:String(x.companyName||'').slice(0,100),
    companyHost:String(x.companyHost||'').slice(0,140),
    counts:x.counts||{},version:x.id})),
  originalMasterModified:false,osWritePerformed:false};
}
