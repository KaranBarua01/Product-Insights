import {createHash} from 'node:crypto';
// Provider-neutral, run-bound review of frozen source evidence; never changes the acquisition report or vocabulary DB.
export const LEGACY_REVIEW_SCHEMA='pi-final-outcome/review-v1',REVIEW_SCHEMA='pi-final-outcome/review-v2';
const nonempty=(v,max)=>typeof v==='string'&&v.trim().length>0&&v.length<=max;
const string=v=>v==null?'':String(v);
const norm=v=>String(v??'').normalize('NFKC').replace(/\s+/g,' ').trim().toLowerCase();
const key=(name,sku)=>JSON.stringify([norm(name),norm(sku)]);
const invalid=message=>{throw Error(message);};
const literal=(s,q)=>typeof s?.text==='string'&&typeof q==='string'&&!q.includes('[... omitted source text ...]')&&s.text.includes(q);
function extractedLeads(report,sources=[]){
 return (report?.products||[]).map((p,i)=>({lead_id:i+1,name:p.name||p.productName||p.label,sku:string(p.sku),source_url:string(p.sourceUrl),evidence_type:string(p.evidenceType),source_ids:sources.filter(s=>s.url===p.sourceUrl).map(s=>s.id)})).filter(p=>typeof p.name==='string'&&p.name.trim());
}
export function makeOutcomeWorklist(runId,report,packet){
 const sources=(packet?.batches||[]).flatMap(b=>b.input?.sources||[]),leads=extractedLeads(report,sources);
 return {schemaVersion:'pi-final-outcome/worklist-v2',run_id:runId,requested_url:report?.requestedUrl||null,leads,sources,instructions:['Review every extracted lead using its exact lead_id, name, sku and source_url. For false, duplicate or misleading leads use status rejected, reason and no parts; keep the acquisition record unchanged.','Discover additional product families or models from frozen sources even when leads is empty. Add discovered_products with exact name, sku (empty if not established), source_id, source_url and a literal identity quote containing that exact name and any SKU. Do not duplicate a nonrejected lead or another discovery. Product names must describe actual offerings, not navigation or arbitrary components.','For existing and discovered assessed products, parts is an array of {component, material, processes, condition, basis, source_id?, quote?}. Material may be empty; processes are candidate manufacturing routes. Use inferred with a design condition unless a literal quote supports the component. For cross-source component evidence, that source must also name the product. Never claim a verified BOM or factory capabilities from an inference.','Use assessed only with parts, insufficient_evidence or unassessed with no parts; rejected only for extracted leads with a reason. Submit a complete v2 review snapshot including one decision for every extracted lead; discovered_products may be empty. Partial catalogue coverage remains possible and must not be presented as exhaustive.'],review_template:{schemaVersion:REVIEW_SCHEMA,run_id:runId,products:leads.map(({lead_id,name,sku,source_url})=>({lead_id,name,sku,source_url,status:'unassessed',parts:[]})),discovered_products:[]}};
}
function validateParts(p,lead,sources,{legacy=false,allowReject=false}={}){
 const allowed=['assessed','insufficient_evidence','unassessed',...(allowReject&&!legacy?['rejected']:[])];
 if(!allowed.includes(p?.status)||!Array.isArray(p.parts)||p.parts.length>30||(p.status==='assessed')!==(p.parts.length>0))invalid('Invalid product assessment status or part count');
 if(p.status==='rejected'&&!nonempty(p.reason,500))invalid('Rejected lead requires a reason');
 const parts=[];
 for(const part of p.parts){
  if(!part||!nonempty(part.component,180)||typeof part.material!=='string'||part.material.length>180||!Array.isArray(part.processes)||part.processes.length>8||!part.processes.every(x=>nonempty(x,160))||!nonempty(part.condition,500)||!['inferred','source_quoted_component'].includes(part.basis))invalid('Invalid component hypothesis or design condition');
  const item={component:part.component,material:part.material,processes:part.processes,condition:part.condition,basis:part.basis};
  if(part.basis==='source_quoted_component'){
   const s=sources.get(part.source_id),q=part.quote;
   const linked=lead.source_ids.includes(part.source_id)||(!legacy&&s&&norm(s.text).includes(norm(lead.name)));
   if(!linked||!s||!nonempty(q,300)||q.trim().length<12||!(legacy?String(s.text||'').includes(q):literal(s,q))||!q.toLowerCase().includes(part.component.toLowerCase()))invalid('Component quote must be literal in a product-linked frozen source and name the component');
   item.source_id=part.source_id;item.quote=q;if(!legacy)item.source_url=s.url;
  }
  parts.push(item);
 }
 return {status:p.status,parts,...(p.status==='rejected'?{reason:p.reason}:{})};
}
export function validateOutcomeReview(worklist,input){
 const legacy=input?.schemaVersion===LEGACY_REVIEW_SCHEMA;
 if(!input||(!legacy&&input.schemaVersion!==REVIEW_SCHEMA)||input.run_id!==worklist.run_id)invalid('Review schema or run ID does not match the current research run');
 if(!Array.isArray(input.products)||input.products.length>worklist.leads.length||(!legacy&&input.products.length!==worklist.leads.length))invalid('Invalid review product count; v2 requires every extracted lead');
 if(legacy&&Object.hasOwn(input,'discovered_products'))invalid('Legacy review cannot contain discoveries');
 const byId=new Map(worklist.leads.map(x=>[x.lead_id,x])),sources=new Map(worklist.sources.map(x=>[x.id,x])),seen=new Set(),products=[];
 for(const p of input.products){
  const lead=byId.get(p?.lead_id);
  if(!lead||seen.has(p.lead_id)||p.name!==lead.name||p.sku!==lead.sku||p.source_url!==lead.source_url)invalid('Unknown, duplicate or mismatched product identity');
  seen.add(p.lead_id);
  products.push({lead_id:p.lead_id,name:p.name,sku:p.sku,source_url:p.source_url,...validateParts(p,lead,sources,{legacy,allowReject:true})});
 }
 if(legacy)return {schemaVersion:LEGACY_REVIEW_SCHEMA,run_id:worklist.run_id,products};
 if(!Array.isArray(input.discovered_products)||input.discovered_products.length>250)invalid('Invalid discovered product count');
 const used=new Set(products.filter(p=>p.status!=='rejected').map(p=>key(p.name,p.sku))),discovered_products=[];
 for(const p of input.discovered_products){
  if(!p||!nonempty(p.name,180)||p.name!==p.name.trim()||typeof p.sku!=='string'||p.sku.length>180||p.sku!==p.sku.trim())invalid('Invalid discovered product name or SKU');
  const s=sources.get(p.source_id),q=p.quote;
  if(!s||typeof s.url!=='string'||p.source_url!==s.url||!nonempty(q,500)||!literal(s,q)||!q.includes(p.name)||(p.sku&&!q.includes(p.sku)))invalid('Discovered product identity requires a literal frozen-source quote containing its exact name and SKU');
  const k=key(p.name,p.sku);if(used.has(k))invalid('Duplicate discovered product identity');used.add(k);
  const discovery_id='ai-'+createHash('sha256').update(k,'utf8').digest('hex');
  if(p.discovery_id!==undefined&&p.discovery_id!==discovery_id)invalid('Discovered product ID mismatch');
  const source_ids=worklist.sources.filter(x=>x.url===s.url).map(x=>x.id);
  const lead={name:p.name,source_ids};
  discovered_products.push({discovery_id,name:p.name,sku:p.sku,source_id:s.id,source_url:s.url,quote:q,...validateParts(p,lead,sources)});
 }
 return {schemaVersion:REVIEW_SCHEMA,run_id:worklist.run_id,products,discovered_products};
}
// The display catalogue is a projection, not a modification of deterministic acquisition.
export function buildOutcomeCatalogue(report,review){
 const decisions=new Map((review?.products||[]).map(p=>[p.lead_id,p])),products=[],rejected=[];
 for(const lead of extractedLeads(report)){
  const decision=decisions.get(lead.lead_id),row={...lead,origin:'extractor',review:decision||null};
  if(decision?.status==='rejected')rejected.push(row);else products.push(row);
 }
 for(const p of review?.discovered_products||[])products.push({discovery_id:p.discovery_id,name:p.name,sku:p.sku,source_url:p.source_url,evidence_type:'Source-quoted AI discovery',source_id:p.source_id,quote:p.quote,origin:'ai',review:p});
 return {products,rejected,reviewed:!!review,assessed:products.filter(p=>p.review?.status==='assessed').length,discovered:products.filter(p=>p.origin==='ai').length};
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
