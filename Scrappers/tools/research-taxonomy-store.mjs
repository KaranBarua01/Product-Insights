/** Persistent, local-only taxonomy installation for the PC Research Lab.
 * Store normalized node data (never the executable taxonomy explorer HTML).
 * Do not commit the installed taxonomy to this PUBLIC source repository.
 */
import {createHash, randomBytes} from 'node:crypto';
import {mkdir, readFile, rename, rm, writeFile} from 'node:fs/promises';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseTaxonomy} from './research-planner.mjs';

const BASE=resolve(dirname(fileURLToPath(import.meta.url)),'..');
export const INSTALLED_TAXONOMY_PATH=resolve(BASE,'local-data','installed-taxonomy.json');
const SCHEMA='insidejob-local-taxonomy/1';
const hash=text=>createHash('sha256').update(text).digest('hex');
const cleanName=name=>String(name||'OEM Industry Taxonomy Explorer').split(/[\\/]/).pop().replace(/[^a-zA-Z0-9. ()_\-]/g,'').slice(0,100)||'OEM Industry Taxonomy Explorer';
function validateNodes(nodes){
  if(!Array.isArray(nodes)||!nodes.length||nodes.length>12000)throw Error('Invalid installed taxonomy: expected 1-12000 nodes');
  const seen=new Set();
  for(const n of nodes){
    if(!n||typeof n!=='object'||typeof n.code!=='string'||typeof n.label!=='string'||typeof n.path!=='string'||!Number.isInteger(n.level)||n.level<0||n.level>4)throw Error('Invalid installed taxonomy node structure');
    if(!n.code||n.code.length>180||!n.label||n.label.length>240||n.path.length>1200||seen.has(n.code))throw Error('Duplicate or invalid taxonomy node');
    seen.add(n.code);
  }
  return nodes;
}
export function makeManifest(nodes,{sourceName,sourceHash,installedAt}={}){
  const counts={};
  for(const n of nodes)counts[`L${n.level}`]=(counts[`L${n.level}`]||0)+1;
  return {schemaVersion:SCHEMA,sourceName:cleanName(sourceName),sourceSha256:sourceHash||null,installedAt:installedAt||null,
    totalNodes:nodes.length,levelCounts:counts,nodeHash:hash(JSON.stringify(nodes)),storage:'local_pc_only',verification:'structure_validated_not_fact_checked'};
}
export async function installTaxonomy(raw,{fileName,storagePath=INSTALLED_TAXONOMY_PATH}={}){
  if(typeof raw!=='string'||Buffer.byteLength(raw,'utf8')>7_000_000)throw Error('Taxonomy must be a UTF-8 file no larger than 7 MB');
  const nodes=validateNodes(parseTaxonomy(raw));
  const manifest=makeManifest(nodes,{sourceName:fileName,sourceHash:hash(raw),installedAt:new Date().toISOString()});
  const payload={manifest,nodes};
  const full=resolve(storagePath);
  await mkdir(dirname(full),{recursive:true,mode:0o700});
  const temp=join(dirname(full),`.taxonomy-${randomBytes(8).toString('hex')}.tmp`);
  try{await writeFile(temp,JSON.stringify(payload),'utf8');await rename(temp,full);}
  finally{await rm(temp,{force:true}).catch(()=>{});}
  return {nodes,manifest};
}
export async function loadInstalledTaxonomy({storagePath=INSTALLED_TAXONOMY_PATH}={}){
  let raw;
  try{raw=await readFile(resolve(storagePath),'utf8');}
  catch(e){if(e?.code==='ENOENT')return null;throw e;}
  if(Buffer.byteLength(raw,'utf8')>5_000_000)throw Error('Stored taxonomy exceeds safe size');
  const content=JSON.parse(raw);
  const nodes=validateNodes(content?.nodes);
  const manifest=content?.manifest;
  if(!manifest||manifest.schemaVersion!==SCHEMA||manifest.totalNodes!==nodes.length||manifest.nodeHash!==hash(JSON.stringify(nodes)))throw Error('Installed taxonomy integrity check failed');
  return {nodes,manifest};
}
