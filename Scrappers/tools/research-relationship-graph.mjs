/** Company -> known website products -> observed/AI-hypothesis parts -> materials
 * -> possible manufacturing processes -> immutable OEM classification targets.
 * No per-product JS1-JS10, no original taxonomy changes or OS writes.
 */
import {createHash} from 'node:crypto';
export const RESEARCH_GRAPH_SCHEMA='pi-research-relationship-graph/v1';
const clean=(x,n=150)=>String(x??'').replace(/\s+/g,' ').trim().slice(0,n);
const id=(type,key)=>type+':'+createHash('sha256').update(key).digest('hex').slice(0,18);
const norm=x=>clean(x).toLowerCase();
const arr=(v,n)=>Array.isArray(v)?v.slice(0,n):[];
const site=x=>{try{const u=new URL(x);return ['http:','https:'].includes(u.protocol)?u.hostname.toLowerCase().replace(/^www\./,''):null;}catch{return null;}};
const validUrl=(u,host)=>typeof u==='string'&&u.length<700&&site(u)===host;
const minmax=(n,a,b)=>Math.min(b,Math.max(a,n));
export function buildResearchGraph({companyName,companyUrl,products=[],
  processReference=null,aiParts=[],limitProducts=24}={}){
 const root=site(companyUrl);
 if(!root)throw Error('A valid company website is required for a source-anchored graph');
 const nodes=[],links=[],mapped=[],gaps=[],seenNodes=new Set(),seenLinks=new Set();
 const counts={companies:1,products:0,observedParts:0,aiHypothesisParts:0,materials:0,
   taxonomyMappings:0,processHypotheses:0,unmappedProducts:0,unmappedParts:0};
 const companyId=id('company',root);
 const put=(n)=>{if(!seenNodes.has(n.id)){seenNodes.add(n.id);nodes.push(n);}return n.id;};
 const link=(from,to,relation,status,details={})=>{
   const key=from+'|'+to+'|'+relation;
   if(!seenLinks.has(key)){seenLinks.add(key);links.push({from,to,relation,status,...details});}
 };
 put({id:companyId,kind:'company',label:clean(companyName||root),url:companyUrl,
   status:'website_subject_not_verified_manufacturer'});
 const reference=processReference?.status==='loaded'?processReference:null;
 const addProcess=(target,process,reason,{product,part=null,code=null}={})=>{
   if(!process?.name)return;
   const pid=put({id:id('process',norm(process.name)),kind:'process',
     label:clean(process.name,130),status:'unreviewed_process_type',
     provenance:'original_oem_process_dictionary'});
   link(target,pid,'possible_manufacturing_process','hypothesis_not_company_capability',{
     basis:reason,referenceCode:code||process.referenceCode||null,
     prevalence:process.prevalence||'unknown',role:process.role||'possible',
     materialContext:clean(process.materialContext||'',110)||null});
 };
 const classify=(target,name,sourceUrl,{product,part=null,suggestions=[]}={})=>{
   if(!reference){gaps.push({item:name,sourceUrl,reason:'process_reference_unavailable',
     kind:part?'part':'product'});return false;}
   let choices=[];
   for(const candidate of arr(suggestions,3)){
     const key=clean(candidate?.code||'',180),node=reference.byCode.get(key);
     if(node&&node.level>=2&&node.level<=3&&!choices.some(x=>x.code===node.code))
       choices.push({code:node.code,label:node.label,confidence:'unverified_source_or_ai_candidate',
         method:clean(candidate.method||'existing_category_candidate',80)});
   }
   if(!choices.length)for(const c of reference.candidates(name,{max:2,threshold:0.78}))
     choices.push({code:c.code,label:c.label,confidence:'unverified_lexical_candidate',method:'local_label_overlap'});
   if(!choices.length){
     gaps.push({item:name,sourceUrl,reason:'no_exact_existing_oem_category',kind:part?'part':'product'});
     return false;
   }
   // Classification never creates a new master code. Exact source code lookups only.
   for(const c of choices.slice(0,2)){
     const cat=reference.byCode.get(c.code);
     if(!cat)continue;
     link(target,'original:'+cat.code,'proposed_existing_taxonomy_mapping','needs_review',{
       method:c.method,referencePath:cat.path,confidence:c.confidence});
     mapped.push({product,part,item:name,kind:part?'part':'product',sourceUrl,targetCode:cat.code,
       targetLabel:cat.label,method:c.method,status:'needs_review'});
     if(cat.level===3)for(const process of reference.decode(cat.code,{max:3}))
       addProcess(target,process,'existing_category_draft_prior',{product,part,code:cat.code});
   }
   return true;
 };
 const approvedAI=new Map();
 for(const p of arr(aiParts,5))if(p&&typeof p.productName==='string'){
   const key=norm(p.productName);
   if(!approvedAI.has(key))approvedAI.set(key,arr(p.parts,4));
 }
 for(const p of arr(products,minmax(limitProducts,1,30))){
   const name=clean(p?.name,135),sourceUrl=clean(p?.sourceUrl,650);
   if(!name||!validUrl(sourceUrl,root))continue;
   const productId=put({id:id('product',root+'|'+sourceUrl+'|'+norm(name)),
     kind:'product',label:name,sourceUrl,status:'observed_website_product_candidate'});
   counts.products++;
   link(companyId,productId,'company_website_lists_product','observed_candidate',
     {ownership:'manufacture_distribute_or_resell_not_established'});
   if(!classify(productId,name,sourceUrl,{product:name,suggestions:p.taxonomy?.suggestions||[]}))
     counts.unmappedProducts++;
   const partSeen=new Set();
   const sourceParts=arr(p.components,7).map(x=>({name:clean(x.component||x.value||x.name,130),
     quote:clean(x.evidence?.quote,230),sourceUrl:x.evidence?.sourceUrl||sourceUrl,
     status:'source_mentioned_component_or_accessory'})).filter(x=>x.name&&x.quote&&validUrl(x.sourceUrl,root));
   const suggested=arr(approvedAI.get(norm(name)),4).map(x=>({
     name:clean(x.name,120),quote:null,sourceUrl,
     status:'ai_hypothetical_part_not_a_verified_bom',
     suggestedProcesses:arr(x.processes,3)})).filter(x=>x.name);
   for(const part of [...sourceParts,...suggested].slice(0,10)){
     const key=norm(part.name);if(partSeen.has(key))continue;partSeen.add(key);
     const partId=put({id:id('part',productId+'|'+key),kind:'part',label:part.name,
       sourceUrl:part.sourceUrl,evidenceQuote:part.quote,modelInferred:!!part.suggestedProcesses,
       status:part.status});
     link(productId,partId,'possible_part_or_accessory','unverified',{
       reason:part.status,sourceQuote:part.quote});
     if(part.suggestedProcesses)counts.aiHypothesisParts++;else counts.observedParts++;
     const matched=classify(partId,part.name,part.sourceUrl,{product:name,part:part.name});
     if(!matched)counts.unmappedParts++;
     if(reference){
       // If no exact leaf match exists, use *explicitly illustrative* shape rules;
       // no part-to-process relation implies this company owns a process capability.
       if(!matched)for(const prior of reference.advisoryRules(part.name))
         addProcess(partId,prior,'illustrative_part_shape_rule',{product:name,part:part.name});
       for(const proposed of part.suggestedProcesses||[]){
         const candidate=reference.processNames.find(x=>norm(x)===norm(proposed));
         if(candidate)addProcess(partId,{name:candidate,role:'AI suggested',prevalence:'unknown'},
           'bounded_local_ollama_hypothesis',{product:name,part:part.name});
       }
     }
   }
   for(const mat of arr(p.materials,5)){
     const name=clean(mat?.material||mat?.value||mat?.name,100),quote=clean(mat?.evidence?.quote,230),
       url=mat?.evidence?.sourceUrl||sourceUrl;
     if(!name||!quote||!validUrl(url,root))continue;
     const matId=put({id:id('material',norm(name)),kind:'material',label:name,
       status:'website_material_mention'});
     link(productId,matId,'source_mentions_material','candidate_not_part_specific',
       {sourceUrl:url,sourceQuote:quote}); 
   }
 }
 counts.materials=nodes.filter(n=>n.kind==='material').length;
 counts.taxonomyMappings=mapped.length;
 counts.processHypotheses=links.filter(x=>x.relation==='possible_manufacturing_process').length;
 return {schemaVersion:RESEARCH_GRAPH_SCHEMA,company:{name:clean(companyName||root),host:root,
   url:companyUrl},originalTaxonomy:{status:reference?'available':'not_loaded',
     sourceHash:reference?.sourceSha256||null,masterModified:false},
   nodes,links,mappings:mapped,gaps,counts,
   source:'local_laptop_research',
   limitations:[
     'Product appearance on a website is not evidence that the company manufactures it.',
     'A mentioned component is not a verified integral bill-of-materials part.',
     'Manufacturing processes are unreviewed industry priors or explicitly labeled hypotheses, never verified in-house capabilities.',
     'The original OEM reference and InsideJob OS were not modified.'
   ],originalMasterModified:false,osWritePerformed:false};
}
