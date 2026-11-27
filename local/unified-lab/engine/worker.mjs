function createEngine(){
 const version="0.1.0";
 const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store","x-content-type-options":"nosniff"}});
 const norm=s=>s.trim().toLowerCase().replace(/\s+/g," ");
 const all=async(db,sql,...params)=>(await db.prepare(sql).bind(...params).all()).results;
 const one=async(db,sql,...params)=>db.prepare(sql).bind(...params).first();
 const kinds={products:["product_types","name"],categories:["categories","name"],materials:["materials","name"],processes:["manufacturing_processes","name"],taxonomy:["taxonomy_nodes","label"]};
 async function byIds(db,table,ids){
  const unique=[...new Set(ids.filter(x=>typeof x==="string"))].slice(0,80);
  if(!unique.length)return {};
  const rows=await all(db,`SELECT id,name,status FROM ${table} WHERE id IN (${unique.map(()=>"?").join(",")})`,...unique);
  return Object.fromEntries(rows.map(r=>[r.id,r]));
 }
 async function fetch(request,env){
  const db=env.PRODUCT_INSIGHTS_DB;
  try{
   const url=new URL(request.url), path=url.pathname, method=request.method;
   if(!db)return json({error:"database_binding_missing"},503);
   if(method==="GET"&&path==="/health"){
    const counts=await one(db,"SELECT (SELECT count(*) FROM product_types) AS products,(SELECT count(*) FROM categories) AS categories,(SELECT count(*) FROM materials) AS materials,(SELECT count(*) FROM manufacturing_processes) AS processes,(SELECT count(*) FROM inference_rules WHERE status IN ('draft','approved')) AS rules");
    return json({ok:true,version,counts,mode:"private prototype"});
   }
   if(method==="GET"&&path==="/v1/knowledge/search"){
    const q=norm(url.searchParams.get("q")||""),kind=url.searchParams.get("kind")||"products",raw=url.searchParams.get("limit")||"20";
    if(q.length<2||q.length>120||!Object.hasOwn(kinds,kind)||!/^\d+$/.test(raw)||Number(raw)<1||Number(raw)>50)return json({error:"invalid search; q 2-120 characters, valid kind, limit 1-50"},400);
    const [table,col]=kinds[kind];
    const result=await all(db,`SELECT id,${col} AS name,status,source FROM ${table} WHERE instr(lower(${col}),?)>0 AND lower(status) NOT IN ('remove_candidate','rejected','removed') ORDER BY CASE WHEN lower(${col})=? THEN 0 WHEN instr(lower(${col}),?)=1 THEN 1 ELSE 2 END,length(${col}),id LIMIT ?`,q,q,q,Number(raw));
    return json({version,kind,query:q,results:result,classification:"retrieval candidates, not verified company facts"});
   }
   if(method==="GET"&&path.startsWith("/v1/knowledge/products/")){
    const id=decodeURIComponent(path.slice("/v1/knowledge/products/".length));if(!id||id.length>150)return json({error:"invalid id"},400);
    const product=await one(db,"SELECT id,name,normalized_name,is_component,status,source FROM product_types WHERE id=?",id);
    if(!product)return json({error:"product_not_found"},404);
    const categories=await all(db,"SELECT c.id,c.name,l.role,l.status,l.confidence,l.source FROM product_category_links l JOIN categories c ON c.id=l.category_id WHERE l.product_id=? ORDER BY l.role,c.name LIMIT 50",id);
    return json({version,product,categories,note:"Classification links retain their draft/review status."});
   }
   if(method==="GET"&&path.startsWith("/v1/knowledge/categories/")){
    const id=decodeURIComponent(path.slice("/v1/knowledge/categories/".length));if(!id||id.length>150)return json({error:"invalid id"},400);
    const category=await one(db,"SELECT id,name,status,source FROM categories WHERE id=?",id);if(!category)return json({error:"category_not_found"},404);
    const materials=await all(db,"SELECT m.id,m.name,l.status,l.confidence,l.rationale,l.metadata_json FROM category_material_links l JOIN materials m ON m.id=l.material_id WHERE l.category_id=? LIMIT 100",id);
    const processes=await all(db,"SELECT p.id,p.name,l.status,l.confidence,l.rationale,l.metadata_json FROM category_process_links l JOIN manufacturing_processes p ON p.id=l.process_id WHERE l.category_id=? LIMIT 100",id);
    return json({version,category,materials,processes,note:"Category-context candidates only; do not propagate to every product."});
   }
   if(method==="POST"&&path==="/v1/engineering/infer"){
    if(Number(request.headers.get("content-length")||0)>8192)return json({error:"request_too_large"},413);
    let input;try{const text=await request.text();if(text.length>8192)return json({error:"request_too_large"},413);input=JSON.parse(text)}catch{return json({error:"invalid_json"},400)}
    if(!input||typeof input.product_name!=="string"||!norm(input.product_name)||input.product_name.length>150)return json({error:"product_name required, 1-150 characters"},400);
    const name=norm(input.product_name);
    const matches=await all(db,"SELECT id,name,status,is_component FROM product_types WHERE lower(normalized_name)=? AND lower(status) NOT IN ('remove_candidate','rejected','removed') ORDER BY id LIMIT 10",name);
    const rows=await all(db,"SELECT id,name,version,rule_json,status,source FROM inference_rules WHERE status IN ('draft','approved') ORDER BY id LIMIT 100");
    const matching=rows.map(r=>{try{return {...r,data:JSON.parse(r.rule_json)}}catch{return null}}).filter(r=>r&&Array.isArray(r.data.aliases)&&r.data.aliases.some(a=>typeof a==="string"&&norm(a)===name));
    if(matching.length!==1)return json({version,product_name:input.product_name,basis:"unknown",status:matching.length?"ambiguous_rule":"insufficient_knowledge",product_candidates:matches,components:[],note:"No unique supported engineering rule; no speculative BOM generated."});
    const r=matching[0], cs=r.data.components.slice(0,30);
    const products=await byIds(db,"product_types",cs.map(c=>c.product_type_id));
    const materials=await byIds(db,"materials",cs.flatMap(c=>c.materials.map(x=>x.id)));
    const processes=await byIds(db,"manufacturing_processes",cs.flatMap(c=>c.processes.map(x=>x.id)));
    const candidates=(refs,lookup)=>refs.filter(x=>lookup[x.id]).map(x=>({...lookup[x.id],reference_status:lookup[x.id].status,status:"unverified",basis:"inferred",condition:x.condition}));
    const components=cs.map(c=>({name:c.name,product_type:products[c.product_type_id]||null,condition:c.condition,basis:"inferred",status:"unverified",materials:candidates(c.materials,materials),processes:candidates(c.processes,processes)}));
    return json({version,product_name:input.product_name,product_candidates:matches,basis:"inferred",status:"unverified",rule:{id:r.id,name:r.name,version:r.version,status:r.status,source:r.source},components,note:"Generic design hypotheses, not an actual BOM, confirmed material grade, manufacturing capability or purchase decision. Alternatives and evidence must be checked."});
   }
   return json({error:"route_not_found"},404);
  }catch(e){return json({error:"internal_error"},500)}
 }
 return {fetch};
}
export default createEngine();
