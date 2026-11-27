import {createHash} from 'node:crypto';
// Provider-neutral, per-run engineering review; never writes to the vocabulary database.
export const REVIEW_SCHEMA='pi-final-outcome/review-v1';
const nonempty=(v,max)=>typeof v==='string'&&v.trim().length>0&&v.length<=max;
const string=v=>v==null?'':String(v);
export function makeOutcomeWorklist(runId,report,packet){
 const sources=(packet?.batches||[]).flatMap(b=>b.input?.sources||[]);
 const leads=(report?.products||[]).map((p,i)=>({lead_id:i+1,name:p.name||p.productName||p.label,sku:string(p.sku),source_url:string(p.sourceUrl),evidence_type:string(p.evidenceType),source_ids:sources.filter(s=>s.url===p.sourceUrl).map(s=>s.id)})).filter(p=>typeof p.name==='string'&&p.name.trim());
 return {schemaVersion:'pi-final-outcome/worklist-v1',run_id:runId,leads,sources,instructions:['Fill review_template.products using the exact lead_id, name, sku and source_url. Do not rename, merge or invent extracted product identities.','For each assessed product, parts is an array of {component, material, processes, condition, basis, source_id?, quote?}. material may be empty; processes is an array of possible process names.','Use basis inferred for generic engineering hypotheses; provide a design condition. Use source_quoted_component only when a literal quote in that lead source supports the component itself; give source_id and quote. Material and process suggestions always remain conditional. Never claim actual factory capabilities or a confirmed BOM.','Set status assessed only with parts. Set status insufficient_evidence or unassessed with an empty parts array where appropriate. Output only review_template as JSON. Partial reviews are allowed.'],review_template:{schemaVersion:REVIEW_SCHEMA,run_id:runId,products:leads.map(({lead_id,name,sku,source_url})=>({lead_id,name,sku,source_url,status:'unassessed',parts:[]}))}};
}
export function validateOutcomeReview(worklist,input){
 const invalid=message=>{throw Error(message);};
 if(!input||input.schemaVersion!==REVIEW_SCHEMA||input.run_id!==worklist.run_id)invalid('Review schema or run ID does not match the current research run');
 if(!Array.isArray(input.products)||input.products.length>worklist.leads.length)invalid('Invalid review product count');
 const byId=new Map(worklist.leads.map(x=>[x.lead_id,x])),sources=new Map(worklist.sources.map(x=>[x.id,x])),seen=new Set(),products=[];
 for(const p of input.products){
  const lead=byId.get(p?.lead_id);
  if(!lead||seen.has(p.lead_id)||p.name!==lead.name||p.sku!==lead.sku||p.source_url!==lead.source_url)invalid('Unknown, duplicate or mismatched product identity');
  seen.add(p.lead_id);
  if(!['assessed','insufficient_evidence','unassessed'].includes(p.status)||!Array.isArray(p.parts)||p.parts.length>30||(p.status==='assessed')!==(p.parts.length>0))invalid('Invalid product assessment status or part count');
  const parts=[];
  for(const part of p.parts){
   if(!part||!nonempty(part.component,180)||typeof part.material!=='string'||part.material.length>180||!Array.isArray(part.processes)||part.processes.length>8||!part.processes.every(x=>nonempty(x,160))||!nonempty(part.condition,500)||!['inferred','source_quoted_component'].includes(part.basis))invalid('Invalid component hypothesis or design condition');
   const item={component:part.component,material:part.material,processes:part.processes,condition:part.condition,basis:part.basis};
   if(part.basis==='source_quoted_component'){
    const s=sources.get(part.source_id),q=part.quote;
    if(!lead.source_ids.includes(part.source_id)||!s||!nonempty(q,300)||q.trim().length<12||!String(s.text||'').includes(q)||!q.toLowerCase().includes(part.component.toLowerCase()))invalid('Component quote must be literal in the original product source and name the component');
    item.source_id=part.source_id;item.quote=q;
   }
   parts.push(item);
  }
  products.push({lead_id:p.lead_id,name:p.name,sku:p.sku,source_url:p.source_url,status:p.status,parts});
 }
 return {schemaVersion:REVIEW_SCHEMA,run_id:worklist.run_id,products};
}

export const OUTCOME_REVIEW_MAX_BYTES=1048576,OUTCOME_REVIEW_MAX_PARTS=64,OUTCOME_REVIEW_CHUNK=24000;
export const outcomeHash=text=>createHash('sha256').update(text,'utf8').digest('hex');
// Only already owner-filtered private issue comments are supplied by the queue agent.
export function assembleOutcomeReview(comments,job){
 if(!Number.isSafeInteger(job.reviewParts)||job.reviewParts<1||job.reviewParts>OUTCOME_REVIEW_MAX_PARTS||!/^[a-f0-9]{64}$/.test(job.reviewSha256||''))throw Error('Invalid review attachment metadata');
 const prefix='PI_OUTCOME_REVIEW:'+job.jobId+':',parts=new Map();
 for(const c of comments){
  const body=c?.body;if(typeof body!=='string'||!body.startsWith(prefix))continue;
  const end=body.indexOf('\n');if(end<0)throw Error('Invalid review chunk');
  const match=body.slice(prefix.length,end).match(/^([1-9]\d*)\/([1-9]\d*)$/);
  if(!match)throw Error('Invalid review marker');
  const part=Number(match[1]),total=Number(match[2]);
  if(total!==job.reviewParts||part>total||parts.has(part))throw Error('Duplicate or mismatched review part');
  if(body.length>65000)throw Error('Review comment too large');
  const payload=JSON.parse(body.slice(end+1));
  if(!payload||Array.isArray(payload)||Object.keys(payload).length!==1||typeof payload.text!=='string'||payload.text.length<1||payload.text.length>OUTCOME_REVIEW_CHUNK)throw Error('Invalid review chunk content');
  parts.set(part,payload.text);
 }
 if(parts.size!==job.reviewParts)throw Error('Incomplete review attachment');
 const raw=Array.from({length:job.reviewParts},(_,i)=>parts.get(i+1)).join('');
 if(Buffer.byteLength(raw,'utf8')>OUTCOME_REVIEW_MAX_BYTES||outcomeHash(raw)!==job.reviewSha256)throw Error('Review size or SHA-256 mismatch');
 return raw;
}
