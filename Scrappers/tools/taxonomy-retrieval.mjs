/** Read-only, evidence-aware taxonomy candidate retrieval.
 * No remote model calls, taxonomy mutation, or automatic category approval.
 * Scores rank candidates within one query; they are NOT probabilities.
 */
const STOP=new Set('a an and are as at be by can for from has have in into is it its of on or our the their this to via we with your you new best built made available designed features feature includes including support supports use used using product products model models series heavy duty super premium high low standard extra advanced system systems company usa ltd inc'.split(' '));
// Sector labels establish context, not a physical product type. Matching
// 'aircraft' does not establish that the product is a wire harness or frame.
const DOMAIN_ONLY=new Set('bicycle motorcycle vehicle truck van aircraft aerospace aviation marine medical technology industry food solar electronic computer fluid cargo transport accessory'.split(' '));
// Generic object words recur in unrelated industries; require product-function qualifiers.
const AMBIGUOUS_OBJECTS=new Set('rack tray box panel frame mount mounting column case cover enclosure beam component accessory part assembly housing cabinet bracket support fixture system equipment device item vehicle cross'.split(' '));
// Industry-only qualifiers cannot name a component type. Functional words
// such as cargo, solar or medical are retained for specific leaf matching.
const SECTOR_QUALIFIERS=new Set('aircraft aerospace aviation marine vehicle truck van bicycle motorcycle'.split(' '));
const ALIASES=new Map(Object.entries({
  bikes:'bicycle',bike:'bicycle',ebike:'bicycle',ebikes:'bicycle',bicycles:'bicycle',
  motorcycles:'motorcycle',motorbikes:'motorcycle',motorbike:'motorcycle',moto:'motorcycle',
  racks:'rack',racking:'rack',trays:'tray',
  cars:'vehicle',car:'vehicle',vehicles:'vehicle',automotive:'vehicle',mobility:'vehicle',transportation:'vehicle',
  trucks:'truck',vans:'van',
  pumps:'pump',pumping:'pump',mixers:'mixer',mixing:'mixer',
  servers:'server',datacenter:'data',
  appliances:'appliance',industrial:'industry',industries:'industry',
  hospitals:'medical',hospital:'medical',healthcare:'medical',clinical:'medical',
  computers:'computer',electronics:'electronic',
  boxes:'box',cases:'case',
  solar:'solar',photovoltaic:'solar',
  accessories:'accessory',components:'component',
  carries:'carry',carrying:'carry',carrier:'carry',carriers:'carry',hauling:'haul',transporting:'transport',loading:'load',holding:'hold',
  mounts:'mount',mounted:'mount',mounting:'mount',
  fluids:'fluid',liquids:'fluid',
  forklifts:'forklift'
}));
function word(raw){
  let t=String(raw||'').toLowerCase();
  if(ALIASES.has(t))return ALIASES.get(t);
  if(t.endsWith('ies')&&t.length>5)t=t.slice(0,-3)+'y';
  else if(/(?:sses|ches|shes|xes|zes)$/.test(t)&&t.length>5)t=t.slice(0,-2);
  else if(t.endsWith('s')&&t.length>4&&!t.endsWith('ss'))t=t.slice(0,-1);
  return ALIASES.get(t)||t;
}
function phrase(text){return String(text||'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').replace(/\s+/g,' ').trim();}
function terms(text){return [...new Set(phrase(text).split(' ').map(word).filter(t=>t.length>2&&!STOP.has(t)))];}
function contextualize(q){
  const out=new Set(q);
  // Context expansions only, never leaf-object equivalences.
  if(['bicycle','motorcycle','vehicle','truck','van','hitch','trailer'].some(t=>out.has(t)))out.add('vehicle');
  if(['server','computer','data','network'].some(t=>out.has(t)))out.add('technology');
  if(['kitchen','baking','bakery','food'].some(t=>out.has(t)))out.add('food');
  if(['clinical','patient','medical'].some(t=>out.has(t)))out.add('medical');
  if(out.has('solar')){out.add('renewable');out.add('energy');}
  return out;
}
function primaryFunctionTerms(intro){
  const out=contextualize(intro),words=new Set(intro);
  // A rack transporting bicycles/motorcycles on vehicles can be retrieved
  // as a CARGO-rack candidate; taxonomy scope is STILL subject to review.
  const carriesBikes=words.has('bicycle')||words.has('motorcycle');
  const transportUse=['haul','carry','transport','hold','load','shuttle','receiver','hitch'].some(t=>words.has(t));
  if(words.has('rack')&&carriesBikes&&(transportUse||words.has('vehicle')))out.add('cargo');
  return out;
}
function intersect(words,query){return [...new Set(words)].filter(t=>query.has(t));}
function nodeParts(node){
  const path=String(node.path||node.label||'');
  const segments=path.split(/\s*>\s*/).filter(Boolean);
  const leaf=terms(node.label);
  const parents=segments.slice(0,-1);
  const rootContext=terms(parents.slice(0,2).join(' '));
  const parentContext=terms(parents.join(' '));
  const l1Context=terms(segments[1]||'');
  return {leaf,rootContext,parentContext,l1Context};
}
/**
 * Candidates must have a product name embedded in a quoted source statement,
 * descriptive words beyond the name, leaf-object overlap AND hierarchy context.
 * Caller is responsible for proving that the quote belongs to the source URL.
 * Unverified names or short slogans deliberately abstain.
 */
export function rankEvidenceTaxonomy(product,nodes,{limit=3}={}){
  if(!product||!Array.isArray(nodes)||!nodes.length)return [];
  const name=phrase(product.name),quote=phrase(product.quote);
  const where=(' '+quote+' ').indexOf(' '+name+' ');
  if(name.length<3||quote.length<24||where<0)return [];
  // Restrict object detection to the product introduction. Long descriptions
  // may mention the transported object, spare parts, or things NOT included.
  const focused=quote.slice(Math.max(0,where-32),Math.min(quote.length,where+name.length+210));
  const objectIntro=quote.slice(Math.max(0,where),Math.min(quote.length,where+name.length+135));
  const nameTerms=new Set(terms(product.name)),quoteTerms=terms(focused);
  const descriptive=quoteTerms.filter(t=>!nameTerms.has(t));
  if(descriptive.length<2)return [];
  const objects=new Set(terms(objectIntro)),context=contextualize(quoteTerms),candidates=[];
  const primaryContext=primaryFunctionTerms([...objects]);
  // A named add-on may mention the base rack for compatibility. Never turn
  // its parent product into the add-on's own class from that mention alone.
  const accessory=/(?:^|\s)(?:add[- ]?on|attachment|replacement|extension|adapter|spare\s+part)(?:\s|$)/i.test(product.name);
  for(const node of nodes){
    if(!node||!Number.isInteger(node.level)||node.level<2||typeof node.code!=='string'||typeof node.label!=='string')continue;
    const {leaf,rootContext,parentContext,l1Context}=nodeParts(node);
    if(!leaf.length||!parentContext.length)continue;
    const leafHits=intersect(leaf,objects);
    if(!leafHits.some(t=>!DOMAIN_ONLY.has(t)))continue;
    // 'rack' plus 'vehicle' is not sufficient evidence for steering racks.
    // Likewise a tray-style cargo rack is not a battery-enclosure tray.
    // Repeated domain words ('aircraft', 'vehicle') cannot satisfy a
    // component-specific category such as 'Aircraft wire harnesses'.
    const distinctive=leaf.filter(t=>!AMBIGUOUS_OBJECTS.has(t)&&!SECTOR_QUALIFIERS.has(t));
    if(distinctive.length&&!distinctive.some(t=>primaryContext.has(t)))continue;
    // A generic noun-only category requires distinctive immediate parent evidence.
    if(!distinctive.length){
      const parentParts=String(node.path||'').split(/\s*>\s*/);
      const immediateParent=terms(parentParts.at(-2)||'').filter(t=>!AMBIGUOUS_OBJECTS.has(t));
      if(!immediateParent.some(t=>primaryContext.has(t)))continue;
    }
    if(accessory&&!leaf.some(t=>['accessory','part','tray','attachment','adapter','extension'].includes(t)))continue;
    const contextHits=intersect(parentContext,context);
    const rootHits=intersect(rootContext,context);
    const l1Hits=intersect(l1Context,context);
    if(!contextHits.length||!rootHits.length||!l1Hits.length)continue;
    // A shared modifier such as "heavy" or "premium" cannot establish an object class.
    const objectStrength=Math.min(1,leafHits.length/Math.min(2,leaf.length));
    const contextStrength=Math.min(1,contextHits.length/2);
    const score=Number((0.25+0.38*objectStrength+0.20*contextStrength+0.10+0.07*(leafHits.length>1?1:0)).toFixed(3));
    if(score<0.55)continue;
    candidates.push({code:node.code,label:node.label,path:node.path,level:node.level,score,
      method:'evidence_hierarchy_lexical',scoreMeaning:'relative_retrieval_score_not_probability',
      rationale:'Quoted product description shares object term(s) ['+leafHits.join(', ')+'] and hierarchy context ['+contextHits.slice(0,3).join(', ')+']; scope and fit require human review.'});
  }
  candidates.sort((a,b)=>b.score-a.score||b.level-a.level||a.code.localeCompare(b.code));
  return candidates.slice(0,Math.max(1,Math.min(10,Number.isInteger(limit)?limit:3)));
}
