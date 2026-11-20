/** Read-only, local code reference for OEM category -> manufacturing-process priors.
 * The full user taxonomy stays in gitignored Scrappers/local-data, never public Git.
 * All links are UNREVIEWED industry possibilities, not company process claims.
 */
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

export const OEM_REFERENCE_FILENAME='oem_industry_v0.5_code_reference.json';
export const OEM_REFERENCE_SHA256='a88626a55f2d7c87ca17fb2a10f0431a67ef1d3aa1f1dc085d34660e42d2e79d';
export const OEM_LOCAL_REFERENCE_PATH=resolve(dirname(fileURLToPath(import.meta.url)),'..','local-data',OEM_REFERENCE_FILENAME);
const STOP=new Set('a an and or for the with from by of to in into on that system systems product products components assembly assemblies heavy duty industrial generic replacement compatible accessory kit parts part series model frame body unit units made steel aluminum aluminium plastic stainless'.split(' '));
const words=x=>[...new Set(String(x||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').split(' ').filter(x=>x.length>2&&!STOP.has(x)))];
const pick=(v,n)=>Array.isArray(v)?v.slice(0,n):[];
const clean=x=>String(x||'').replace(/\s+/g,' ').trim();
const hash=s=>createHash('sha256').update(s).digest('hex');

export function createOemProcessReference(source,{strict=false}={}){
 if(!source||source.schemaVersion!=='pi-oem-industry-taxonomy/code-v0.5'||
    !Array.isArray(source.DATA)||!Array.isArray(source.EDGES?.p)||!source.EDGES?.e)
    throw Error('OEM reference schema mismatch');
 const nodes=[],byCode=new Map(),byLevel=[[],[],[],[]],proc=source.EDGES.p,links=source.EDGES.e;
 const visit=(node,level,path=[])=>{
   if(level>3||!node||typeof node.code!=='string'||typeof node.label!=='string'||
      !/^[a-z0-9_]{2,180}$/.test(node.code)||!clean(node.label)||byCode.has(node.code))
      throw Error('Invalid or duplicate OEM taxonomy code');
   const record={code:node.code,label:clean(node.label),level,path:[...path,clean(node.label)].join(' > ')};
   nodes.push(record);byCode.set(record.code,record);byLevel[level].push(record);
   if(nodes.length>12000)throw Error('OEM taxonomy too large');
   for(const c of pick(node.children,1000))visit(c,level+1,[...path,record.label]);
 };
 for(const root of pick(source.DATA,100))visit(root,0);
 if(!nodes.length||proc.length>500||!proc.length)throw Error('Incomplete taxonomy reference');
 if(proc.some(x=>typeof x!=='string'||!clean(x)||x.length>130))throw Error('Invalid process dictionary');
 const roles=source.processRoles, prevalence=source.processPrevalence;
 if(!Array.isArray(roles)||roles.length!==5||!Array.isArray(prevalence)||prevalence.length!==3)
   throw Error('Invalid process role dictionary');
 let linkCount=0;
 for(const [code,edges] of Object.entries(links)){
  if(!byCode.has(code)||byCode.get(code).level!==3||!Array.isArray(edges)||edges.length>80)
    throw Error('Invalid process edge category');
  for(const e of edges){
   if(!Array.isArray(e)||e.length<3||e.length>4||
      !Number.isInteger(e[0])||e[0]<0||e[0]>=proc.length||
      !Number.isInteger(e[1])||e[1]<0||e[1]>=roles.length||
      !Number.isInteger(e[2])||e[2]<0||e[2]>=prevalence.length||
      (e[3]!==undefined&&(typeof e[3]!=='string'||e[3].length>160)))
    throw Error('Invalid process edge');
   linkCount++;
  }
 }
 if(strict&&(nodes.length!==1213||proc.length!==220||byLevel[3].length!==1004||
   Object.keys(links).length!==1004||linkCount!==10388))
   throw Error('Pinned original taxonomy counts mismatch');
 const leafRows=byLevel[3].map(n=>({...n,tokens:words(n.label)}));
 const dictionary=new Map(proc.map((name,index)=>[name.toLowerCase(),index]));
 const decode=(code,{max=5}={})=>{
   const n=byCode.get(code);if(!n)return[];
   return pick((links[code]||[]).map(e=>({name:proc[e[0]],role:roles[e[1]],
     prevalence:prevalence[e[2]],materialContext:e[3]||null,referenceCode:code,
     provenance:'original_unreviewed_process_link',certainty:'hypothesis_only',
     priority:e[2],rolePriority:e[1]}))
     .sort((a,b)=>a.priority-b.priority||a.rolePriority-b.rolePriority),Math.min(max,20));
 };
 const candidates=(part,{max=2,threshold=0.72}={})=>{
   const query=words(part);if(query.length<2)return[];
   return leafRows.map(n=>{
     if(!n.tokens.length)return null;
     const shared=n.tokens.filter(x=>query.includes(x)).length;
     const precision=shared/n.tokens.length,recall=shared/query.length;
     const score=0.63*precision+0.37*recall;
     return shared>=2&&precision>=0.55&&score>=threshold?{code:n.code,label:n.label,score}:null;
   }).filter(Boolean).sort((a,b)=>b.score-a.score).slice(0,Math.min(max,4));
 };
 const advisoryRules=part=>{
   const t=clean(part).toLowerCase(),rules=[];
   const add=(when, names)=>{if(when)for(const name of names)if(dictionary.has(name.toLowerCase()))rules.push(name);};
   add(/\b(tube|tubing|pipe)\b/.test(t),['Tube & Pipe Bending','Tube Laser Cutting','Tube & Pipe Fabrication']);
   add(/\b(bracket|mounting plate|gusset)\b/.test(t),['Laser Cutting','Press Brake Bending','Metal Stamping']);
   add(/\b(shaft|spindle|axle)\b/.test(t),['Turning','Cylindrical Grinding','Milling']);
   add(/\b(gear|pinion)\b/.test(t),['Gear Hobbing','Gear Cutting & Splining','Gear Grinding & Honing']);
   add(/\b(sheet|panel|plate|cover)\b/.test(t),['Sheet & Plate Cutting','Bending & Folding','Laser Cutting']);
   add(/\b(wire harness|cable harness)\b/.test(t),['Wire Harness & Cable Assembly','Electrical & Functional Testing']);
   return [...new Set(rules)].slice(0,2).map(name=>({
     name,role:'possible',prevalence:'unknown',referenceCode:null,
     provenance:'illustrative_part_shape_rule',certainty:'hypothesis_only',
     materialContext:null}));
 };
 return Object.freeze({
   status:'loaded',schemaVersion:source.schemaVersion,reviewStatus:'unreviewed_draft_reference',
   sourceSha256:source.sourceSha256,counts:{nodes:nodes.length,leaves:byLevel[3].length,
     processes:proc.length,links:linkCount},
   nodes,byCode,processNames:[...proc],decode,candidates,advisoryRules
 });
}
let cached=null;
export async function loadOemProcessReference({filePath=OEM_LOCAL_REFERENCE_PATH,strict=true}={}){
 if(cached&&filePath===OEM_LOCAL_REFERENCE_PATH)return cached;
 let raw;
 try{raw=await readFile(filePath,'utf8');}
 catch(e){if(e?.code==='ENOENT')return null;throw e;}
 if(Buffer.byteLength(raw)>1_200_000)throw Error('OEM process reference larger than safe limit');
 const actual=hash(raw);
 if(strict&&actual!==OEM_REFERENCE_SHA256)
   throw Error('OEM process JSON integrity mismatch; refusing unreviewed/tampered reference');
 const ref=createOemProcessReference(JSON.parse(raw),{strict});
 if(strict&&filePath===OEM_LOCAL_REFERENCE_PATH)cached=ref;
 return ref;
}
